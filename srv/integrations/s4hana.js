/**
 * Read-only S/4HANA OData V2 client for FRD INT-01.
 *
 * Deliberately does not write to ITAM Assets: mapping purchase orders / goods
 * receipts to asset master data requires a signed-off business key mapping.
 * Requires an explicitly configured cds.requires.s4hana service (BTP Destination).
 */
export const INTERVAL_MINUTES = 15;
export const MAX_PAGES = 100;

function assertPath(path) {
  if (typeof path !== 'string' || !/^\/[A-Za-z0-9_/-]+$/.test(path)) {
    throw new Error('S/4HANA OData path must be a relative entity-set path.');
  }
  return path;
}

export function normalizedV2Rows(response) {
  const data = response?.data ?? response;
  const body = data?.d ?? data;
  if (Array.isArray(body?.results)) {
    return { rows: body.results, next: body.__next ?? null };
  }
  if (Array.isArray(body?.value)) {
    return { rows: body.value, next: body['@odata.nextLink'] ?? null };
  }
  throw new Error('Unexpected S/4HANA OData response format.');
}

export async function readS4Paged(service, entitySet, { maxPages = MAX_PAGES } = {}) {
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > MAX_PAGES) {
    throw new Error('Invalid S/4HANA page limit.');
  }
  const initial = assertPath(entitySet);
  const rows = [];
  let next = initial;
  const seen = new Set();
  for (let page = 0; next && page < maxPages; page++) {
    // Never follow arbitrary absolute URLs supplied in OData __next.
    // Use only the relative path, and reject external origins.
    let path = next;
    if (next.startsWith('http')) {
      throw new Error('S/4HANA returned an absolute next link; configure an approved relative continuation endpoint.');
    }
    if (!path.startsWith(initial + '?') && path !== initial) {
      throw new Error('S/4HANA continuation path is outside the requested entity set.');
    }
    if (seen.has(path)) throw new Error('Repeated S/4HANA continuation link.');
    seen.add(path);
    const response = await service.send({ method: 'GET', path, headers: { Accept: 'application/json' } });
    const result = normalizedV2Rows(response);
    rows.push(...result.rows);
    next = result.next;
  }
  if (next) throw new Error('S/4HANA result exceeds the configured page limit.');
  return rows;
}

export async function previewS4Purchasing({ cds, purchaseOrderEntitySet, goodsReceiptEntitySet }) {
  if (!cds.env.requires?.s4hana) {
    throw new Error('S/4HANA destination is not configured. Configure cds.requires.s4hana before running this integration.');
  }
  const service = await cds.connect.to('s4hana');
  const [purchaseOrders, goodsReceipts] = await Promise.all([
    readS4Paged(service, purchaseOrderEntitySet),
    readS4Paged(service, goodsReceiptEntitySet)
  ]);
  // Read-only preview: never auto-merge external PO / GR records into Assets.
  return { purchaseOrders, goodsReceipts, fetchedAt: new Date().toISOString() };
}
