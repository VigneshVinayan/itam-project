import cds from '@sap/cds';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

const { GET, POST, PATCH, DELETE } = cds.test(import.meta.dirname + '/..');

const APP = '/odata/v4/app';
const ADM = '/odata/v4/admin';
const MGR = '/odata/v4/manager';
const USR = '/odata/v4/user';

// test logins (package.json -> cds.requires.[test].auth); in BTP the login comes from XSUAA
const ADMIN   = { auth: { username: 'admin@itam-demo.com',      password: 'admin'   } };
const MANAGER = { auth: { username: 'manager@itam-demo.com',    password: 'manager' } };
const USER    = { auth: { username: 'ravi.kumar@itam-demo.com', password: 'user'    } };

// seed data keys
const RAVI   = '20000000-0000-4000-8000-000000000003';
const PRIYA  = '20000000-0000-4000-8000-000000000004';
const ARJUN  = '20000000-0000-4000-8000-000000000005';   // INACTIVE
const LAPTOP = '30000000-0000-4000-8000-000000000001';
const LEGACY = '30000000-0000-4000-8000-000000000005';   // inactive category
const DELL   = '35000000-0000-4000-8000-000000000001';
const FIXIT  = '35000000-0000-4000-8000-000000000004';   // service vendor
const OLDSUP = '35000000-0000-4000-8000-000000000005';   // inactive vendor
const A1     = '40000000-0000-4000-8000-000000000001';   // ASSIGNED to Ravi
const A3     = '40000000-0000-4000-8000-000000000003';   // AVAILABLE monitor
const A8     = '40000000-0000-4000-8000-000000000008';   // ARCHIVED

// expects the request to fail with the given status
async function fails(request, status, text) {
    try { await request; } catch (err) {
        assert.equal(err.response?.status, status, JSON.stringify(err.response?.data));
        if (text) assert.match(err.response.data.error.message, text);
        return;
    }
    assert.fail(`expected HTTP ${status}`);
}

const active = (entity, key) => `${ADM}/${entity}(NODE_KEY=${key},IsActiveEntity=true)`;
const draft  = (entity, key) => `${ADM}/${entity}(NODE_KEY=${key},IsActiveEntity=false)`;
const action = (key, name) => `${active('Assets', key)}/AssetAdminService.${name}`;

const getAsset = async (key) => (await GET(active('Assets', key), ADMIN)).data;

const history = async (key) => (await GET(
    `${ADM}/History?$filter=ASSET_NODE_KEY eq ${key}&$orderby=RECORDED_AT`, ADMIN)).data.value;

// Fiori draft flow: new draft -> fill -> activate
async function createAsset(data) {
    const { data: created } = await POST(`${ADM}/Assets`, {}, ADMIN);
    await PATCH(draft('Assets', created.NODE_KEY), data, ADMIN);
    try {
        const { data: asset } = await POST(`${draft('Assets', created.NODE_KEY)}/AssetAdminService.draftActivate`, {}, ADMIN);
        return asset;
    } catch (err) {
        await DELETE(draft('Assets', created.NODE_KEY), ADMIN);   // discard the draft
        throw err;
    }
}

// Fiori edit flow: edit draft -> change -> activate
async function edit(entity, key, data) {
    await POST(`${active(entity, key)}/AssetAdminService.draftEdit`, { PreserveChanges: true }, ADMIN);
    await PATCH(draft(entity, key), data, ADMIN);
    try {
        return (await POST(`${draft(entity, key)}/AssetAdminService.draftActivate`, {}, ADMIN)).data;
    } catch (err) {
        await DELETE(draft(entity, key), ADMIN);
        throw err;
    }
}

// ==================================================

