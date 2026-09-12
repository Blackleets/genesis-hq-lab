import test from 'node:test';
import assert from 'node:assert/strict';

import {
  vwapForQuote,
  vwapForBase,
  evaluateCrossVenueArb,
  EXECUTION_AUTHORITY,
  MODE,
} from '../genesis/crossExchangeArbShadow.mjs';

test('vwapForQuote respects visible ask depth', () => {
  const r = vwapForQuote([[102, 5], [103, 10]], 1020);
  assert.ok(r);
  assert.equal(Number(r.baseQty.toFixed(6)), Number((5 + 510 / 103).toFixed(6)));
  assert.ok(r.vwap > 102 && r.vwap < 103);
});

test('vwapForBase respects visible bid depth', () => {
  const r = vwapForBase([[103, 5], [102, 10]], 10);
  assert.ok(r);
  assert.equal(r.baseSold, 10);
  assert.equal(r.quoteReceived, 1025);
  assert.equal(r.vwap, 102.5);
});

test('102 buy / 103 sell only qualifies when all explicit costs remain positive', () => {
  const r = evaluateCrossVenueArb({
    symbol: 'SOL/USDT',
    buyVenue: 'bybit',
    sellVenue: 'binance',
    buyAsks: [[102, 20]],
    sellBids: [[103, 20]],
    quoteNotional: 1020,
    buyTakerFee: 0.001,
    sellTakerFee: 0.001,
    rebalanceBps: 10,
    capturedAt: '2026-09-12T00:00:00.000Z',
  });

  assert.equal(r.executable, true);
  assert.equal(r.mode, 'SHADOW');
  assert.equal(r.executionAuthority, false);
  assert.ok(r.grossEdgeBps > 98 && r.grossEdgeBps < 99);
  assert.ok(r.netEdgeBps > 68 && r.netEdgeBps < 69);
  assert.equal(r.verdict, 'SHADOW_CANDIDATE');
});

test('unknown fees or rebalance budget cannot be promoted', () => {
  const r = evaluateCrossVenueArb({
    symbol: 'SOL/USDT',
    buyVenue: 'bybit',
    sellVenue: 'binance',
    buyAsks: [[102, 20]],
    sellBids: [[103, 20]],
    quoteNotional: 1020,
    buyTakerFee: null,
    sellTakerFee: null,
    rebalanceBps: null,
  });

  assert.equal(r.executable, true);
  assert.equal(r.netEdgeBps, null);
  assert.equal(r.verdict, 'NO_GO');
  assert.equal(r.feeModel, 'unknown');
  assert.equal(r.rebalanceModel, 'unresolved');
});

test('insufficient depth is NO execution candidate', () => {
  const r = evaluateCrossVenueArb({
    symbol: 'SOL/USDT',
    buyVenue: 'bybit',
    sellVenue: 'binance',
    buyAsks: [[102, 1]],
    sellBids: [[103, 20]],
    quoteNotional: 1020,
    buyTakerFee: 0.001,
    sellTakerFee: 0.001,
    rebalanceBps: 10,
  });

  assert.equal(r.executable, false);
  assert.equal(r.reason, 'insufficient_buy_depth');
});

test('module is structurally shadow-only', () => {
  assert.equal(MODE, 'SHADOW');
  assert.equal(EXECUTION_AUTHORITY, false);
});
