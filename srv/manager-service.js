import cds from '@sap/cds';
import { randomUUID } from 'crypto';
import { buildReportPdf } from './lib/pdf.js';
import { loginOf, EMAIL_PATTERN } from './lib/util.js';
import {
    readFilters, describeFilters, dashboard, reportDefinition, runReport,
    MAX_EXPORT_ROWS, MAX_PREVIEW_ROWS
} from './lib/reports.js';

const { INSERT, SELECT } = cds.ql;

const DOWNLOAD_MINUTES = 15;     // NFR-010: download links are time-limited
const MAX_RECIPIENTS = 10;

export default cds.service.impl(async function () {

    const { ReportFiles } = this.entities;
    const { ReportFiles: ReportFilesDb, ReportLogs } = cds.entities('itam.db.reporting');

    // ==================================================
    // AUDIT LOG (FRD Security: Audit, NFR-012) - no report contents are stored
    // ==================================================

    async function audit(req, entry) {
        await INSERT.into(ReportLogs).entries({
            NODE_KEY: randomUUID(),
            REQUESTED_BY: loginOf(req),
            REQUESTED_AT: new Date().toISOString(),
            ...entry
        });
    }

    // ==================================================
    // DASHBOARD (FR-021, FR-026)
    // ==================================================

    this.on('getDashboard', async (req) => dashboard(readFilters(req)));

    // ==================================================
    // REPORT PREVIEW (FR-022, FR-026)
    // ==================================================

    this.on('previewReport', async (req) => {

        const { type } = reportDefinition(req);
        const filters = readFilters(req);
        const report = await runReport(type, filters, { limit: MAX_PREVIEW_ROWS });

        return {
            reportType: type,
            title: report.title,
            filters: await describeFilters(filters),
            generatedAt: new Date().toISOString(),
            columns: report.columns,
            rows: report.rows.map(cells => ({ cells })),
            rowCount: report.rowCount
        };
    });

    // ==================================================
    // PDF: generate + store for download (FR-022, FR-024, NFR-008)
    // ==================================================

    async function generatePdf(req) {

        const { type } = reportDefinition(req);
        const filters = readFilters(req);

        const report = await runReport(type, filters, { limit: MAX_EXPORT_ROWS + 1 });
        if (report.rowCount > MAX_EXPORT_ROWS) {
            req.reject(413, `The report has ${report.rowCount} rows - the PDF limit is ${MAX_EXPORT_ROWS}. Please narrow the filters.`);
        }

        const now = new Date();
        const filterText = await describeFilters(filters);

        const content = buildReportPdf({
            title: report.title,
            meta: [
                `Generated: ${now.toISOString().replace('T', ' ').slice(0, 19)} UTC`,
                `Requested by: ${loginOf(req)}`,
                `Filters: ${filterText}`
            ],
            columns: report.columns,
            rows: report.rows,
            chart: report.chart
        });

        const file = {
            NODE_KEY: randomUUID(),
            REPORT_TYPE: type,
            FILE_NAME: `${type}_${now.toISOString().slice(0, 19).replace(/[-:T]/g, '')}.pdf`,
            ROW_COUNT: report.rowCount,
            FILTERS: JSON.stringify(filters),
            REQUESTED_BY: req.user.id,
            CREATED_AT: now.toISOString(),
            EXPIRES_AT: new Date(now.getTime() + DOWNLOAD_MINUTES * 60000).toISOString(),
            CONTENT: content
        };
        await INSERT.into(ReportFilesDb).entries(file);

        return { file, report, filters, content };
    }

    const downloadUrl = (file) => `/odata/v4/manager/ReportFiles(${file.NODE_KEY})/CONTENT`;

    this.on('exportReport', async (req) => {

        const { file, filters } = await generatePdf(req);

        await audit(req, {
            REPORT_TYPE: file.REPORT_TYPE,
            ACTION: 'EXPORT',
            FILTERS: JSON.stringify(filters),
            ROW_COUNT: file.ROW_COUNT,
            OUTCOME: 'SUCCESS',
            FILE_NODE_KEY: file.NODE_KEY
        });

        return {
            fileId: file.NODE_KEY,
            fileName: file.FILE_NAME,
            rowCount: file.ROW_COUNT,
            downloadUrl: downloadUrl(file),
            expiresAt: file.EXPIRES_AT
        };
    });

    // ==================================================
    // DOWNLOAD (FR-024, NFR-010): only own files, only until they expire
    // ==================================================

    this.before('READ', ReportFiles, async (req) => {

        const key = req.params?.[0]?.NODE_KEY ?? req.params?.[0];
        if (!key) return;

        const file = await SELECT.one.from(ReportFilesDb)
            .columns('NODE_KEY', 'REPORT_TYPE', 'ROW_COUNT', 'FILTERS', 'REQUESTED_BY', 'EXPIRES_AT')
            .where({ NODE_KEY: key });

        // someone else's file: the @restrict filter answers 404
        if (!file || file.REQUESTED_BY !== req.user.id) return;

        if (new Date(file.EXPIRES_AT) < new Date()) {
            return req.reject(410, 'This download link has expired - please export the report again.');
        }

        const path = req.http?.req?.originalUrl ?? req.http?.req?.url ?? '';
        if (/\/CONTENT(\/\$value)?(\?|$)/.test(path)) {
            await audit(req, {
                REPORT_TYPE: file.REPORT_TYPE,
                ACTION: 'DOWNLOAD',
                FILTERS: file.FILTERS,
                ROW_COUNT: file.ROW_COUNT,
                OUTCOME: 'SUCCESS',
                FILE_NODE_KEY: file.NODE_KEY
            });
        }
    });

    // ==================================================
    // E-MAIL (FR-023, NFR-009): validated recipients, idempotent, clear status
    // ==================================================

    this.on('emailReport', async (req) => {

        const recipients = String(req.data.recipients ?? '')
            .split(/[,;\s]+/).map(r => r.trim().toLowerCase()).filter(Boolean);
        const requestId = req.data.requestId?.trim() || null;

        if (!recipients.length) {
            return req.reject(400, 'Please enter at least one recipient.');
        }
        if (recipients.length > MAX_RECIPIENTS) {
            return req.reject(400, `At most ${MAX_RECIPIENTS} recipients are allowed.`);
        }
        const invalid = recipients.filter(r => !EMAIL_PATTERN.test(r));
        if (invalid.length) {
            return req.reject(400, `Invalid e-mail address: ${invalid.join(', ')}.`);
        }
        if (requestId && requestId.length > 64) {
            return req.reject(400, 'requestId is too long (max 64 characters).');
        }

        // same request again (retry, double click): never send a second e-mail
        if (requestId) {
            const done = await SELECT.one.from(ReportLogs)
                .where({ REQUEST_ID: requestId, ACTION: 'EMAIL', OUTCOME: 'SUCCESS', REQUESTED_BY: loginOf(req) });
            if (done) {
                return {
                    status: 'DUPLICATE',
                    message: `This report was already e-mailed to ${done.RECIPIENTS} - no second e-mail was sent.`,
                    requestId,
                    recipients: done.RECIPIENTS,
                    fileId: done.FILE_NODE_KEY
                };
            }
        }

        const { file, report, filters, content } = await generatePdf(req);
        const to = recipients.join(', ');

        const entry = {
            REPORT_TYPE: file.REPORT_TYPE,
            ACTION: 'EMAIL',
            FILTERS: JSON.stringify(filters),
            RECIPIENTS: to,
            ROW_COUNT: file.ROW_COUNT,
            REQUEST_ID: requestId,
            FILE_NODE_KEY: file.NODE_KEY
        };

        try {
            const mail = await cds.connect.to('mail');
            await mail.send('send', {
                to: recipients,
                subject: `${report.title} - ${file.CREATED_AT.slice(0, 10)}`,
                text: `Please find attached the report "${report.title}" (${file.ROW_COUNT} records).\n` +
                    `Filters: ${await describeFilters(filters)}\nRequested by: ${loginOf(req)}`,
                attachment: { fileName: file.FILE_NAME, content }
            });
        } catch (error) {
            // failure is logged and returned (not thrown) so the audit entry is kept and the call can be retried
            cds.log('mail').error('Report e-mail failed:', error.message);
            await audit(req, { ...entry, OUTCOME: 'FAILED', MESSAGE: String(error.message).slice(0, 255) });
            return {
                status: 'FAILED',
                message: 'The e-mail could not be delivered. Please try again later.',
                requestId,
                recipients: to,
                fileId: file.NODE_KEY
            };
        }

        await audit(req, { ...entry, OUTCOME: 'SUCCESS' });

        req.notify(`Report sent to ${to}.`);
        return {
            status: 'SENT',
            message: `Report sent to ${to}.`,
            requestId,
            recipients: to,
            fileId: file.NODE_KEY
        };
    });
});