describe('Login and roles (FR-013, FR-014, FR-025)', () => {

    it('requires a login', async () => {
        await fails(GET(`${ADM}/Assets`), 401);
        await fails(GET(`${USR}/Assets`, { auth: { username: 'ravi.kumar@itam-demo.com', password: 'wrong' } }), 401);
    });

    it('whoAmI shows the login, roles and the linked employee', async () => {
        const { data: admin } = await GET(`${APP}/whoAmI()`, ADMIN);
        assert.equal(admin.isAdmin, true);
        assert.equal(admin.employee, 'Anita Desai (admin@itam-demo.com)');

        const { data: manager } = await GET(`${APP}/whoAmI()`, MANAGER);
        assert.deepEqual([manager.isAdmin, manager.isManager, manager.isUser], [false, true, false]);

        const { data: user } = await GET(`${APP}/whoAmI()`, USER);
        assert.deepEqual([user.isAdmin, user.isManager, user.isUser], [false, false, true]);
    });

    it('Manager and User cannot use the admin (lifecycle / master data) service', async () => {
        await fails(GET(`${ADM}/Assets`, MANAGER), 403);
        await fails(GET(`${ADM}/Employees`, USER), 403);
        await fails(POST(action(A3, 'assignAsset'), { employee: RAVI }, MANAGER), 403);
    });

    it('User has no dashboard / report access; Admin and Manager have', async () => {
        await fails(GET(`${MGR}/getDashboard()`, USER), 403);
        await fails(POST(`${MGR}/exportReport`, { reportType: 'ASSET_INVENTORY' }, USER), 403);
        assert.equal((await GET(`${MGR}/getDashboard()`, MANAGER)).status, 200);
        assert.equal((await GET(`${MGR}/getDashboard()`, ADMIN)).status, 200);
    });

    it('Manager has read-only operational access', async () => {
        const { data } = await GET(`${MGR}/Assets`, MANAGER);
        assert.equal(data.value.length, 2); // Procurement's available assets
        await PATCH(`${MGR}/Assets(${A3})`, { LOCATION: 'Bengaluru' }, MANAGER);
        await fails(PATCH(`${MGR}/Assets(${A3})`, { STATUS: 'ARCHIVED' }, MANAGER), 403);
    });

    it('User sees the inventory without costs and without archived assets (FR-002)', async () => {
        const { data } = await GET(`${USR}/Assets`, USER);
        assert.equal(data.value.length, 1);
        assert.ok(data.value.every(a => a.HOLDER_EMAIL === 'ravi.kumar@itam-demo.com'));
        assert.ok(!data.value.some(a => a.NODE_KEY === A8));
        assert.ok(!('PURCHASE_COST' in data.value[0]));
    });

    it('User sees only own assignments and own history (FR-015)', async () => {
        const { data: assignments } = await GET(`${USR}/AssetAssignments`, USER);
        assert.deepEqual(assignments.value.map(a => a.ASSET_TAG).sort(), ['AST-0001', 'AST-0007']);

        const { data: entries } = await GET(`${USR}/AssetHistory`, USER);
        assert.ok(entries.value.length > 0);
        assert.ok(entries.value.every(e => e.FROM_EMPLOYEE_NODE_KEY === RAVI || e.TO_EMPLOYEE_NODE_KEY === RAVI));

        await fails(PATCH(`${USR}/AssetHistory(${entries.value[0].NODE_KEY})`, { REMARKS: 'x' }, USER), 405);
    });

    it('launchpad KPIs depend on the role', async () => {
        const { data: admin } = await GET(`${APP}/tileKpis()`, ADMIN);
        assert.deepEqual([admin.availableAssets, admin.assignedAssets, admin.overdueReturns, admin.employees], [4, 3, 1, 5]);

        const { data: user } = await GET(`${APP}/tileKpis()`, USER);
        assert.equal(user.myAssets, 1);
        assert.equal(user.assignedAssets, null);
        assert.equal(user.employees, null);
    });
});

// ==================================================

describe('Dashboard KPIs and filters (FR-021, FR-026)', () => {

    it('shows the lifecycle KPIs', async () => {
        const { data } = await GET(`${MGR}/getDashboard()`, ADMIN);
        assert.equal(data.totalAssets, 10);
        assert.deepEqual([data.available, data.assigned, data.inMaintenance, data.retired, data.archived], [4, 3, 1, 1, 1]);
        assert.equal(Number(data.utilisationPct), 37.5);          // 3 assigned / 8 in service
        assert.equal(data.overdueReturns, 1);                     // AST-0002 was due 2026-09-30
        assert.equal(data.openMaintenance, 1);
        assert.ok(data.endOfLifeSoon >= 4);
        assert.equal(Number(data.totalValue), 1125000);           // archived asset not counted
        assert.equal(data.currency, 'INR');
        assert.deepEqual(data.byStatus.map(s => s.count), [4, 3, 1, 1, 1]);
        assert.equal(data.byCategory.find(c => c.label === 'Laptop').count, 7);
    });

    it('applies status / category / location / date filters', async () => {
        const { data: chennai } = await GET(`${MGR}/getDashboard(status='ASSIGNED',location='Chennai')`, ADMIN);
        assert.equal(chennai.totalAssets, 1);
        assert.equal(chennai.overdueReturns, 1);

        const { data: laptops } = await GET(`${MGR}/getDashboard(category=${LAPTOP})`, ADMIN);
        assert.equal(laptops.totalAssets, 7);

        const { data: recent } = await GET(`${MGR}/getDashboard(dateFrom=2025-01-01,dateTo=2026-12-31)`, ADMIN);
        assert.equal(recent.totalAssets, 3);                      // AST-0001, -0003, -0009
    });

    it('rejects invalid filters', async () => {
        await fails(GET(`${MGR}/getDashboard(status='BROKEN')`, ADMIN), 400);
        await fails(GET(`${MGR}/getDashboard(dateFrom=2026-05-01,dateTo=2026-01-01)`, ADMIN), 400);
    });
});

