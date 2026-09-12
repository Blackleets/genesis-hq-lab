import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateFixedWindowTaker, fetchFixedWindowTaker } from '../genesis/okxFixedWindowTaker.mjs';

function trade(ts, side, sz, tradeId, px = 80_000) {
  return { ts: String(ts), side, sz: String(sz), tradeId: String(tradeId), px: String(px) };
}

test('aggregates a bounded one-minute taker window and exposes provenance', () => {
  const end = 1_800_000_000_000;
  const rows = [
    trade(end - 60_000, 'buy', 2, 1),
    trade(end - 45_000, 'sell', 1, 2),
    trade(end - 20_000, 'buy', 3, 3),
    trade(end, 'sell', 2, 4),
  ];
  const out = aggregateFixedWindowTaker(rows, { windowMs: 60_000, minimumCoverageRatio: 0.9 });
  assert.equal(out.available, true);
  assert.equal(out.tradeCount, 4);
  assert.equal(out.coverageMs, 60_000);
  assert.equal(out.buyContracts, 5);
  assert.equal(out.sellContracts, 3);
  assert.equal(out.buyFraction, 5 / 8);
  assert.ok(Math.abs(out.buySellRatio - (5 / 3)) < 1e-12);
  assert.equal(out.source, 'okx_public_history_trades_fixed_window');
});

test('fails closed when the collected trades do not cover the fixed window', () => {
  const end = 1_800_000_000_000;
  const out = aggregateFixedWindowTaker([
    trade(end - 5_000, 'buy', 2, 1),
    trade(end, 'sell', 1, 2),
  ], { windowMs: 60_000, minimumCoverageRatio: 0.9 });
  assert.equal(out.available, false);
  assert.equal(out.reason, 'INSUFFICIENT_WINDOW_COVERAGE');
  assert.equal(out.coverageMs, 5_000);
});

test('deduplicates paginated trades before calculating flow', () => {
  const end = 1_800_000_000_000;
  const duplicate = trade(end - 30_000, 'buy', 4, 7);
  const out = aggregateFixedWindowTaker([
    trade(end - 60_000, 'sell', 2, 1),
    duplicate,
    duplicate,
    trade(end, 'sell', 2, 8),
  ]);
  assert.equal(out.available, true);
  assert.equal(out.tradeCount, 3);
  assert.equal(out.buyContracts, 4);
  assert.equal(out.sellContracts, 4);
  assert.equal(out.buyFraction, 0.5);
});

test('paginates public history backwards until the requested window is covered', async () => {
  const end = 1_800_000_000_000;
  const calls = [];
  const responses = [
    [trade(end - 10_000, 'buy', 1, 100), trade(end, 'sell', 1, 101)],
    [trade(end - 60_000, 'sell', 1, 90), trade(end - 40_000, 'buy', 3, 91)],
  ];
  const fetchImpl = async url => {
    calls.push(String(url));
    const data = responses.shift() ?? [];
    return { ok: true, status: 200, json: async () => ({ code: '0', data }) };
  };
  const out = await fetchFixedWindowTaker('BTC-USDT-SWAP', {
    windowMs: 60_000,
    minimumCoverageRatio: 0.9,
    maxPages: 5,
    fetchImpl,
  });
  assert.equal(out.available, true);
  assert.equal(out.pagesFetched, 2);
  assert.equal(calls.length, 2);
  assert.match(calls[0], /\/api\/v5\/market\/trades/);
  assert.match(calls[1], /\/api\/v5\/market\/history-trades/);
  assert.match(calls[1], /type=2/);
  assert.equal(out.researchUse, 'OBSERVATIONAL_ONLY_NOT_FOR_RANKING');
  assert.equal(out.transientRetryPolicy.maxAttempts, 3);
});

test('retries transient OKX rate-limit responses without weakening coverage', async () => {
  const end = 1_800_000_000_000;
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) return { ok: false, status: 429, json: async () => ({}) };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        code: '0',
        data: [trade(end - 60_000, 'sell', 1, 1), trade(end, 'buy', 2, 2)],
      }),
    };
  };
  const out = await fetchFixedWindowTaker('BTC-USDT', {
    windowMs: 60_000,
    minimumCoverageRatio: 0.9,
    maxPages: 2,
    fetchImpl,
  });
  assert.equal(calls, 2);
  assert.equal(out.available, true);
  assert.equal(out.coverageGateRatio, 0.9);
  assert.equal(out.transientRetryPolicy.maxAttempts, 3);
});
