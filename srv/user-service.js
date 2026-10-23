import cds from '@sap/cds';
import { randomUUID } from 'node:crypto';
import { currentEmployee } from './lib/util.js';

const { SELECT, INSERT } = cds.ql;

// Self-service can only request actions on assets currently assigned to the caller.
// Request submission never changes the asset or ownership ledger.
export default cds.service.impl(function () {
    const { Assets, AssetRequests } = cds.entities('itam.db.transaction');

    async function submit(req, kind) {
        const employee = await currentEmployee(req);
        if (!employee) return req.reject(403, 'No employee record is linked to this login.');
        const assetKey = req.data.asset;
        if (!assetKey) return req.reject(400, 'Asset is required.');
        const asset = await SELECT.one.from(Assets).where({
            NODE_KEY: assetKey, CURRENT_HOLDER_NODE_KEY: employee.NODE_KEY, STATUS: 'ASSIGNED'
        });
        if (!asset) return req.reject(403, 'Only your currently assigned assets may be requested.');
        const description = String(req.data.description ?? '').trim();
        if (kind === 'MAINTENANCE' && !description) return req.reject(400, 'Describe the maintenance issue.');
        if (description.length > 255) return req.reject(400, 'Description exceeds 255 characters.');
        const existing = await SELECT.one.from(AssetRequests).where({
            ASSET_NODE_KEY: assetKey, REQUESTED_BY_NODE_KEY: employee.NODE_KEY,
            REQUEST_TYPE: kind, STATUS: 'PENDING'
        });
        if (existing) return req.reject(409, 'An unresolved request of this type already exists.');
        const id = randomUUID();
        await INSERT.into(AssetRequests).entries({
            NODE_KEY: id, ASSET_NODE_KEY: assetKey, REQUESTED_BY_NODE_KEY: employee.NODE_KEY,
            REQUEST_TYPE: kind, STATUS: 'PENDING', DESCRIPTION: description || null,
            REQUESTED_AT: new Date().toISOString()
        });
        return id;
    }

    this.on('submitReturnRequest', req => submit(req, 'RETURN'));
    this.on('submitMaintenanceRequest', req => submit(req, 'MAINTENANCE'));
});