// ==================================================

describe('Reports: preview, PDF export / download, e-mail (FR-022 .. FR-024, FR-026)', () => {

    let file;

    it('previews a report with the same filters', async () => {
        const { data: all } = await GET(`${MGR}/previewReport(reportType='ASSIGNMENTS')`, ADMIN);
        assert.equal(all.rowCount, 7);
        assert.equal(all.columns[0], 'Asset Tag');

        const { data: assigned } = await GET(`${MGR}/previewReport(reportType='ASSIGNMENTS',status='ASSIGNED')`, ADMIN);
        assert.equal(assigned.rowCount, 3);
        assert.match(assigned.filters, /Status: ASSIGNED/);

        await fails(GET(`${MGR}/previewReport(reportType='SALARIES')`, ADMIN), 400);
    });

    it('exports a valid PDF with title, filters and the filtered rows', async () => {
        const { data } = await POST(`${MGR}/exportReport`, { reportType: 'ASSET_INVENTORY', status: 'ASSIGNED' }, ADMIN);
        assert.equal(data.rowCount, 3);
        assert.match(data.downloadUrl, /ReportFiles\(.+\)\/CONTENT$/);
        file = data;

        const response = await GET(data.downloadUrl, { ...ADMIN, responseType: 'arraybuffer' });
        assert.equal(response.headers['content-type'], 'application/pdf');
        const pdf = Buffer.from(response.data).toString('latin1');
        assert.ok(pdf.startsWith('%PDF-1.4'));
        assert.ok(pdf.trimEnd().endsWith('%%EOF'));
        assert.match(pdf, /Hardware Asset Inventory/);
        assert.match(pdf, /Filters: Status: ASSIGNED/);
        assert.match(pdf, /AST-0001/);
        assert.doesNotMatch(pdf, /AST-0003/);                     // AVAILABLE - filtered out
    });

    it('only the requester can download, and only until the link expires (NFR-010)', async () => {
        await fails(GET(file.downloadUrl, MANAGER), 404);

        await cds.run(cds.ql.UPDATE('itam.db.reporting.ReportFiles')
            .set({ EXPIRES_AT: '2020-01-01T00:00:00Z' }).where({ NODE_KEY: file.fileId }));
        await fails(GET(file.downloadUrl, ADMIN), 410);
    });

    it('e-mails the PDF to validated recipients', async () => {
        const mail = await cds.connect.to('mail');
        const sentBefore = mail.sent.length;

        await fails(POST(`${MGR}/emailReport`, { reportType: 'MAINTENANCE', recipients: '' }, ADMIN), 400);
        await fails(POST(`${MGR}/emailReport`, { reportType: 'MAINTENANCE', recipients: 'cfo@itam-demo.com, not-an-email' }, ADMIN), 400);

        const { data } = await POST(`${MGR}/emailReport`,
            { reportType: 'MAINTENANCE', recipients: 'cfo@itam-demo.com; head.procurement@itam-demo.com', requestId: 'req-1' }, ADMIN);
        assert.equal(data.status, 'SIMULATED');
        assert.match(data.message, /not delivered/i);
        assert.equal(mail.sent.length, sentBefore + 1);

        const sent = mail.sent.at(-1);
        assert.deepEqual(sent.to, ['cfo@itam-demo.com', 'head.procurement@itam-demo.com']);
        assert.ok(sent.attachment.content.toString('latin1').startsWith('%PDF'));
        assert.match(sent.attachment.fileName, /^MAINTENANCE_.*\.pdf$/);
    });

    it('never sends the same request twice (NFR-009)', async () => {
        const mail = await cds.connect.to('mail');
        const sentBefore = mail.sent.length;

        const { data } = await POST(`${MGR}/emailReport`,
            { reportType: 'MAINTENANCE', recipients: 'cfo@itam-demo.com', requestId: 'req-1' }, ADMIN);
        assert.equal(data.status, 'DUPLICATE');
        assert.equal(mail.sent.length, sentBefore);
    });

    it('returns and logs a delivery failure; a retry with the same request id works', async () => {
        const mail = await cds.connect.to('mail');
        let failing = true;
        mail.prepend(() => mail.on('send', (req, next) => {
            if (failing) throw new Error('SMTP relay unavailable');
            return next();
        }));

        const { data: failed } = await POST(`${MGR}/emailReport`,
            { reportType: 'ASSET_INVENTORY', recipients: 'cfo@itam-demo.com', requestId: 'req-2' }, ADMIN);
        assert.equal(failed.status, 'FAILED');

        failing = false;
        const { data: retried } = await POST(`${MGR}/emailReport`,
            { reportType: 'ASSET_INVENTORY', recipients: 'cfo@itam-demo.com', requestId: 'req-2' }, ADMIN);
        assert.equal(retried.status, 'SIMULATED');
    });

    it('audits export, download and e-mail without storing report contents (NFR-012)', async () => {
        const { data } = await GET(`${ADM}/ReportLogs?$orderby=REQUESTED_AT`, ADMIN);
        const actions = data.value.map(l => `${l.ACTION}:${l.OUTCOME}`);
        assert.ok(actions.includes('EXPORT:SUCCESS'));
        assert.ok(actions.includes('DOWNLOAD:SUCCESS'));
        assert.ok(actions.includes('EMAIL:SIMULATED'));
        assert.ok(actions.includes('EMAIL:FAILED'));
        assert.ok(data.value.every(l => l.REQUESTED_BY === 'admin@itam-demo.com'));
        assert.ok(!('CONTENT' in data.value[0]));

        await fails(GET(`${MGR}/ReportFiles`, USER), 403);
    });
});

