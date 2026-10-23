import cds from '@sap/cds';
import { today, addMonths, addDays, isDate, round2 } from './util.js';

const { SELECT } = cds.ql;

export const ASSET_STATUSES = ['AVAILABLE', 'ASSIGNED', 'MAINTENANCE', 'RETIRED', 'ARCHIVED'];

export const MAX_EXPORT_ROWS = 5000;   // NFR-008: standard reports up to 5,000 rows
export const MAX_PREVIEW_ROWS = 500;

const END_OF_LIFE_WINDOW_DAYS = 90;

const db = () => ({
    ...cds.entities('itam.db.master'),
    ...cds.entities('itam.db.transaction')
});

// ==================================================
// FILTERS (FR-026): the same filters drive the dashboard, the preview, the PDF and the e-mail
// ==================================================

/** Validates the filter parameters; rejects the request on bad input. */
export function readFilters(req) {

    const { status, category, location, dateFrom, dateTo, department } = req.data;
    const filters = {};

    if (status) {
        if (!ASSET_STATUSES.includes(status)) req.reject(400, `Status must be one of ${ASSET_STATUSES.join(', ')}.`);
        filters.status = status;
    }
    if (category) filters.category = category;
    if (department) filters.departmentScope = department;
    if (location?.trim()) filters.location = location.trim();
    if (dateFrom) {
        if (!isDate(dateFrom)) req.reject(400, 'dateFrom is not a valid date.');
        filters.dateFrom = dateFrom;
    }
    if (dateTo) {
        if (!isDate(dateTo)) req.reject(400, 'dateTo is not a valid date.');
        filters.dateTo = dateTo;
    }
    if (filters.dateFrom && filters.dateTo && filters.dateTo < filters.dateFrom) {
        req.reject(400, 'dateTo cannot be before dateFrom.');
    }
    return filters;
}

/**
 * CQL where-object for the filters.
 * @param prefix  path from the queried entity to the asset ('' for Assets, 'ASSET.' for the others)
 * @param dateField  date element the date range applies to
 */
function whereOf(filters, prefix, dateField) {

    const where = {};
    if (filters.departmentScope) where[`${prefix}MANAGING_DEPARTMENT_NODE_KEY`] = filters.departmentScope;
    if (filters.status) where[`${prefix}STATUS`] = filters.status;
    if (filters.category) where[`${prefix}CATEGORY_NODE_KEY`] = filters.category;
    if (filters.location) where[`${prefix}LOCATION`] = filters.location;

    if (filters.dateFrom && filters.dateTo) where[dateField] = { between: filters.dateFrom, and: filters.dateTo };
    else if (filters.dateFrom) where[dateField] = { '>=': filters.dateFrom };
    else if (filters.dateTo) where[dateField] = { '<=': filters.dateTo };

    return where;
}

/** Human-readable filter text for the report header (category shown by name). */
export async function describeFilters(filters) {

    const parts = [];
    if (filters.status) parts.push(`Status: ${filters.status}`);
    if (filters.category) {
        const category = await SELECT.one.from(db().AssetCategories).columns('NAME').where({ NODE_KEY: filters.category });
        parts.push(`Category: ${category?.NAME ?? filters.category}`);
    }
    if (filters.location) parts.push(`Location: ${filters.location}`);
    if (filters.departmentScope) {
        const dept = await SELECT.one.from(db().Departments).columns('NAME').where({ NODE_KEY: filters.departmentScope });
        parts.push(`Department: ${dept?.NAME ?? filters.departmentScope}`);
    }
    if (filters.dateFrom || filters.dateTo) parts.push(`Date: ${filters.dateFrom ?? '...'} to ${filters.dateTo ?? '...'}`);
    return parts.length ? parts.join(' | ') : 'No filters (all data)';
}

// ==================================================
// DASHBOARD KPIs (FR-021)
// ==================================================

