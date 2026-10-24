import test from 'node:test';
import assert from 'node:assert/strict';
import { readS4Paged, normalizedV2Rows, previewS4Purchasing } from '../srv/integrations/s4hana.js';

test('reads OData V2 records and paginates only within configured entity set', async () => {
  const calls = [];
  const svc = { send: async ({ path }) => {
    calls.push(path);
    if (calls.length === 1) return { d: { results: [{ PO: '100' }], __next: '/PurchaseOrders?$skiptoken=1' } };
    return { d: { results: [{ PO: '101' }] } };
  } };
  const rows = await readS4Paged(svc, '/PurchaseOrders');
  assert.deepEqual(rows.map(x => x.PO), ['100', '101']);
  assert.deepEqual(calls, ['/PurchaseOrders', '/PurchaseOrders?$skiptoken=1']);
});

test('rejects suspicious continuation URLs and repetition', async () => {
  await assert.rejects(readS4Paged({ send: async () => ({ d: { results: [], __next: 'https://other.example/PurchaseOrders' } }) }, '/PurchaseOrders'), /absolute next link/);
  await assert.rejects(readS4Paged({ send: async () => ({ d: { results: [], __next: '/PurchaseOrders' } }) }, '/PurchaseOrders'), /Repeated/);
  await assert.rejects(readS4Paged({}, '/../Bad'), /relative entity-set/);
});

test('rejects unexpected responses and limits', async () => {
  assert.throws(() => normalizedV2Rows({ bogus: 1 }), /Unexpected/);
  await assert.rejects(readS4Paged({}, '/PurchaseOrders', { maxPages: 0 }), /Invalid/);
});

test('does not read or mutate anything until destination is configured', async () => {
  await assert.rejects(previewS4Purchasing({ cds: { env: { requires: {} } }, purchaseOrderEntitySet: '/PurchaseOrders', goodsReceiptEntitySet: '/GoodsReceipts' }), /not configured/);
});