// ==================================================

describe('Asset master data (FR-001, FR-016)', () => {

    let asset;

    it('creates an asset: initial status AVAILABLE and a CREATED ledger entry', async () => {
        asset = await createAsset({
            ASSET_TAG: 'ast-0100', SERIAL_NUMBER: 'TEST-SN-100', ASSET_NAME: 'Dell Latitude 7450',
            CATEGORY_NODE_KEY: LAPTOP, VENDOR_NODE_KEY: DELL, LOCATION: 'Bengaluru',
            PURCHASE_DATE: '2026-01-10', PURCHASE_COST: 99000, STATUS: 'RETIRED'      // STATUS is ignored
        });
        assert.equal(asset.ASSET_TAG, 'AST-0100');
        assert.equal(asset.STATUS, 'AVAILABLE');

        const entries = await history(asset.NODE_KEY);
        assert.deepEqual(entries.map(e => e.ACTION), ['CREATED']);
        assert.equal(entries[0].ACTOR, 'admin@itam-demo.com');
    });

    it('requires a unique asset tag and serial number', async () => {
        const base = { CATEGORY_NODE_KEY: LAPTOP, PURCHASE_DATE: '2026-01-10' };
        await fails(createAsset({ ...base, ASSET_TAG: 'AST-0001', SERIAL_NUMBER: 'NEW-1' }), 409, /Asset tag/);
        await fails(createAsset({ ...base, ASSET_TAG: 'AST-0101', SERIAL_NUMBER: 'DL7440-0001' }), 409, /Serial number/);
    });

    it('requires category and procurement date; inactive categories are rejected', async () => {
        await fails(createAsset({ ASSET_TAG: 'AST-0102', SERIAL_NUMBER: 'N-2', PURCHASE_DATE: '2026-01-10' }), 400);   // @mandatory
        await fails(createAsset({ ASSET_TAG: 'AST-0102', SERIAL_NUMBER: 'N-2', CATEGORY_NODE_KEY: LAPTOP }), 400);
        await fails(createAsset({ ASSET_TAG: 'AST-0102', SERIAL_NUMBER: 'N-2', CATEGORY_NODE_KEY: LEGACY, PURCHASE_DATE: '2026-01-10' }), 400, /inactive/);
        await fails(createAsset({ ASSET_TAG: 'AST-0102', SERIAL_NUMBER: 'N-2', CATEGORY_NODE_KEY: LAPTOP, PURCHASE_DATE: '2099-01-01' }), 400, /future/);
        await fails(createAsset({ ASSET_TAG: 'AST-0102', SERIAL_NUMBER: 'N-2', CATEGORY_NODE_KEY: LAPTOP, PURCHASE_DATE: '2026-01-10', VENDOR_NODE_KEY: OLDSUP }), 400, /inactive/);
    });

    it('assets are never physically deleted (FR-011)', async () => {
        await fails(DELETE(active('Assets', asset.NODE_KEY), ADMIN), 405);
    });
});

