import cds from '@sap/cds';
import { today, tokenPayload, currentEmployee } from './lib/util.js';

const { SELECT } = cds.ql;

export default cds.service.impl(async function () {

    const db = {
        ...cds.entities('itam.db.master'),
        ...cds.entities('itam.db.transaction')
    };

    this.on('whoAmI', async (req) => {

        const payload = tokenPayload(req);
        const employee = await currentEmployee(req);
        const tokenName = [req.user.attr?.givenName, req.user.attr?.familyName].filter(Boolean).join(' ');

        return {
            user: req.user.id,
            name: employee?.FULL_NAME ?? (tokenName || req.user.id),
            email: payload.email ?? null,
            origin: payload.origin ?? null,
            isAdmin: req.user.is('Admin'),
            isManager: req.user.is('Manager'),
            isUser: req.user.is('User'),
            scopes: payload.scope ?? Object.keys(req.user.roles ?? {}),
            employee: employee ? `${employee.FULL_NAME} (${employee.EMAIL})` : null
        };
    });

    // numbers on the launchpad tiles; admin / manager numbers stay empty for users
    this.on('tileKpis', async (req) => {

        const count = async (entity, where) => {
            const row = await SELECT.one.from(entity).columns('count(1) as n').where(where);
            return Number(row?.n ?? 0);
        };

        const employee = await currentEmployee(req);
        const result = {
            myAssets: employee ? await count(db.Assets, { CURRENT_HOLDER_NODE_KEY: employee.NODE_KEY }) : 0,
            availableAssets: await count(db.Assets, { STATUS: 'AVAILABLE' }),
            assignedAssets: null, inMaintenance: null, overdueReturns: null, retiredAssets: null,
            employees: null, categories: null, vendors: null
        };

        if (req.user.is('Admin') || req.user.is('Manager')) {
            Object.assign(result, {
                assignedAssets: await count(db.Assets, { STATUS: 'ASSIGNED' }),
                inMaintenance: await count(db.Assets, { STATUS: 'MAINTENANCE' }),
                retiredAssets: await count(db.Assets, { STATUS: 'RETIRED' }),
                overdueReturns: await count(db.AssetAssignments,
                    { ASSIGNMENT_STATUS: 'ACTIVE', EXPECTED_RETURN_DATE: { '<': today() } })
            });
        }

        if (req.user.is('Admin')) {
            Object.assign(result, {
                employees: await count(db.Employees, { STATUS: 'ACTIVE' }),
                categories: await count(db.AssetCategories, { IS_ACTIVE: true }),
                vendors: await count(db.Vendors, { IS_ACTIVE: true })
            });
        }

        return result;
    });
});