export async function dashboard(filters) {

    const { Assets, AssetCategories, AssetAssignments, MaintenanceRecords } = db();
    const assetWhere = whereOf(filters, '', 'PURCHASE_DATE');
    const linkedWhere = whereOf(filters, 'ASSET.', 'ASSET.PURCHASE_DATE');

    const assets = await SELECT.from(Assets)
        .columns('STATUS', 'LOCATION', 'CATEGORY_NODE_KEY', 'PURCHASE_DATE', 'PURCHASE_COST', 'CURRENCY_CODE')
        .where(assetWhere);

    const categories = await SELECT.from(AssetCategories).columns('NODE_KEY', 'NAME', 'LIFESPAN_MONTHS');
    const categoryOf = Object.fromEntries(categories.map(c => [c.NODE_KEY, c]));

    const countBy = (keyOf, labelOf = (k) => k) => {
        const groups = {};
        for (const a of assets) {
            const key = keyOf(a) ?? '(none)';
            groups[key] ??= { code: key, label: labelOf(key), count: 0, value: 0 };
            groups[key].count++;
            groups[key].value = round2(groups[key].value + Number(a.PURCHASE_COST || 0));
        }
        return Object.values(groups).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    };

    const statusCount = (s) => assets.filter(a => a.STATUS === s).length;
    const available = statusCount('AVAILABLE');
    const assigned = statusCount('ASSIGNED');
    const inMaintenance = statusCount('MAINTENANCE');
    const inService = available + assigned + inMaintenance;

    // end of life: purchase date + category lifespan within the next 90 days (or already passed)
    const horizon = addDays(today(), END_OF_LIFE_WINDOW_DAYS);
    const endOfLifeSoon = assets.filter(a => {
        const lifespan = categoryOf[a.CATEGORY_NODE_KEY]?.LIFESPAN_MONTHS;
        return ['AVAILABLE', 'ASSIGNED', 'MAINTENANCE'].includes(a.STATUS) && lifespan && a.PURCHASE_DATE
            && addMonths(a.PURCHASE_DATE, lifespan) <= horizon;
    }).length;

    // asset value: only meaningful in one currency
    const valued = assets.filter(a => a.STATUS !== 'ARCHIVED');
    const currencies = [...new Set(valued.map(a => a.CURRENCY_CODE).filter(Boolean))];
    const totalValue = currencies.length <= 1
        ? round2(valued.reduce((sum, a) => sum + Number(a.PURCHASE_COST || 0), 0))
        : null;

    const overdue = await SELECT.one.from(AssetAssignments).columns('count(1) as n')
        .where({ ...linkedWhere, ASSIGNMENT_STATUS: 'ACTIVE', EXPECTED_RETURN_DATE: { '<': today() } });

    const openMaintenance = await SELECT.one.from(MaintenanceRecords).columns('count(1) as n')
        .where({ ...linkedWhere, STATUS: 'OPEN' });

    const byStatus = ASSET_STATUSES.map(s => ({
        code: s,
        label: s.charAt(0) + s.slice(1).toLowerCase(),
        count: statusCount(s),
        value: round2(assets.filter(a => a.STATUS === s).reduce((sum, a) => sum + Number(a.PURCHASE_COST || 0), 0))
    }));

    return {
        totalAssets: assets.length,
        available,
        assigned,
        inMaintenance,
        retired: statusCount('RETIRED'),
        archived: statusCount('ARCHIVED'),
        utilisationPct: inService ? round2(assigned / inService * 100) : 0,
        overdueReturns: Number(overdue?.n ?? 0),
        openMaintenance: Number(openMaintenance?.n ?? 0),
        endOfLifeSoon,
        totalValue,
        currency: currencies.length === 1 ? currencies[0] : (currencies.length ? 'MIXED' : null),
        byStatus,
        byCategory: countBy(a => a.CATEGORY_NODE_KEY, k => categoryOf[k]?.NAME ?? k),
        byLocation: countBy(a => a.LOCATION),
        generatedAt: new Date().toISOString()
    };
}

// ==================================================
// REPORTS (FR-022): one definition per report type
// ==================================================

const text = (v) => (v === null || v === undefined ? '' : String(v));
const money = (v, c) => (v === null || v === undefined ? '' : `${Number(v).toFixed(2)} ${c ?? ''}`.trim());