// ==================================================

describe('Asset lifecycle (FR-003 .. FR-012)', () => {

    let key;

    before(async () => {
        key = (await createAsset({
            ASSET_TAG: 'AST-0200', SERIAL_NUMBER: 'LIFE-200', ASSET_NAME: 'Lenovo ThinkPad T16',
            CATEGORY_NODE_KEY: LAPTOP, PURCHASE_DATE: '2026-01-10', PURCHASE_COST: 91000
        })).NODE_KEY;
    });

    it('distribution date cannot be earlier than the procurement date (FR-004)', async () => {
        await fails(POST(action(key, 'assignAsset'), { employee: RAVI, distributionDate: '2026-01-05' }, ADMIN), 400, /procurement date/);
    });

    it('only active employees can receive assets', async () => {
        await fails(POST(action(key, 'assignAsset'), { employee: ARJUN, distributionDate: '2026-02-01' }, ADMIN), 400, /not an active employee/);
        await fails(POST(action(key, 'assignAsset'), { distributionDate: '2026-02-01' }, ADMIN), 400);
    });

    it('assigns an AVAILABLE asset (FR-003)', async () => {
        await POST(action(key, 'assignAsset'),
            { employee: RAVI, distributionDate: '2026-02-01', expectedReturnDate: '2027-01-31', remarks: 'New laptop' }, ADMIN);

        const asset = await getAsset(key);
        assert.equal(asset.STATUS, 'ASSIGNED');
        assert.equal(asset.CURRENT_HOLDER_NODE_KEY, RAVI);
        assert.equal(asset.FIRST_DISTRIBUTION_DATE, '2026-02-01');

        await fails(POST(action(key, 'assignAsset'), { employee: PRIYA }, ADMIN), 409);
    });

    it('rejects retire, archive and maintenance while assigned (FR-010, FR-012)', async () => {
        await fails(POST(action(key, 'retireAsset'), { reason: 'old' }, ADMIN), 409, /return it first/);
        await fails(POST(action(key, 'archiveAsset'), { reason: 'old' }, ADMIN), 409, /after it is returned/);
        await fails(POST(action(key, 'sendToMaintenance'), { vendor: FIXIT, issue: 'x' }, ADMIN), 409);
    });

    it('procurement date cannot be moved after the first distribution (FR-004)', async () => {
        await fails(edit('Assets', key, { PURCHASE_DATE: '2026-03-01' }), 400, /first distribution/);
    });

    it('transfers an assigned asset: old assignment closed, new one opened (FR-005)', async () => {
        await fails(POST(action(key, 'transferAsset'), { toEmployee: RAVI, transferDate: '2026-03-01' }, ADMIN), 400, /already assigned/);
        await fails(POST(action(key, 'transferAsset'), { toEmployee: PRIYA, transferDate: '2026-01-20' }, ADMIN), 400);

        await POST(action(key, 'transferAsset'), { toEmployee: PRIYA, transferDate: '2026-03-01' }, ADMIN);

        const asset = await getAsset(key);
        assert.equal(asset.CURRENT_HOLDER_NODE_KEY, PRIYA);

        const { data } = await GET(`${ADM}/Assignments?$filter=ASSET_NODE_KEY eq ${key}&$orderby=ASSIGNED_DATE`, ADMIN);
        assert.deepEqual(data.value.map(a => [a.EMPLOYEE_NODE_KEY, a.ASSIGNMENT_STATUS, a.ACTUAL_RETURN_DATE]), [
            [RAVI, 'TRANSFERRED', '2026-03-01'],
            [PRIYA, 'ACTIVE', null]
        ]);
    });

    it('returns an assigned asset (FR-006)', async () => {
        await fails(POST(action(key, 'returnAsset'), { returnDate: '2026-02-15' }, ADMIN), 400);
        await POST(action(key, 'returnAsset'), { returnDate: '2026-04-01', remarks: 'Project ended' }, ADMIN);

        const asset = await getAsset(key);
        assert.equal(asset.STATUS, 'AVAILABLE');
        assert.equal(asset.CURRENT_HOLDER_NODE_KEY, null);
        assert.equal(asset.FIRST_DISTRIBUTION_DATE, '2026-02-01');    // kept
    });

    it('sends to maintenance and completes it (FR-008, FR-009)', async () => {
        await fails(POST(action(key, 'sendToMaintenance'), { issue: 'Screen flicker', reportedDate: '2026-04-05' }, ADMIN), 400);   // vendor is @mandatory
        await fails(POST(action(key, 'sendToMaintenance'), { vendor: OLDSUP, issue: 'Screen flicker', reportedDate: '2026-04-05' }, ADMIN), 400, /inactive/);
        await fails(POST(action(key, 'sendToMaintenance'), { vendor: FIXIT, issue: 'Screen flicker', type: 'PAINT' }, ADMIN), 400);

        await POST(action(key, 'sendToMaintenance'), { vendor: FIXIT, type: 'REPAIR', issue: 'Screen flicker', reportedDate: '2026-04-05' }, ADMIN);
        assert.equal((await getAsset(key)).STATUS, 'MAINTENANCE');
        await fails(POST(action(key, 'assignAsset'), { employee: RAVI }, ADMIN), 409);

        await fails(POST(action(key, 'completeMaintenance'), { completedDate: '2026-04-01' }, ADMIN), 400);
        await POST(action(key, 'completeMaintenance'), { completedDate: '2026-04-12', resolution: 'Display cable replaced' }, ADMIN);
        assert.equal((await getAsset(key)).STATUS, 'AVAILABLE');

        const { data } = await GET(`${ADM}/Maintenance?$filter=ASSET_NODE_KEY eq ${key}`, ADMIN);
        assert.deepEqual(data.value.map(m => [m.STATUS, m.COMPLETED_DATE]), [['COMPLETED', '2026-04-12']]);
    });

    it('retires an asset with a reason (FR-010)', async () => {
        await fails(POST(action(key, 'archiveAsset'), { reason: 'x' }, ADMIN), 409, /Only RETIRED/);
        await fails(POST(action(key, 'retireAsset'), { retiredDate: '2026-05-01' }, ADMIN), 400);   // reason is @mandatory

        await POST(action(key, 'retireAsset'),
            { reason: 'Liquid damage', retiredDate: '2026-05-01', condition: 'Not repairable', disposalMethod: 'RECYCLE' }, ADMIN);

        const asset = await getAsset(key);
        assert.deepEqual([asset.STATUS, asset.RETIRED_DATE, asset.DISPOSAL_METHOD], ['RETIRED', '2026-05-01', 'RECYCLE']);
    });

    it('archives a retired asset without deleting it (FR-011)', async () => {
        await POST(action(key, 'archiveAsset'), { reason: 'Disposed via e-waste partner', complianceReference: 'EW-2026-200' }, ADMIN);

        const asset = await getAsset(key);
        assert.equal(asset.STATUS, 'ARCHIVED');

        const { data } = await GET(`${ADM}/Archive?$filter=ASSET_NODE_KEY eq ${key}`, ADMIN);
        assert.equal(data.value[0].DISPOSAL_CERT_NO, 'EW-2026-200');
        assert.equal(data.value[0].ARCHIVED_BY, 'admin@itam-demo.com');

        await fails(POST(`${active('Assets', key)}/AssetAdminService.draftEdit`, { PreserveChanges: true }, ADMIN), 409, /archived/);
    });

    it('records every step in the ownership ledger (FR-007)', async () => {
        const entries = await history(key);
        assert.deepEqual(entries.map(e => e.ACTION), [
            'CREATED', 'ASSIGNED', 'TRANSFERRED', 'RETURNED',
            'MAINTENANCE_STARTED', 'MAINTENANCE_COMPLETED', 'RETIRED', 'ARCHIVED'
        ]);
        const transfer = entries.find(e => e.ACTION === 'TRANSFERRED');
        assert.deepEqual([transfer.FROM_EMPLOYEE_NODE_KEY, transfer.TO_EMPLOYEE_NODE_KEY], [RAVI, PRIYA]);
        assert.deepEqual(entries.map(e => e.TO_STATUS).at(-1), 'ARCHIVED');
    });

    it('ledger and archive entries are immutable - via OData and on the database (FR-007)', async () => {
        const [entry] = await history(key);
        await fails(PATCH(`${ADM}/History(${entry.NODE_KEY})`, { REMARKS: 'changed' }, ADMIN), 405);
        await fails(DELETE(`${ADM}/History(${entry.NODE_KEY})`, ADMIN), 405);

        await assert.rejects(cds.run(cds.ql.UPDATE('itam.db.transaction.OwnershipLedgers').set({ REMARKS: 'x' }).where({ NODE_KEY: entry.NODE_KEY })), /immutable/);
        await assert.rejects(cds.run(cds.ql.DELETE.from('itam.db.transaction.ArchiveRecords').where({ ASSET_NODE_KEY: key })), /immutable/);
    });

    it('rejects transition dates before the last lifecycle event', async () => {
        await fails(POST(action(A3, 'assignAsset'), { employee: RAVI, distributionDate: '2025-02-01' }, ADMIN), 400, /procurement date/);
        await fails(POST(action(A3, 'assignAsset'), { employee: RAVI, distributionDate: '2099-01-01' }, ADMIN), 400, /future/);
    });
});

