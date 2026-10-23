// Minimal PDF 1.4 writer for tabular reports (no third-party library needed).
// A4 landscape, standard Helvetica fonts, title block, optional bar chart, table with paging.

const PAGE_W = 842;
const PAGE_H = 595;
const MARGIN = 36;
const ROW_H = 16;
const FONT_SIZE = 8;

// Helvetica glyphs are roughly half as wide as the font size
const textWidth = (text, size) => String(text).length * size * 0.52;

// PDF strings: escape \ ( ) and keep to the WinAnsi range
const pdfText = (value) => String(value ?? '')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');

const fit = (text, width, size) => {
    let value = String(text ?? '');
    if (textWidth(value, size) <= width) return value;
    while (value.length > 1 && textWidth(value + '...', size) > width) value = value.slice(0, -1);
    return value + '...';
};

const num = (n) => Math.round(n * 100) / 100;

class Page {

    constructor() {
        this.ops = [];
    }

    text(x, y, value, { size = FONT_SIZE, bold = false, color = [0, 0, 0] } = {}) {
        this.ops.push(`${color.join(' ')} rg BT /${bold ? 'F2' : 'F1'} ${size} Tf ${num(x)} ${num(y)} Td (${pdfText(value)}) Tj ET`);
    }

    rect(x, y, w, h, color) {
        this.ops.push(`${color.join(' ')} rg ${num(x)} ${num(y)} ${num(w)} ${num(h)} re f`);
    }

    line(x1, y1, x2, y2, gray = 0.75) {
        this.ops.push(`${gray} G 0.5 w ${num(x1)} ${num(y1)} m ${num(x2)} ${num(y2)} l S`);
    }
}

// Bars use a pattern of shades plus the value as text, so colour is never the only signal
const BAR_COLORS = [[0.04, 0.42, 0.75], [0.16, 0.6, 0.35], [0.85, 0.5, 0.1], [0.75, 0.2, 0.2], [0.45, 0.45, 0.45]];

function columnWidths(columns, rows, total) {
    const want = columns.map((c, i) => Math.max(
        c.length,
        ...rows.slice(0, 200).map(r => Math.min(String(r[i] ?? '').length, 40))
    ) + 2);
    const sum = want.reduce((a, b) => a + b, 0);
    return want.map(w => w / sum * total);
}

/**
 * @param {object} report
 * @param {string} report.title
 * @param {string[]} report.meta      lines under the title (generated at, filters, requested by)
 * @param {string[]} report.columns
 * @param {Array<Array<string>>} report.rows
 * @param {{ title: string, bars: { label: string, value: number }[] }} [report.chart]
 * @returns {Buffer}
 */
export function buildReportPdf({ title, meta = [], columns, rows, chart }) {

    const pages = [];
    let page;
    let y;

    const newPage = () => {
        page = new Page();
        pages.push(page);
        y = PAGE_H - MARGIN;
    };

    const tableWidth = PAGE_W - 2 * MARGIN;
    const widths = columnWidths(columns, rows, tableWidth);

    const tableHeader = () => {
        page.rect(MARGIN, y - ROW_H + 4, tableWidth, ROW_H, [0.9, 0.92, 0.95]);
        let x = MARGIN;
        columns.forEach((c, i) => {
            page.text(x + 3, y - 8, fit(c, widths[i] - 6, FONT_SIZE), { bold: true });
            x += widths[i];
        });
        y -= ROW_H;
    };

    // ---- title block ----
    newPage();
    page.text(MARGIN, y - 14, title, { size: 16, bold: true });
    y -= 30;
    for (const line of meta) {
        page.text(MARGIN, y - 8, fit(line, tableWidth, 9), { size: 9, color: [0.25, 0.25, 0.25] });
        y -= 13;
    }
    y -= 8;

    // ---- bar chart (labelled values) ----
    if (chart && chart.bars.length) {
        page.text(MARGIN, y - 10, chart.title, { size: 11, bold: true });
        y -= 22;
        const max = Math.max(...chart.bars.map(b => b.value), 1);
        const labelW = 120;
        const barMax = 360;
        chart.bars.forEach((bar, i) => {
            const w = Math.max(bar.value / max * barMax, bar.value > 0 ? 2 : 0);
            page.text(MARGIN, y - 9, fit(bar.label, labelW - 6, 9), { size: 9 });
            page.rect(MARGIN + labelW, y - 11, w, 10, BAR_COLORS[i % BAR_COLORS.length]);
            page.text(MARGIN + labelW + w + 6, y - 9, String(bar.value), { size: 9, bold: true });
            y -= 15;
        });
        y -= 10;
    }

    // ---- table ----
    page.text(MARGIN, y - 10, `Records (${rows.length})`, { size: 11, bold: true });
    y -= 22;
    tableHeader();

    if (!rows.length) {
        page.text(MARGIN + 3, y - 8, 'No data for the selected filters.', { color: [0.4, 0.4, 0.4] });
        y -= ROW_H;
    }

    for (const row of rows) {
        if (y - ROW_H < MARGIN + 20) {
            newPage();
            tableHeader();
        }
        let x = MARGIN;
        row.forEach((cell, i) => {
            page.text(x + 3, y - 8, fit(cell, widths[i] - 6, FONT_SIZE));
            x += widths[i];
        });
        page.line(MARGIN, y - ROW_H + 4, MARGIN + tableWidth, y - ROW_H + 4);
        y -= ROW_H;
    }

    // ---- footer: page x of n ----
    pages.forEach((p, i) => {
        p.text(PAGE_W - MARGIN - 60, MARGIN - 16, `Page ${i + 1} of ${pages.length}`, { size: 8, color: [0.4, 0.4, 0.4] });
        p.text(MARGIN, MARGIN - 16, title, { size: 8, color: [0.4, 0.4, 0.4] });
    });

    return serialize(pages);
}

function serialize(pages) {

    // object numbers: 1 catalog, 2 pages, 3 + 4 fonts, then page / content pairs
    const objects = [];
    const pageRefs = pages.map((_, i) => 5 + i * 2);

    objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    objects[2] = `<< /Type /Pages /Kids [${pageRefs.map(r => `${r} 0 R`).join(' ')}] /Count ${pages.length} >>`;
    objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';

    pages.forEach((p, i) => {
        const pageNo = pageRefs[i];
        const stream = p.ops.join('\n');
        objects[pageNo] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
            `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageNo + 1} 0 R >>`;
        objects[pageNo + 1] = `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`;
    });

    let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
    const offsets = [];
    for (let i = 1; i < objects.length; i++) {
        offsets[i] = Buffer.byteLength(out, 'latin1');
        out += `${i} 0 obj\n${objects[i]}\nendobj\n`;
    }

    const xref = Buffer.byteLength(out, 'latin1');
    out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
    for (let i = 1; i < objects.length; i++) {
        out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }
    out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

    return Buffer.from(out, 'latin1');
}