export const REPORTS = {

    ASSET_INVENTORY: {
        title: 'Hardware Asset Inventory',
        entity: 'Assets',
        prefix: '',
        dateField: 'PURCHASE_DATE',
        orderBy: 'ASSET_TAG',
        columns: [
            'ASSET_TAG', 'SERIAL_NUMBER', 'ASSET_NAME', 'CATEGORY.NAME as CATEGORY', 'STATUS', 'LOCATION',
            'CURRENT_HOLDER.FULL_NAME as HOLDER', 'PURCHASE_DATE', 'PURCHASE_COST', 'CURRENCY_CODE', 'FIRST_DISTRIBUTION_DATE'
        ],
        headers: ['Asset Tag', 'Serial No.', 'Asset', 'Category', 'Status', 'Location', 'Holder', 'Procured', 'Cost', 'First Distributed'],
        row: (r) => [r.ASSET_TAG, r.SERIAL_NUMBER, r.ASSET_NAME, r.CATEGORY, r.STATUS, r.LOCATION, r.HOLDER,
            r.PURCHASE_DATE, money(r.PURCHASE_COST, r.CURRENCY_CODE), r.FIRST_DISTRIBUTION_DATE],
        chart: { title: 'Assets by status', field: 'STATUS' }
    },

    ASSIGNMENTS: {
        title: 'Asset Assignments',
        entity: 'AssetAssignments',
        prefix: 'ASSET.',
        dateField: 'ASSIGNED_DATE',
        orderBy: 'ASSIGNED_DATE desc',
        columns: [
            'ASSET.ASSET_TAG as ASSET_TAG', 'ASSET.ASSET_NAME as ASSET_NAME', 'EMPLOYEE.FULL_NAME as EMPLOYEE',
            'ASSIGNED_DATE', 'EXPECTED_RETURN_DATE', 'ACTUAL_RETURN_DATE', 'ASSIGNMENT_STATUS', 'REMARKS'
        ],
        headers: ['Asset Tag', 'Asset', 'Employee', 'Assigned', 'Expected Return', 'Returned', 'Status', 'Remarks'],
        row: (r) => [r.ASSET_TAG, r.ASSET_NAME, r.EMPLOYEE, r.ASSIGNED_DATE, r.EXPECTED_RETURN_DATE,
            r.ACTUAL_RETURN_DATE, r.ASSIGNMENT_STATUS, r.REMARKS],
        chart: { title: 'Assignments by status', field: 'ASSIGNMENT_STATUS' }
    },

    MAINTENANCE: {
        title: 'Maintenance Records',
        entity: 'MaintenanceRecords',
        prefix: 'ASSET.',
        dateField: 'REPORTED_DATE',
        orderBy: 'REPORTED_DATE desc',
        columns: [
            'ASSET.ASSET_TAG as ASSET_TAG', 'ASSET.ASSET_NAME as ASSET_NAME', 'TYPE', 'DESCRIPTION',
            'SERVICE_VENDOR.NAME as VENDOR', 'REPORTED_DATE', 'COMPLETED_DATE', 'STATUS'
        ],
        headers: ['Asset Tag', 'Asset', 'Type', 'Issue', 'Vendor', 'Reported', 'Completed', 'Status'],
        row: (r) => [r.ASSET_TAG, r.ASSET_NAME, r.TYPE, r.DESCRIPTION, r.VENDOR, r.REPORTED_DATE, r.COMPLETED_DATE, r.STATUS],
        chart: { title: 'Maintenance by status', field: 'STATUS' }
    },

    LIFECYCLE_HISTORY: {
        title: 'Asset Lifecycle History',
        entity: 'OwnershipLedgers',
        prefix: 'ASSET.',
        dateField: 'TRANSITION_DATE',
        orderBy: 'TRANSITION_DATE desc',
        columns: [
            'TRANSITION_DATE', 'ASSET.ASSET_TAG as ASSET_TAG', 'ACTION', 'FROM_EMPLOYEE.FULL_NAME as FROM_EMPLOYEE',
            'TO_EMPLOYEE.FULL_NAME as TO_EMPLOYEE', 'FROM_STATUS', 'TO_STATUS', 'ACTOR'
        ],
        headers: ['Date', 'Asset Tag', 'Action', 'From', 'To', 'From Status', 'To Status', 'By'],
        row: (r) => [r.TRANSITION_DATE, r.ASSET_TAG, r.ACTION, r.FROM_EMPLOYEE, r.TO_EMPLOYEE, r.FROM_STATUS, r.TO_STATUS, r.ACTOR],
        chart: { title: 'Lifecycle events by action', field: 'ACTION' }
    }
};

export function reportDefinition(req) {
    const type = req.data.reportType || 'ASSET_INVENTORY';
    const definition = REPORTS[type];
    if (!definition) req.reject(400, `Report type must be one of ${Object.keys(REPORTS).join(', ')}.`);
    return { type, definition };
}

/** Runs a report; rows are arrays of display strings in the order of `headers`. */
export async function runReport(type, filters, { limit } = {}) {

    const definition = REPORTS[type];
    const entity = db()[definition.entity];
    const where = whereOf(filters, definition.prefix, definition.dateField);

    const counted = await SELECT.one.from(entity).columns('count(1) as n').where(where);
    const rowCount = Number(counted?.n ?? 0);

    let query = SELECT.from(entity).columns(...definition.columns).where(where).orderBy(definition.orderBy);
    if (limit) query = query.limit(limit);
    const records = await query;

    // chart: number of rows per value of the chart field (over all matching rows)
    const field = definition.chart.field;
    const groups = await SELECT.from(entity).columns(`${field} as label`, 'count(1) as n').where(where).groupBy(field);

    return {
        reportType: type,
        title: definition.title,
        columns: definition.headers,
        rows: records.map(r => definition.row(r).map(text)),
        rowCount,
        chart: {
            title: definition.chart.title,
            bars: groups.map(g => ({ label: text(g.label) || '(none)', value: Number(g.n) }))
                .sort((a, b) => b.value - a.value)
        }
    };
}