// ==================================================

describe('Employees, categories, vendors (FR-016, FR-017)', () => {

    it('an employee holding assets cannot be deactivated (offboarding)', async () => {
        await fails(edit('Employees', RAVI, { STATUS: 'INACTIVE' }), 409, /AST-0001/);
    });

    it('validates employee e-mails', async () => {
        await fails(edit('Employees', PRIYA, { EMAIL: 'not-an-email' }), 400);
        await fails(edit('Employees', PRIYA, { EMAIL: 'Ravi.Kumar@itam-demo.com' }), 409);
        const updated = await edit('Employees', PRIYA, { EMAIL: ' Priya.Nair@ITAM-demo.com ' });
        assert.equal(updated.EMAIL, 'priya.nair@itam-demo.com');
    });

    it('categories need a positive lifespan and cannot be deleted while used', async () => {
        await fails(edit('Categories', LAPTOP, { LIFESPAN_MONTHS: 0 }), 400);
        await fails(DELETE(active('Categories', LAPTOP), ADMIN), 409);
    });

    it('vendors cannot be deleted while used', async () => {
        await fails(DELETE(active('Vendors', DELL), ADMIN), 409);
    });

    it('records of the seed data stay consistent', async () => {
        const asset = await getAsset(A1);
        assert.equal(asset.CURRENT_HOLDER_NODE_KEY, RAVI);
    });
});

