import cds from '@sap/cds';
import { randomUUID } from 'crypto';
import { today, isDate, EMAIL_PATTERN, loginOf, boundKey } from './lib/util.js';

const { INSERT, SELECT, UPDATE } = cds.ql;

const MAINTENANCE_TYPES = ['REPAIR', 'SERVICE', 'UPGRADE'];
const DISPOSAL_METHODS = ['RECYCLE', 'DONATE', 'RESELL', 'DESTROY', 'RETAIN'];

export default cds.service.impl(async function () {

    const { Assets, Employees, Departments, Categories, Vendors, Assignments, Maintenance } = this.entities;

    // database entities (the lifecycle writes go straight to the tables)
    const db = {
        ...cds.entities('itam.db.master'),
        ...cds.entities('itam.db.transaction')
    };

    // ==================================================
    // IMMUTABLE LEDGER (FR-007) + NO PHYSICAL DELETE OF ARCHIVE RECORDS (FR-011)
    // Guarded on the database service, so no service or custom code can change them.
    // ==================================================

    const dbService = await cds.connect.to('db');
    if (!dbService._itamGuard) {
        dbService._itamGuard = true;
        dbService.before(['UPDATE', 'DELETE', 'UPSERT'], [db.OwnershipLedgers, db.ArchiveRecords], (req) => {
            req.reject(405, `${req.target.name.split('.').pop()} entries are immutable and cannot be changed or deleted.`);
        });
    }

    // ==================================================
    // HELPERS
    // ==================================================

    async function loadAsset(req) {
        const asset = await SELECT.one.from(db.Assets).where({ NODE_KEY: boundKey(req) });
        if (!asset) req.reject(404, 'Asset not found.');
        return asset;
    }

    // a transition can not be dated before the last ledger entry or in the future
    async function checkTransitionDate(req, asset, date, label) {

        if (!isDate(date)) {
            req.reject(400, `${label} is not a valid date.`);
        }
        if (date > today()) {
            req.reject(400, `${label} ${date} cannot be in the future.`);
        }

        const last = await SELECT.one.from(db.OwnershipLedgers)
            .columns('max(TRANSITION_DATE) as d')
            .where({ ASSET_NODE_KEY: asset.NODE_KEY });

        if (last?.d && date < last.d) {
            req.reject(400, `${label} ${date} is before the last lifecycle event of ${asset.ASSET_TAG} (${last.d}).`);
        }
    }

    async function activeEmployee(req, key, label = 'Employee') {
        if (!key) req.reject(400, `Please select the ${label.toLowerCase()}.`);
        const employee = await SELECT.one.from(db.Employees).where({ NODE_KEY: key });
        if (!employee) req.reject(400, `${label} not found.`);
        if (employee.STATUS !== 'ACTIVE') {
            req.reject(400, `${employee.FULL_NAME} is not an active employee.`);
        }
        return employee;
    }

    async function activeAssignment(asset) {
        return SELECT.one.from(db.AssetAssignments)
            .where({ ASSET_NODE_KEY: asset.NODE_KEY, ASSIGNMENT_STATUS: 'ACTIVE' });
    }

    // one row in the ownership / lifecycle ledger
    async function writeLedger(req, asset, entry) {
        await INSERT.into(db.OwnershipLedgers).entries({
            NODE_KEY: randomUUID(),
            ASSET_NODE_KEY: asset.NODE_KEY,
            FROM_STATUS: asset.STATUS ?? null,
            ACTOR: loginOf(req),
            RECORDED_AT: new Date().toISOString(),
            ...entry
        });
    }

    async function setAsset(asset, data) {
        await UPDATE(db.Assets).set(data).where({ NODE_KEY: asset.NODE_KEY });
    }

    const required = (req, value, message) => {
        if (value === undefined || value === null || String(value).trim() === '') req.reject(400, message);
    };

    // ==================================================
    // ASSET MASTER (FR-001, FR-004, FR-016)
    // ==================================================

    this.before('NEW', Assets.drafts, (req) => {
        req.data.STATUS = 'AVAILABLE';
        req.data.CURRENCY_CODE ??= 'INR';
    });

    this.before(['CREATE', 'UPDATE'], Assets, async (req) => {

        const data = req.data;
        const old = req.event === 'UPDATE'
            ? await SELECT.one.from(db.Assets).where({ NODE_KEY: data.NODE_KEY })
            : null;

        if (old?.STATUS === 'ARCHIVED') {
            req.reject(409, `Asset ${old.ASSET_TAG} is archived and read-only.`);
        }

        if (data.ASSET_TAG !== undefined) data.ASSET_TAG = data.ASSET_TAG?.trim().toUpperCase();
        if (data.SERIAL_NUMBER !== undefined) data.SERIAL_NUMBER = data.SERIAL_NUMBER?.trim();

        const asset = { ...old, ...data };

        required(req, asset.ASSET_TAG, 'Asset tag is mandatory.');
        required(req, asset.SERIAL_NUMBER, 'Serial number is mandatory.');
        required(req, asset.CATEGORY_NODE_KEY, 'Category is mandatory.');
        required(req, asset.PURCHASE_DATE, 'Procurement date is mandatory.');

        if (asset.PURCHASE_DATE > today()) {
            req.reject(400, 'Procurement date cannot be in the future.');
        }
        if (asset.PURCHASE_COST !== null && asset.PURCHASE_COST !== undefined && Number(asset.PURCHASE_COST) < 0) {
            req.reject(400, 'Purchase cost cannot be negative.');
        }
        if (asset.WARRANTY_END && asset.WARRANTY_END < asset.PURCHASE_DATE) {
            req.reject(400, 'Warranty end cannot be before the procurement date.');
        }

        // FR-004: the asset can not have been handed out before it was bought
        if (old?.FIRST_DISTRIBUTION_DATE && asset.PURCHASE_DATE > old.FIRST_DISTRIBUTION_DATE) {
            req.reject(400, `Procurement date cannot be after the first distribution date (${old.FIRST_DISTRIBUTION_DATE}).`);
        }

        // unique asset tag and serial number
        const others = { NODE_KEY: { '!=': asset.NODE_KEY ?? '' } };
        if (await SELECT.one.from(db.Assets).where({ ASSET_TAG: asset.ASSET_TAG, ...others })) {
            req.reject(409, `Asset tag ${asset.ASSET_TAG} already exists.`);
        }
        if (await SELECT.one.from(db.Assets).where({ SERIAL_NUMBER: asset.SERIAL_NUMBER, ...others })) {
            req.reject(409, `Serial number ${asset.SERIAL_NUMBER} already exists.`);
        }

        // FR-016: inactive categories are not available for new assets (or a category change)
        if (!old || old.CATEGORY_NODE_KEY !== asset.CATEGORY_NODE_KEY) {
            const category = await SELECT.one.from(db.AssetCategories).where({ NODE_KEY: asset.CATEGORY_NODE_KEY });
            if (!category) req.reject(400, 'Category not found.');
            if (!category.IS_ACTIVE) req.reject(400, `Category ${category.NAME} is inactive.`);
        }

        if (asset.VENDOR_NODE_KEY && (!old || old.VENDOR_NODE_KEY !== asset.VENDOR_NODE_KEY)) {
            const vendor = await SELECT.one.from(db.Vendors).where({ NODE_KEY: asset.VENDOR_NODE_KEY });
            if (!vendor) req.reject(400, 'Vendor not found.');
            if (!vendor.IS_ACTIVE) req.reject(400, `Vendor ${vendor.NAME} is inactive.`);
        }

        // lifecycle fields are changed by the actions only
        if (req.event === 'CREATE') {
            data.STATUS = 'AVAILABLE';
            data.CURRENT_HOLDER_NODE_KEY = null;
            data.FIRST_DISTRIBUTION_DATE = null;
        }
    });

    this.after('CREATE', Assets, async (result, req) => {
        // draft activation does not always pass the created row - fall back to the request data
        const asset = result?.NODE_KEY ? result : req.data;
        await writeLedger(req, { ...asset, STATUS: null }, {
            ACTION: 'CREATED',
            TRANSITION_DATE: asset.PURCHASE_DATE,
            TO_STATUS: 'AVAILABLE',
            REMARKS: 'Asset registered'
        });
    });

    this.before('EDIT', Assets, async (req) => {
        const asset = await loadAsset(req);
        if (asset.STATUS === 'ARCHIVED') {
            req.reject(409, `Asset ${asset.ASSET_TAG} is archived and read-only.`);
        }
    });

    // FR-011: no physical delete - retire and archive instead
    this.before('DELETE', Assets, (req) => {
        req.reject(405, 'Assets cannot be deleted. Retire and archive the asset instead.');
    });

    // ==================================================
    // ASSIGN (FR-003, FR-004)
    // ==================================================

    this.on('assignAsset', Assets, async (req) => {

        const asset = await loadAsset(req);
        const { employee: employeeKey, expectedReturnDate, remarks } = req.data;
        const date = req.data.distributionDate || today();

        if (asset.STATUS !== 'AVAILABLE') {
            return req.reject(409, `Only AVAILABLE assets can be assigned (${asset.ASSET_TAG} is ${asset.STATUS}).`);
        }

        const employee = await activeEmployee(req, employeeKey);

        if (date < asset.PURCHASE_DATE) {
            return req.reject(400, `Distribution date ${date} cannot be earlier than the procurement date ${asset.PURCHASE_DATE}.`);
        }
        await checkTransitionDate(req, asset, date, 'Distribution date');

        if (expectedReturnDate && expectedReturnDate < date) {
            return req.reject(400, 'Expected return date cannot be before the distribution date.');
        }

        await INSERT.into(db.AssetAssignments).entries({
            NODE_KEY: randomUUID(),
            ASSET_NODE_KEY: asset.NODE_KEY,
            EMPLOYEE_NODE_KEY: employee.NODE_KEY,
            ASSIGNED_BY_NODE_KEY: (await SELECT.one.from(db.Employees).columns('NODE_KEY').where({ EMAIL: loginOf(req) }))?.NODE_KEY ?? null,
            ASSIGNED_DATE: date,
            EXPECTED_RETURN_DATE: expectedReturnDate || null,
            ASSIGNMENT_STATUS: 'ACTIVE',
            REMARKS: remarks || null
        });

        await setAsset(asset, {
            STATUS: 'ASSIGNED',
            CURRENT_HOLDER_NODE_KEY: employee.NODE_KEY,
            FIRST_DISTRIBUTION_DATE: asset.FIRST_DISTRIBUTION_DATE ?? date
        });

        await writeLedger(req, asset, {
            ACTION: 'ASSIGNED',
            TRANSITION_DATE: date,
            TO_STATUS: 'ASSIGNED',
            TO_EMPLOYEE_NODE_KEY: employee.NODE_KEY,
            REMARKS: remarks || null
        });

        req.notify(`${asset.ASSET_TAG} assigned to ${employee.FULL_NAME}.`);
        return `${asset.ASSET_TAG} assigned to ${employee.FULL_NAME}`;
    });

    // ==================================================
    // TRANSFER (FR-005)
    // ==================================================

    this.on('transferAsset', Assets, async (req) => {

        const asset = await loadAsset(req);
        const { toEmployee, remarks } = req.data;
        const date = req.data.transferDate || today();

        if (asset.STATUS !== 'ASSIGNED') {
            return req.reject(409, `Only ASSIGNED assets can be transferred (${asset.ASSET_TAG} is ${asset.STATUS}).`);
        }

        const assignment = await activeAssignment(asset);
        const employee = await activeEmployee(req, toEmployee, 'New employee');

        if (employee.NODE_KEY === assignment.EMPLOYEE_NODE_KEY) {
            return req.reject(400, `${asset.ASSET_TAG} is already assigned to ${employee.FULL_NAME}.`);
        }
        if (date < assignment.ASSIGNED_DATE) {
            return req.reject(400, `Transfer date ${date} cannot be before the current assignment date ${assignment.ASSIGNED_DATE}.`);
        }
        await checkTransitionDate(req, asset, date, 'Transfer date');

        // close the old possession period, open a new one
        await UPDATE(db.AssetAssignments)
            .set({ ACTUAL_RETURN_DATE: date, ASSIGNMENT_STATUS: 'TRANSFERRED' })
            .where({ NODE_KEY: assignment.NODE_KEY });

        await INSERT.into(db.AssetAssignments).entries({
            NODE_KEY: randomUUID(),
            ASSET_NODE_KEY: asset.NODE_KEY,
            EMPLOYEE_NODE_KEY: employee.NODE_KEY,
            ASSIGNED_BY_NODE_KEY: (await SELECT.one.from(db.Employees).columns('NODE_KEY').where({ EMAIL: loginOf(req) }))?.NODE_KEY ?? null,
            ASSIGNED_DATE: date,
            EXPECTED_RETURN_DATE: assignment.EXPECTED_RETURN_DATE && assignment.EXPECTED_RETURN_DATE >= date
                ? assignment.EXPECTED_RETURN_DATE : null,
            ASSIGNMENT_STATUS: 'ACTIVE',
            REMARKS: remarks || null
        });

        await setAsset(asset, { CURRENT_HOLDER_NODE_KEY: employee.NODE_KEY });

        await writeLedger(req, asset, {
            ACTION: 'TRANSFERRED',
            TRANSITION_DATE: date,
            TO_STATUS: 'ASSIGNED',
            FROM_EMPLOYEE_NODE_KEY: assignment.EMPLOYEE_NODE_KEY,
            TO_EMPLOYEE_NODE_KEY: employee.NODE_KEY,
            REMARKS: remarks || null
        });

        req.notify(`${asset.ASSET_TAG} transferred to ${employee.FULL_NAME}.`);
        return `${asset.ASSET_TAG} transferred to ${employee.FULL_NAME}`;
    });

    // ==================================================
    // RETURN (FR-006)
    // ==================================================

    this.on('returnAsset', Assets, async (req) => {

        const asset = await loadAsset(req);
        const { remarks } = req.data;
        const date = req.data.returnDate || today();

        if (asset.STATUS !== 'ASSIGNED') {
            return req.reject(409, `Only ASSIGNED assets can be returned (${asset.ASSET_TAG} is ${asset.STATUS}).`);
        }

        const assignment = await activeAssignment(asset);
        if (date < assignment.ASSIGNED_DATE) {
            return req.reject(400, `Return date ${date} cannot be before the assignment date ${assignment.ASSIGNED_DATE}.`);
        }
        await checkTransitionDate(req, asset, date, 'Return date');

        await UPDATE(db.AssetAssignments)
            .set({ ACTUAL_RETURN_DATE: date, ASSIGNMENT_STATUS: 'RETURNED', REMARKS: remarks || assignment.REMARKS })
            .where({ NODE_KEY: assignment.NODE_KEY });

        await setAsset(asset, { STATUS: 'AVAILABLE', CURRENT_HOLDER_NODE_KEY: null });

        await writeLedger(req, asset, {
            ACTION: 'RETURNED',
            TRANSITION_DATE: date,
            TO_STATUS: 'AVAILABLE',
            FROM_EMPLOYEE_NODE_KEY: assignment.EMPLOYEE_NODE_KEY,
            REMARKS: remarks || null
        });

        req.notify(`${asset.ASSET_TAG} returned - now AVAILABLE.`);
        return `${asset.ASSET_TAG} returned`;
    });

    // ==================================================
    // MAINTENANCE (FR-008, FR-009)
    // ==================================================

    this.on('sendToMaintenance', Assets, async (req) => {

        const asset = await loadAsset(req);
        const { vendor: vendorKey, issue } = req.data;
        const type = req.data.type || 'REPAIR';
        const date = req.data.reportedDate || today();

        if (asset.STATUS === 'ASSIGNED') {
            return req.reject(409, `${asset.ASSET_TAG} is assigned - return it before sending it to maintenance.`);
        }
        if (asset.STATUS !== 'AVAILABLE') {
            return req.reject(409, `Only AVAILABLE assets can be sent to maintenance (${asset.ASSET_TAG} is ${asset.STATUS}).`);
        }
        if (!MAINTENANCE_TYPES.includes(type)) {
            return req.reject(400, `Maintenance type must be one of ${MAINTENANCE_TYPES.join(', ')}.`);
        }
        required(req, issue, 'Please describe the issue.');
        required(req, vendorKey, 'Please select the service vendor.');

        const vendor = await SELECT.one.from(db.Vendors).where({ NODE_KEY: vendorKey });
        if (!vendor) return req.reject(400, 'Vendor not found.');
        if (!vendor.IS_ACTIVE) return req.reject(400, `Vendor ${vendor.NAME} is inactive.`);

        await checkTransitionDate(req, asset, date, 'Reported date');

        await INSERT.into(db.MaintenanceRecords).entries({
            NODE_KEY: randomUUID(),
            ASSET_NODE_KEY: asset.NODE_KEY,
            SERVICE_VENDOR_NODE_KEY: vendor.NODE_KEY,
            TYPE: type,
            DESCRIPTION: issue,
            REPORTED_BY_NODE_KEY: (await SELECT.one.from(db.Employees).columns('NODE_KEY').where({ EMAIL: loginOf(req) }))?.NODE_KEY ?? null,
            REPORTED_DATE: date,
            STATUS: 'OPEN'
        });

        await setAsset(asset, { STATUS: 'MAINTENANCE' });

        await writeLedger(req, asset, {
            ACTION: 'MAINTENANCE_STARTED',
            TRANSITION_DATE: date,
            TO_STATUS: 'MAINTENANCE',
            REMARKS: `${type}: ${issue} (${vendor.NAME})`.slice(0, 255)
        });

        req.notify(`${asset.ASSET_TAG} sent to ${vendor.NAME} for maintenance.`);
        return `${asset.ASSET_TAG} sent to maintenance`;
    });

    this.on('completeMaintenance', Assets, async (req) => {

        const asset = await loadAsset(req);
        const { resolution } = req.data;
        const date = req.data.completedDate || today();

        if (asset.STATUS !== 'MAINTENANCE') {
            return req.reject(409, `${asset.ASSET_TAG} is not in maintenance (status ${asset.STATUS}).`);
        }

        const record = await SELECT.one.from(db.MaintenanceRecords)
            .where({ ASSET_NODE_KEY: asset.NODE_KEY, STATUS: 'OPEN' });
        if (!record) return req.reject(409, `No open maintenance record for ${asset.ASSET_TAG}.`);

        if (date < record.REPORTED_DATE) {
            return req.reject(400, `Completion date ${date} cannot be before the reported date ${record.REPORTED_DATE}.`);
        }
        await checkTransitionDate(req, asset, date, 'Completion date');

        await UPDATE(db.MaintenanceRecords)
            .set({ STATUS: 'COMPLETED', COMPLETED_DATE: date, OUTCOME: resolution || null })
            .where({ NODE_KEY: record.NODE_KEY });

        await setAsset(asset, { STATUS: 'AVAILABLE' });

        await writeLedger(req, asset, {
            ACTION: 'MAINTENANCE_COMPLETED',
            TRANSITION_DATE: date,
            TO_STATUS: 'AVAILABLE',
            REMARKS: resolution || null
        });

        req.notify(`Maintenance of ${asset.ASSET_TAG} completed - now AVAILABLE.`);
        return `Maintenance of ${asset.ASSET_TAG} completed`;
    });

    // ==================================================
    // RETIRE (FR-010)
    // ==================================================

    this.on('retireAsset', Assets, async (req) => {

        const asset = await loadAsset(req);
        const { reason, condition } = req.data;
        const disposalMethod = req.data.disposalMethod || null;
        const date = req.data.retiredDate || today();

        if (asset.STATUS === 'ASSIGNED') {
            return req.reject(409, `${asset.ASSET_TAG} is assigned and cannot be retired - return it first.`);
        }
        if (asset.STATUS === 'MAINTENANCE') {
            return req.reject(409, `${asset.ASSET_TAG} is in maintenance - complete the maintenance first.`);
        }
        if (asset.STATUS !== 'AVAILABLE') {
            return req.reject(409, `${asset.ASSET_TAG} is already ${asset.STATUS}.`);
        }
        required(req, reason, 'A retirement reason is required.');
        if (disposalMethod && !DISPOSAL_METHODS.includes(disposalMethod)) {
            return req.reject(400, `Disposal method must be one of ${DISPOSAL_METHODS.join(', ')}.`);
        }
        await checkTransitionDate(req, asset, date, 'Retirement date');

        await setAsset(asset, {
            STATUS: 'RETIRED',
            RETIRED_DATE: date,
            RETIREMENT_REASON: reason,
            CONDITION: condition || null,
            DISPOSAL_METHOD: disposalMethod
        });

        await writeLedger(req, asset, {
            ACTION: 'RETIRED',
            TRANSITION_DATE: date,
            TO_STATUS: 'RETIRED',
            REMARKS: reason
        });

        req.notify(`${asset.ASSET_TAG} retired.`);
        return `${asset.ASSET_TAG} retired`;
    });

    // ==================================================
    // ARCHIVE (FR-011, FR-012)
    // ==================================================

    this.on('archiveAsset', Assets, async (req) => {

        const asset = await loadAsset(req);
        const { reason, complianceReference } = req.data;

        if (asset.STATUS === 'ASSIGNED' || await activeAssignment(asset)) {
            return req.reject(409, `${asset.ASSET_TAG} is still assigned - it can only be archived after it is returned.`);
        }
        if (asset.STATUS !== 'RETIRED') {
            return req.reject(409, `Only RETIRED assets can be archived (${asset.ASSET_TAG} is ${asset.STATUS}).`);
        }
        required(req, reason, 'An archive reason is required.');

        const now = new Date().toISOString();

        await INSERT.into(db.ArchiveRecords).entries({
            NODE_KEY: randomUUID(),
            ASSET_NODE_KEY: asset.NODE_KEY,
            ARCHIVED_AT: now,
            ARCHIVED_BY: loginOf(req),
            REASON: reason,
            DISPOSAL_CERT_NO: complianceReference || null,
            DISPOSAL_METHOD: asset.DISPOSAL_METHOD
        });

        await setAsset(asset, { STATUS: 'ARCHIVED' });

        await writeLedger(req, asset, {
            ACTION: 'ARCHIVED',
            TRANSITION_DATE: today() < asset.RETIRED_DATE ? asset.RETIRED_DATE : today(),
            TO_STATUS: 'ARCHIVED',
            REMARKS: complianceReference ? `${reason} (${complianceReference})` : reason
        });

        req.notify(`${asset.ASSET_TAG} archived.`);
        return `${asset.ASSET_TAG} archived`;
    });

    // ==================================================
    // Direct, controlled updates of assignment and maintenance details.
    // Lifecycle status changes must still go through bound actions.
    // ==================================================
    this.before('UPDATE', Assignments, async req => {
        const key = req.data.NODE_KEY || req.params?.[0]?.NODE_KEY;
        const old = await SELECT.one.from(db.AssetAssignments).where({ NODE_KEY: key });
        if (!old) req.reject(404, 'Assignment not found.');
        if (old.ASSIGNMENT_STATUS !== 'ACTIVE') req.reject(409, 'Historical assignments are immutable.');
        const permitted = ['NODE_KEY', 'EXPECTED_RETURN_DATE', 'REMARKS'];
        if (Object.keys(req.data).some(k => !permitted.includes(k))) {
            req.reject(403, 'Only expected return date and remarks may be edited.');
        }
        const due = req.data.EXPECTED_RETURN_DATE;
        if (due && (!isDate(due) || due < old.ASSIGNED_DATE)) {
            req.reject(400, 'Expected return date must be on or after the assignment date.');
        }
    });

    this.before('CREATE', Maintenance, async req => {
        const data = req.data;
        const asset = await SELECT.one.from(db.Assets).where({ NODE_KEY: data.ASSET_NODE_KEY });
        if (!asset || asset.STATUS !== 'AVAILABLE') req.reject(409, 'Only AVAILABLE assets can enter maintenance.');
        if (!MAINTENANCE_TYPES.includes(data.TYPE || 'REPAIR')) req.reject(400, 'Invalid maintenance type.');
        required(req, data.DESCRIPTION, 'Maintenance description is mandatory.');
        required(req, data.SERVICE_VENDOR_NODE_KEY, 'Service vendor is mandatory.');
        const vendor = await SELECT.one.from(db.Vendors).where({ NODE_KEY: data.SERVICE_VENDOR_NODE_KEY });
        if (!vendor?.IS_ACTIVE) req.reject(400, 'An active service vendor is required.');
        const date = data.REPORTED_DATE || today();
        await checkTransitionDate(req, asset, date, 'Reported date');
        if (data.COST !== undefined && (data.COST !== null) && Number(data.COST) < 0) req.reject(400, 'Maintenance cost cannot be negative.');
        if (data.NEXT_DUE_DATE && (!isDate(data.NEXT_DUE_DATE) || data.NEXT_DUE_DATE < date)) req.reject(400, 'Next maintenance date must not precede reported date.');
        data.NODE_KEY ||= randomUUID();
        data.TYPE ||= 'REPAIR';
        data.REPORTED_DATE = date;
        data.STATUS = 'OPEN';
        data.COMPLETED_DATE = null;
        data.OUTCOME = null;
        data.REPORTED_BY_NODE_KEY ||= (await SELECT.one.from(db.Employees).columns('NODE_KEY').where({ EMAIL: loginOf(req) }))?.NODE_KEY ?? null;
    });
    this.after('CREATE', Maintenance, async (result, req) => {
        const record = { ...req.data, ...result };
        const asset = await SELECT.one.from(db.Assets).where({ NODE_KEY: record.ASSET_NODE_KEY });
        const updated = await UPDATE(db.Assets).set({ STATUS: 'MAINTENANCE' })
            .where({ NODE_KEY: asset.NODE_KEY, STATUS: 'AVAILABLE' });
        if (!updated) req.reject(409, 'Asset changed while maintenance was being created.');
        await writeLedger(req, asset, {
            ACTION: 'MAINTENANCE_STARTED',
            TRANSITION_DATE: record.REPORTED_DATE,
            TO_STATUS: 'MAINTENANCE',
            REMARKS: (record.DESCRIPTION || '').slice(0, 255)
        });
    });
    this.before('UPDATE', Maintenance, async req => {
        const key = req.data.NODE_KEY || req.params?.[0]?.NODE_KEY;
        const old = await SELECT.one.from(db.MaintenanceRecords).where({ NODE_KEY: key });
        if (!old) req.reject(404, 'Maintenance record not found.');
        if (old.STATUS !== 'OPEN') req.reject(409, 'Completed maintenance records cannot be edited.');
        const permitted = ['NODE_KEY', 'DESCRIPTION', 'TYPE', 'COST', 'COVERED_BY_WARRANTY', 'NEXT_DUE_DATE'];
        if (Object.keys(req.data).some(k => !permitted.includes(k))) {
            req.reject(403, 'Use Complete Maintenance to change lifecycle status or completion details.');
        }
        if (req.data.TYPE && !MAINTENANCE_TYPES.includes(req.data.TYPE)) req.reject(400, 'Invalid maintenance type.');
        if (req.data.COST !== undefined && req.data.COST !== null && Number(req.data.COST) < 0) {
            req.reject(400, 'Maintenance cost cannot be negative.');
        }
        if (req.data.NEXT_DUE_DATE && (!isDate(req.data.NEXT_DUE_DATE) ||
            req.data.NEXT_DUE_DATE < old.REPORTED_DATE)) req.reject(400, 'Invalid next maintenance date.');
    });

    // ==================================================
    // EMPLOYEES
    // ==================================================

    this.before('NEW', Employees.drafts, (req) => {
        req.data.STATUS ??= 'ACTIVE';
    });

    this.before(['CREATE', 'UPDATE'], Employees, async (req) => {

        const data = req.data;
        if (data.EMAIL !== undefined) data.EMAIL = data.EMAIL?.trim().toLowerCase();

        const old = req.event === 'UPDATE'
            ? await SELECT.one.from(db.Employees).where({ NODE_KEY: data.NODE_KEY })
            : null;
        const employee = { ...old, ...data };

        required(req, employee.FULL_NAME, 'Full name is mandatory.');
        required(req, employee.EMAIL, 'E-mail is mandatory.');
        if (!EMAIL_PATTERN.test(employee.EMAIL)) {
            req.reject(400, `${employee.EMAIL} is not a valid e-mail address.`);
        }

        const others = { NODE_KEY: { '!=': employee.NODE_KEY ?? '' } };
        if (await SELECT.one.from(db.Employees).where({ EMAIL: employee.EMAIL, ...others })) {
            req.reject(409, `An employee with e-mail ${employee.EMAIL} already exists.`);
        }
        if (employee.EMPLOYEE_NO && await SELECT.one.from(db.Employees).where({ EMPLOYEE_NO: employee.EMPLOYEE_NO, ...others })) {
            req.reject(409, `Employee number ${employee.EMPLOYEE_NO} already exists.`);
        }

        if (employee.DEPARTMENT_NODE_KEY) {
            const department = await SELECT.one.from(db.Departments).where({ NODE_KEY: employee.DEPARTMENT_NODE_KEY });
            if (!department) req.reject(400, 'Department not found.');
            if (!department.IS_ACTIVE && (!old || old.DEPARTMENT_NODE_KEY !== employee.DEPARTMENT_NODE_KEY)) req.reject(409, 'Cannot assign employees to an inactive department.');
        }

        // offboarding: all assets must be returned before an employee is deactivated
        if (old && old.STATUS === 'ACTIVE' && employee.STATUS === 'INACTIVE') {
            const held = await SELECT.from(db.Assets).columns('ASSET_TAG')
                .where({ CURRENT_HOLDER_NODE_KEY: employee.NODE_KEY });
            if (held.length) {
                req.reject(409, `${employee.FULL_NAME} still holds ${held.map(a => a.ASSET_TAG).join(', ')} - return the asset(s) before deactivating.`);
            }
        }
    });

    this.before('DELETE', Employees, async (req) => {
        const used = await SELECT.one.from(db.AssetAssignments).where({ EMPLOYEE_NODE_KEY: req.data.NODE_KEY });
        if (used) req.reject(409, 'This employee has assignment history and cannot be deleted - set the status to INACTIVE instead.');
    });

    // ==================================================
    // DEPARTMENTS (FR-027)
    // ==================================================
    this.before('NEW', Departments.drafts, req => { req.data.IS_ACTIVE ??= true; });
    this.before(['CREATE', 'UPDATE'], Departments, async req => {
        if (req.data.NAME !== undefined) req.data.NAME = req.data.NAME?.trim();
        const old = req.event === 'UPDATE' ? await SELECT.one.from(db.Departments).where({ NODE_KEY: req.data.NODE_KEY }) : null;
        const department = { ...old, ...req.data };
        required(req, department.NAME, 'Department name is mandatory.');
        const duplicate = await SELECT.one.from(db.Departments).where({ NAME: department.NAME, NODE_KEY: { '!=': department.NODE_KEY ?? '' } });
        if (duplicate) req.reject(409, `Department ${department.NAME} already exists.`);
    });
    this.before('DELETE', Departments, async req => {
        if (await SELECT.one.from(db.Employees).where({ DEPARTMENT_NODE_KEY: req.data.NODE_KEY })) req.reject(409, 'Department has employees. Reassign them or deactivate the department.');
    });

    // ==================================================
    // CATEGORIES (FR-016) AND VENDORS (FR-017)
    // ==================================================

    this.before('NEW', Categories.drafts, (req) => { req.data.IS_ACTIVE ??= true; });
    this.before('NEW', Vendors.drafts, (req) => { req.data.IS_ACTIVE ??= true; });

    this.before(['CREATE', 'UPDATE'], Categories, async (req) => {

        const old = req.event === 'UPDATE'
            ? await SELECT.one.from(db.AssetCategories).where({ NODE_KEY: req.data.NODE_KEY })
            : null;
        const category = { ...old, ...req.data };

        required(req, category.NAME, 'Category name is mandatory.');
        if (!(Number(category.LIFESPAN_MONTHS) > 0)) {
            req.reject(400, 'Lifespan (months) must be greater than 0.');
        }
        const duplicate = await SELECT.one.from(db.AssetCategories)
            .where({ NAME: category.NAME, NODE_KEY: { '!=': category.NODE_KEY ?? '' } });
        if (duplicate) req.reject(409, `Category ${category.NAME} already exists.`);
    });

    this.before('DELETE', Categories, async (req) => {
        const used = await SELECT.one.from(db.Assets).where({ CATEGORY_NODE_KEY: req.data.NODE_KEY });
        if (used) req.reject(409, 'This category is used by assets - set it inactive instead.');
    });

    this.before(['CREATE', 'UPDATE'], Vendors, async (req) => {

        const old = req.event === 'UPDATE'
            ? await SELECT.one.from(db.Vendors).where({ NODE_KEY: req.data.NODE_KEY })
            : null;
        const vendor = { ...old, ...req.data };

        required(req, vendor.NAME, 'Vendor name is mandatory.');
        if (vendor.EMAIL && !EMAIL_PATTERN.test(vendor.EMAIL)) {
            req.reject(400, `${vendor.EMAIL} is not a valid e-mail address.`);
        }
    });

    this.before('DELETE', Vendors, async (req) => {
        const key = req.data.NODE_KEY;
        const used = await SELECT.one.from(db.Assets).where({ VENDOR_NODE_KEY: key })
            ?? await SELECT.one.from(db.MaintenanceRecords).where({ SERVICE_VENDOR_NODE_KEY: key });
        if (used) req.reject(409, 'This vendor is used by assets or maintenance records - set it inactive instead.');
    });
});
