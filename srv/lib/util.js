import cds from '@sap/cds';

const { SELECT } = cds.ql;

export const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

export const today = () => new Date().toISOString().slice(0, 10);

export const addMonths = (date, months) => {
    const d = new Date(date + 'T00:00:00Z');
    d.setUTCMonth(d.getUTCMonth() + months);
    return d.toISOString().slice(0, 10);
};

export const addDays = (date, days) => {
    const d = new Date(date + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
};

export const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value ?? '') && !isNaN(Date.parse(value));

export const EMAIL_PATTERN = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

// claims of the XSUAA token (empty in tests)
export const tokenPayload = (req) =>
    req.user?.authInfo?.token?.payload ?? req.user?.tokenInfo?.getPayload?.() ?? {};

// login e-mail of the current user (lower case); used as actor in the ledger / audit log
export const loginOf = (req) => String(tokenPayload(req).email ?? req.user.id).toLowerCase();

// Employees record linked to the login e-mail
export async function currentEmployee(req) {
    const { Employees } = cds.entities('itam.db.master');
    return SELECT.one.from(Employees).where`tolower(EMAIL) = ${loginOf(req)}`;
}

// key of the entity a bound action was called on (draft-enabled entities have a compound key)
export const boundKey = (req) => req.params?.[0]?.NODE_KEY ?? req.params?.[0];