describe('Department-scoped Manager and User workflows (FR-027/028)', () => {
    const VIKRAM = '20000000-0000-4000-8000-000000000002';

    it('allows Manager to assign and return their departmental available asset', async () => {
        const { data: assigned } = await POST(`${MGR}/assignAsset`, {
            asset: A3, employee: VIKRAM, remarks: 'Manager issue'
        }, MANAGER);
        assert.match(assigned.value, /assigned/i);
        const { data: asset } = await GET(`${MGR}/Assets(${A3})`, MANAGER);
        assert.equal(asset.STATUS, 'ASSIGNED');
        assert.equal(asset.CURRENT_HOLDER_NODE_KEY, VIKRAM);
        await fails(POST(`${MGR}/transferAsset`, {
            asset: A3, toEmployee: RAVI, remarks: 'Cross-department'
        }, MANAGER), 403);
        const { data: returned } = await POST(`${MGR}/returnAsset`, {
            asset: A3, remarks: 'Returned to department stock'
        }, MANAGER);
        assert.match(returned.value, /returned/i);
        const { data: available } = await GET(`${MGR}/Assets(${A3})`, MANAGER);
        assert.equal(available.STATUS, 'AVAILABLE');
    });

    it('permits users to request return of only their own assigned assets', async () => {
        await fails(POST(`${USR}/submitReturnRequest`, {
            asset: A3, description: 'Not mine'
        }, USER), 403);
        const { data: requestId } = await POST(`${USR}/submitReturnRequest`, {
            asset: A1, description: 'Request collection'
        }, USER);
        assert.ok(requestId.value);
        await fails(POST(`${USR}/submitReturnRequest`, {
            asset: A1, description: 'Duplicate'
        }, USER), 409);
        await fails(POST(`${MGR}/reviewAssetRequest`, {
            requestId: requestId.value, approve: true, note: 'Outside department'
        }, MANAGER), 403);
        const { data: status } = await POST(`${MGR}/reviewAssetRequest`, {
            requestId: requestId.value, approve: true, note: 'Approved for collection'
        }, ADMIN);
        assert.equal(status.value, 'APPROVED');
    });

    it('rejects maintenance requests for other users assets and requires a description', async () => {
        await fails(POST(`${USR}/submitMaintenanceRequest`, {
            asset: A1, description: ''
        }, USER), 400);
        await fails(POST(`${USR}/submitMaintenanceRequest`, {
            asset: A3, description: 'Wrong owner'
        }, USER), 403);
    });
});

