import cds from '@sap/cds';
import { registerManagerLifecycle } from './manager-lifecycle.js';
import { randomUUID } from 'crypto';
import { currentEmployee } from './lib/util.js';
import { buildReportPdf } from './lib/pdf.js';
import { loginOf, EMAIL_PATTERN } from './lib/util.js';
import {
    readFilters, describeFilters, dashboard, reportDefinition, runReport,
    MAX_EXPORT_ROWS, MAX_PREVIEW_ROWS
} from './lib/reports.js';

const { INSERT, SELECT, UPDATE } = cds.ql;

const DOWNLOAD_MINUTES = 15;     // NFR-010: download links are time-limited
const MAX_RECIPIENTS = 10;

export default cds.service.impl(async function () {
    registerManagerLifecycle(this);

    const { ReportFiles } = this.entities;
    const { ReportFiles: ReportFilesDb, ReportLogs } = cds.entities('itam.db.reporting');

    // Fail closed on row-level reads: Managers see only their department's
    // employees and the lifecycle records of assets held by that department.
    this.before('READ', ['Assets', 'Assignments', 'History', 'Maintenance', 'AssetRequests', 'Employees'], async req => {
        if (req.user.is('Admin')) return;
        const self = await currentEmployee(req);
        if (!self?.DEPARTMENT_NODE_KEY) req.reject(403, 'Manager department is not configured.');
        const colleagues = await SELECT.from(Employees).columns('NODE_KEY')
            .where({ DEPARTMENT_NODE_KEY: self.DEPARTMENT_NODE_KEY });
        const employeeIds = colleagues.map(e => e.NODE_KEY);
        if (!employeeIds.length) req.reject(403, 'No employees in assigned department.');
        const entity = req.target.name.split('.').pop();
        if (entity === 'Employees') {
            req.query.where({ NODE_KEY: { in: employeeIds } });
            return;
        }
        if (entity === 'AssetRequests') {
            const deptAssets = await SELECT.from(Assets).columns('NODE_KEY')
                .where({ MANAGING_DEPARTMENT_NODE_KEY: self.DEPARTMENT_NODE_KEY });
            req.query.where({
                REQUESTED_BY_NODE_KEY: { in: employeeIds },
                ASSET_NODE_KEY: { in: deptAssets.map(a => a.NODE_KEY) }
            });
            return;
        }
        const deptAssets = await SELECT.from(Assets).columns('NODE_KEY')
            .where({ MANAGING_DEPARTMENT_NODE_KEY: self.DEPARTMENT_NODE_KEY });
        const assetIds = deptAssets.map(a => a.NODE_KEY);
        if (!assetIds.length) req.reject(403, 'No assets allocated to the department.');
        req.query.where(entity === 'Assets'
            ? { NODE_KEY: { in: assetIds } }
            : { ASSET_NODE_KEY: { in: assetIds } });
    });

    async function securedFilters(req) {
        const filters = readFilters(req);
        if (!req.user.is('Admin')) {
            const employee = await currentEmployee(req);
            if (!employee?.DEPARTMENT_NODE_KEY) req.reject(403, 'Manager must belong to a department.');
            if (filters.departmentScope && filters.departmentScope !== employee.DEPARTMENT_NODE_KEY) {
                req.reject(403, 'Managers can only select their own department.');
            }
            filters.departmentScope = employee.DEPARTMENT_NODE_KEY;
        }
        return filters;
    }

    // Request review is department-scoped for Managers, unrestricted for Admins.
    const { AssetRequests, Assets } = cds.entities('itam.db.transaction');
    const { Employees } = cds.entities('itam.db.master');
    async function reviewer(req) {
        const self = await currentEmployee(req);
        if (!self) req.reject(403, 'No employee linked to login.');
        return self;
    }
    async function checkDepartment(req, ownerId) {
        if (req.user.is('Admin')) return;
        const self = await reviewer(req);
        if (!self.DEPARTMENT_NODE_KEY) req.reject(403, 'Manager has no department.');
        const target = await SELECT.one.from(Employees).where({ NODE_KEY: ownerId });
        if (!target || target.DEPARTMENT_NODE_KEY !== self.DEPARTMENT_NODE_KEY) {
            req.reject(403, 'Request belongs to a different department.');
        }
    }
    this.on('raiseMaintenanceRequest', async req => {
        const actor = await reviewer(req);
        const description = String(req.data.description || '').trim();
        if (!description || description.length > 255) req.reject(400, 'Provide a maintenance description (1-255 characters).');
        const asset = await SELECT.one.from(Assets).where({ NODE_KEY: req.data.asset, STATUS: 'ASSIGNED' });
        if (!asset) req.reject(404, 'No assigned asset with that key.');
        if (!req.user.is('Admin')) {
            if (asset.MANAGING_DEPARTMENT_NODE_KEY !== actor.DEPARTMENT_NODE_KEY) req.reject(403, 'Asset does not belong to your department.');
        }
        const duplicate = await SELECT.one.from(AssetRequests).where({
            ASSET_NODE_KEY: asset.NODE_KEY, REQUEST_TYPE: 'MAINTENANCE', STATUS: 'PENDING'
        });
        if (duplicate) req.reject(409, 'A maintenance request is already pending for this asset.');
        const id = randomUUID();
        await INSERT.into(AssetRequests).entries({
            NODE_KEY: id, REQUEST_TYPE: 'MAINTENANCE', STATUS: 'PENDING',
            DESCRIPTION: description, ASSET_NODE_KEY: asset.NODE_KEY,
            REQUESTED_BY_NODE_KEY: actor.NODE_KEY, REQUESTED_AT: new Date().toISOString()
        });
        return id;
    });
    this.on('reviewAssetRequest', async req => {
        const actor = await reviewer(req);
        const item = await SELECT.one.from(AssetRequests).where({ NODE_KEY: req.data.requestId });
        if (!item) req.reject(404, 'Request not found.');
        await checkDepartment(req, item.REQUESTED_BY_NODE_KEY);
        if (!req.user.is('Admin')) {
            const asset = await SELECT.one.from(Assets).where({ NODE_KEY: item.ASSET_NODE_KEY });
            if (!asset || asset.MANAGING_DEPARTMENT_NODE_KEY !== actor.DEPARTMENT_NODE_KEY) {
                req.reject(403, 'Request asset does not belong to your department.');
            }
        }
        if (item.STATUS !== 'PENDING') req.reject(409, 'Request already reviewed.');
        const note = String(req.data.note || '').trim();
        if (note.length > 255) req.reject(400, 'Review note is too long.');
        const status = req.data.approve ? 'APPROVED' : 'REJECTED';
        await UPDATE(AssetRequests).set({
            STATUS: status, DECISION_NOTE: note || null,
            RESOLVED_BY_NODE_KEY: actor.NODE_KEY, RESOLVED_AT: new Date().toISOString()
        }).where({ NODE_KEY: item.NODE_KEY, STATUS: 'PENDING' });
        return status;
    });

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

    this.on('getDashboard', async (req) => dashboard(await securedFilters(req)));

    // ==================================================
    // REPORT PREVIEW (FR-022, FR-026)
    // ==================================================

    this.on('previewReport', async (req) => {

        const { type } = reportDefinition(req);
        const filters = await securedFilters(req);
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
        const filters = await securedFilters(req);

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
                .where({ REQUEST_ID: requestId, ACTION: 'EMAIL', OUTCOME: { in: ['SUCCESS', 'SIMULATED'] }, REQUESTED_BY: loginOf(req) });
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

        let delivery;
        try {
            const mail = await cds.connect.to('mail');
            delivery = await mail.send('send', {
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

        const simulated = delivery?.channel === 'log';
        const outcome = simulated ? 'SIMULATED' : 'SUCCESS';
        const message = simulated
            ? 'E-mail simulation only: PDF was logged, not delivered. Configure mail-api for real delivery.'
            : `Report handed to configured e-mail provider for ${to}.`;
        await audit(req, { ...entry, OUTCOME: outcome, MESSAGE: message.slice(0, 255) });

        req.notify(message);
        return {
            status: simulated ? 'SIMULATED' : 'SENT',
            message,
            requestId,
            recipients: to,
            fileId: file.NODE_KEY
        };
    });
});
