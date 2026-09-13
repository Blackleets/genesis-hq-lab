import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHostedSnapshot } from '../../scripts/arbitrage/hostedSnapshot.mjs';
import handler from '../../api/genesis/context.js';

test('radar API serves hosted evidence when database source is unavailable', async (t) => {
  const snapshot = buildHostedSnapshot({ ok: true, routesQuoted: 20, blockNumber: '123' });
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url).includes('raw.githubusercontent.com')) return { ok: true, json: async () => snapshot };
    throw new Error('database_unavailable');
  });
  const res = { status(code) { this.code = code; return this; }, setHeader() { return this; }, send(body) { this.body = JSON.parse(body); } };
  await handler({ method: 'GET', url: '/api/genesis/context?view=arbitrage-radar', headers: { host: 'localhost' } }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.radar.blockNumber, '123');
  assert.equal(res.body.executionAuthority, false);
});

test('hosted evidence preserves negative costs and never manufactures paper profit', () => {
  const snapshot = buildHostedSnapshot({ ok: true, routesQuoted: 1, blockNumber: '123', evaluation: { rejected: [{ routeId: 'a-b', netPnlUsd: -2, grossPnlUsd: 1, totalCostsUsd: 3, blockers: ['netPositive'] }] } });
  assert.equal(snapshot.bestNetPnlUsd, -2);
  assert.equal(snapshot.topRoutes[0].totalCostsUsd, 3);
  assert.equal(snapshot.paperRealizedPnlUsd, null);
  assert.equal(snapshot.executionAuthority, false);
});
test('failure replaces observing status, retains bounded history and removes provider errors', () => {
  const snapshot = buildHostedSnapshot({ ok: false, error: 'https://secret.example/key' }, { history: Array.from({ length: 150 }, () => ({ capturedAt: 'old', blockNumber: '123' })) });
  assert.equal(snapshot.status, 'degraded');
  assert.equal(snapshot.history.length, 96);
  assert.equal(JSON.stringify(snapshot).includes('secret.example'), false);
});
test('hosted evidence rejects execution authority', () => {
  assert.throws(() => buildHostedSnapshot({ executionAuthority: true }), /shadow_only/);
});