describe('Department management, assignment edits and maintenance CRUD', () => {
    const A5 = '40000000-0000-4000-8000-000000000005';
    const ENGINEERING = '21000000-0000-4000-8000-000000000003';

    it('exposes departments and prevents deleting referenced departments', async () => {
        const { data } = await GET(`${ADM}/Departments`, ADMIN);
        assert.equal(data.value.length, 5);
        assert.ok(data.value.some(d => d.NAME === 'Engineering'));
        await fails(DELETE(active('Departments', ENGINEERING), ADMIN), 409);
    });

    it('permits PATCH of active assignment dates but rejects status tampering', async () => {
        const { data } = await GET(`${ADM}/Assignments?$filter=ASSET_NODE_KEY eq ${A1}`, ADMIN);
        const activeAssignment = data.value.find(a => a.ASSIGNMENT_STATUS === 'ACTIVE');
        assert.ok(activeAssignment);
        await PATCH(`${ADM}/Assignments(${activeAssignment.NODE_KEY})`, {
            EXPECTED_RETURN_DATE: '2028-12-31'
        }, ADMIN);
        await fails(PATCH(`${ADM}/Assignments(${activeAssignment.NODE_KEY})`, {
            ASSIGNMENT_STATUS: 'RETURNED'
        }, ADMIN), 403);
        await fails(PATCH(`${MGR}/Assignments(${activeAssignment.NODE_KEY})`, {
            REMARKS: 'Not my team'
        }, MANAGER), 403);
    });

    it('creates and updates maintenance without bypassing lifecycle actions', async () => {
        const reportedDate = new Date().toISOString().slice(0, 10);
        const { data: maintenance } = await POST(`${ADM}/Maintenance`, {
            ASSET_NODE_KEY: A5,
            SERVICE_VENDOR_NODE_KEY: FIXIT,
            TYPE: 'REPAIR',
            DESCRIPTION: 'Display malfunction',
            REPORTED_DATE: reportedDate,
            COST: 120.50,
            COVERED_BY_WARRANTY: true
        }, ADMIN);
        assert.ok(maintenance.NODE_KEY);
        assert.equal((await getAsset(A5)).STATUS, 'MAINTENANCE');
        await PATCH(`${ADM}/Maintenance(${maintenance.NODE_KEY})`, {
            COST: 150.00, NEXT_DUE_DATE: '2027-11-01'
        }, ADMIN);
        await fails(PATCH(`${ADM}/Maintenance(${maintenance.NODE_KEY})`, {
            STATUS: 'COMPLETED'
        }, ADMIN), 403);
        const { data: result } = await POST(action(A5, 'completeMaintenance'), {
            completedDate: reportedDate, resolution: 'Fixed'
        }, ADMIN);
        assert.match(result.value, /completed/i);
        assert.equal((await getAsset(A5)).STATUS, 'AVAILABLE');
    });
});

describe('Department reporting and self-profile isolation', () => {
    const PROCUREMENT = '21000000-0000-4000-8000-000000000002';
    const ENGINEERING = '21000000-0000-4000-8000-000000000003';

    it('scopes Manager dashboard and report to procurement assets', async () => {
        const { data: mgr } = await GET(`${MGR}/getDashboard()`, MANAGER);
        assert.equal(mgr.totalAssets, 2);
        const { data: report } = await GET(`${MGR}/previewReport(reportType='ASSET_INVENTORY')`, MANAGER);
        assert.equal(report.rowCount, 2);
        await fails(GET(`${MGR}/getDashboard(department=${ENGINEERING})`, MANAGER), 403);
        const { data: admin } = await GET(`${MGR}/getDashboard(department=${PROCUREMENT})`, ADMIN);
        assert.equal(admin.totalAssets, 2);
    });

    it('lets User read only their own employee profile', async () => {
        const { data } = await GET(`${USR}/Employees`, USER);
        assert.equal(data.value.length, 1);
        assert.equal(data.value[0].EMAIL, 'ravi.kumar@itam-demo.com');
        await fails(PATCH(`${USR}/Employees(${RAVI})`, { LOCATION: 'Outside' }, USER), 405);
    });
});
