import cds from '@sap/cds';
import { randomUUID } from 'node:crypto';
import { currentEmployee, loginOf, today, isDate } from './lib/util.js';

const { SELECT, INSERT, UPDATE } = cds.ql;

export function registerManagerLifecycle(service) {
    const { Assets, AssetAssignments, OwnershipLedgers } = cds.entities('itam.db.transaction');
    const { Employees } = cds.entities('itam.db.master');

    const actor = async req => {
        const employee = await currentEmployee(req);
        if (!employee && !req.user.is('Admin')) req.reject(403, 'Your login is not linked to an employee.');
        return employee;
    };
    const assetForManager = async (req, id) => {
        if (!id) req.reject(400, 'Asset is required.');
        const asset = await SELECT.one.from(Assets).where({ NODE_KEY: id });
        if (!asset) req.reject(404, 'Asset not found.');
        const manager = await actor(req);
        if (!req.user.is('Admin') && (!manager?.DEPARTMENT_NODE_KEY ||
            asset.MANAGING_DEPARTMENT_NODE_KEY !== manager.DEPARTMENT_NODE_KEY)) {
            req.reject(403, 'Asset is outside your department.');
        }
        return { asset, manager };
    };
    const assigneeFor = async (req, key, manager, asset) => {
        const employee = await SELECT.one.from(Employees).where({ NODE_KEY: key });
        if (!employee || employee.STATUS !== 'ACTIVE') req.reject(400, 'An active employee is required.');
        if (!req.user.is('Admin') && (employee.DEPARTMENT_NODE_KEY !== manager.DEPARTMENT_NODE_KEY ||
            asset.MANAGING_DEPARTMENT_NODE_KEY !== manager.DEPARTMENT_NODE_KEY)) {
            req.reject(403, 'Employee must belong to the asset department.');
        }
        return employee;
    };
    const transition = async (req, asset, date) => {
        if (!isDate(date) || date > today()) req.reject(400, 'Invalid or future transition date.');
        const last = await SELECT.one.from(OwnershipLedgers)
            .columns('max(TRANSITION_DATE) as d').where({ ASSET_NODE_KEY: asset.NODE_KEY });
        if (last?.d && date < last.d) req.reject(409, 'Transition date precedes the last event.');
    };
    const ledger = async (req, asset, action, toStatus, fromEmployee, toEmployee, remarks, date = today()) =>
        INSERT.into(OwnershipLedgers).entries({
            NODE_KEY: randomUUID(), ASSET_NODE_KEY: asset.NODE_KEY, ACTION: action,
            TRANSITION_DATE: date, FROM_STATUS: asset.STATUS, TO_STATUS: toStatus,
            FROM_EMPLOYEE_NODE_KEY: fromEmployee || null,
            TO_EMPLOYEE_NODE_KEY: toEmployee || null, REMARKS: remarks || null,
            ACTOR: loginOf(req), RECORDED_AT: new Date().toISOString()
        });

    service.before('UPDATE', service.entities.Assets, async req => {
        const allowed = new Set(['NODE_KEY', 'ASSET_NAME', 'LOCATION']);
        const changed = Object.keys(req.data).filter(k => !allowed.has(k));
        if (changed.length) req.reject(403, 'Only asset name and location may be edited by Managers.');
        const id = req.data.NODE_KEY || req.params?.[0]?.NODE_KEY;
        const { asset } = await assetForManager(req, id);
        if (asset.STATUS === 'ARCHIVED' || asset.STATUS === 'RETIRED') req.reject(409, 'Retired and archived assets cannot be edited.');
    });

    service.before('UPDATE', service.entities.Assignments, async req => {
        const id = req.data.NODE_KEY || req.params?.[0]?.NODE_KEY;
        const assignment = await SELECT.one.from(AssetAssignments).where({ NODE_KEY: id });
        if (!assignment) req.reject(404, 'Assignment not found.');
        await assetForManager(req, assignment.ASSET_NODE_KEY);
        if (assignment.ASSIGNMENT_STATUS !== 'ACTIVE') req.reject(409, 'Historical assignments cannot be edited.');
        const permitted = new Set(['NODE_KEY', 'EXPECTED_RETURN_DATE', 'REMARKS']);
        if (Object.keys(req.data).some(k => !permitted.has(k))) req.reject(403, 'Only remarks and expected return date may be changed.');
        const due = req.data.EXPECTED_RETURN_DATE;
        if (due && (!isDate(due) || due < assignment.ASSIGNED_DATE)) req.reject(400, 'Invalid expected return date.');
    });

    service.on('assignAsset', async req => {
        const { asset, manager } = await assetForManager(req, req.data.asset);
        if (asset.STATUS !== 'AVAILABLE') req.reject(409, 'Only available assets can be assigned.');
        const employee = await assigneeFor(req, req.data.employee, manager, asset);
        const date = today();
        if (asset.PURCHASE_DATE > date) req.reject(400, 'Asset cannot be issued before procurement.');
        await transition(req, asset, date);
        const due = req.data.expectedReturnDate || null;
        if (due && (!isDate(due) || due < date)) req.reject(400, 'Invalid expected return date.');
        const updated = await UPDATE(Assets).set({
            STATUS: 'ASSIGNED', CURRENT_HOLDER_NODE_KEY: employee.NODE_KEY,
            FIRST_DISTRIBUTION_DATE: asset.FIRST_DISTRIBUTION_DATE || date
        }).where({ NODE_KEY: asset.NODE_KEY, STATUS: 'AVAILABLE' });
        if (!updated) req.reject(409, 'Asset status changed; retry.');
        await INSERT.into(AssetAssignments).entries({
            NODE_KEY: randomUUID(), ASSET_NODE_KEY: asset.NODE_KEY,
            EMPLOYEE_NODE_KEY: employee.NODE_KEY, ASSIGNED_BY_NODE_KEY: manager?.NODE_KEY || null,
            ASSIGNED_DATE: date, EXPECTED_RETURN_DATE: due, ASSIGNMENT_STATUS: 'ACTIVE',
            REMARKS: req.data.remarks || null
        });
        await ledger(req, asset, 'ASSIGNED', 'ASSIGNED', null, employee.NODE_KEY, req.data.remarks);
        return 'Asset assigned successfully';
    });

    service.on('transferAsset', async req => {
        const { asset, manager } = await assetForManager(req, req.data.asset);
        if (asset.STATUS !== 'ASSIGNED') req.reject(409, 'Asset must be assigned before transfer.');
        const old = await SELECT.one.from(AssetAssignments).where({ ASSET_NODE_KEY: asset.NODE_KEY, ASSIGNMENT_STATUS: 'ACTIVE' });
        if (!old) req.reject(409, 'Active assignment missing.');
        const employee = await assigneeFor(req, req.data.toEmployee, manager, asset);
        if (old.EMPLOYEE_NODE_KEY === employee.NODE_KEY) req.reject(400, 'Asset already assigned to this employee.');
        const date = today();
        if (date < old.ASSIGNED_DATE) req.reject(400, 'Transfer date precedes assignment.');
        await transition(req, asset, date);
        const closed = await UPDATE(AssetAssignments).set({
            ASSIGNMENT_STATUS: 'TRANSFERRED', ACTUAL_RETURN_DATE: date
        }).where({ NODE_KEY: old.NODE_KEY, ASSIGNMENT_STATUS: 'ACTIVE' });
        if (!closed) req.reject(409, 'Active assignment changed; retry transfer.');
        await INSERT.into(AssetAssignments).entries({
            NODE_KEY: randomUUID(), ASSET_NODE_KEY: asset.NODE_KEY,
            EMPLOYEE_NODE_KEY: employee.NODE_KEY, ASSIGNED_BY_NODE_KEY: manager?.NODE_KEY || null,
            ASSIGNED_DATE: date, EXPECTED_RETURN_DATE: old.EXPECTED_RETURN_DATE >= date ? old.EXPECTED_RETURN_DATE : null,
            ASSIGNMENT_STATUS: 'ACTIVE', REMARKS: req.data.remarks || null
        });
        await UPDATE(Assets).set({ CURRENT_HOLDER_NODE_KEY: employee.NODE_KEY }).where({ NODE_KEY: asset.NODE_KEY });
        await ledger(req, asset, 'TRANSFERRED', 'ASSIGNED', old.EMPLOYEE_NODE_KEY, employee.NODE_KEY, req.data.remarks);
        return 'Asset transferred successfully';
    });

    service.on('returnAsset', async req => {
        const { asset } = await assetForManager(req, req.data.asset);
        if (asset.STATUS !== 'ASSIGNED') req.reject(409, 'Asset is not assigned.');
        const old = await SELECT.one.from(AssetAssignments).where({ ASSET_NODE_KEY: asset.NODE_KEY, ASSIGNMENT_STATUS: 'ACTIVE' });
        if (!old) req.reject(409, 'Active assignment missing.');
        const date = today();
        if (date < old.ASSIGNED_DATE) req.reject(400, 'Return date precedes assignment.');
        await transition(req, asset, date);
        const closed = await UPDATE(AssetAssignments).set({ ASSIGNMENT_STATUS: 'RETURNED', ACTUAL_RETURN_DATE: date })
            .where({ NODE_KEY: old.NODE_KEY, ASSIGNMENT_STATUS: 'ACTIVE' });
        if (!closed) req.reject(409, 'Active assignment changed; retry return.');
        await UPDATE(Assets).set({ STATUS: 'AVAILABLE', CURRENT_HOLDER_NODE_KEY: null })
            .where({ NODE_KEY: asset.NODE_KEY, STATUS: 'ASSIGNED' });
        await ledger(req, asset, 'RETURNED', 'AVAILABLE', old.EMPLOYEE_NODE_KEY, null, req.data.remarks);
        return 'Asset returned successfully';
    });

    service.on('updateAssignment', async req => {
        const item = await SELECT.one.from(AssetAssignments).where({ NODE_KEY: req.data.assignment });
        if (!item) req.reject(404, 'Assignment not found.');
        const { asset } = await assetForManager(req, item.ASSET_NODE_KEY);
        if (asset.STATUS !== 'ASSIGNED' || item.ASSIGNMENT_STATUS !== 'ACTIVE') req.reject(409, 'Only active assignments are editable.');
        const date = req.data.expectedReturnDate;
        if (date && (!isDate(date) || date < item.ASSIGNED_DATE)) req.reject(400, 'Expected return date is invalid.');
        await UPDATE(AssetAssignments).set({ EXPECTED_RETURN_DATE: date || null, REMARKS: req.data.remarks || null })
            .where({ NODE_KEY: item.NODE_KEY });
        return 'Assignment updated successfully';
    });
}
