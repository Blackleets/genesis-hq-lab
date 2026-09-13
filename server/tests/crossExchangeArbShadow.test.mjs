import test from 'node:test';
import assert from 'node:assert/strict';

import {
  vwapForQuote,
  vwapForBase,
  evaluateCrossVenueArb,
  orderBookLimitForExchange,
  scanCrossExchangeArbShadowDetailed,
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
  assert.ok(r.netEdgeBps > 67 && r.netEdgeBps < 69);
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

test('venue-specific order-book limits avoid unsupported depth requests', () => {
  assert.equal(orderBookLimitForExchange('bitfinex', 20), 25);
  assert.equal(orderBookLimitForExchange('okx', 20), 20);
});

test('one unavailable venue is isolated and remaining venues are still compared', async () => {
  const fakeMarkets = { taker: 0.001 };
  const exchangeBuilder = async (id) => {
    if (id === 'binance') throw new Error('451 restricted location');
    return { id, market: () => fakeMarkets };
  };
  const bookFetcher = async (ex) => {
    const now = Date.now();
    if (ex.id === 'bybit') return { asks: [[100, 20]], bids: [[99.8, 20]], fetchedAt: now, latencyMs: 10, exchangeTs: now };
    return { asks: [[100.4, 20]], bids: [[100.7, 20]], fetchedAt: now, latencyMs: 10, exchangeTs: now };
  };

  const scan = await scanCrossExchangeArbShadowDetailed({
    exchanges: ['binance', 'bybit', 'okx'],
    symbols: ['SOL/USDT'],
    quoteNotional: 1000,
    rebalanceBps: 5,
    maxBookAgeMs: 5000,
    maxBookSkewMs: 1000,
    exchangeBuilder,
    bookFetcher,
  });

  assert.deepEqual(scan.activeExchanges, ['bybit', 'okx']);
  assert.equal(scan.failures.length, 1);
  assert.equal(scan.failures[0].exchange, 'binance');
  assert.equal(scan.failures[0].stage, 'load_markets');
  assert.equal(scan.results.length, 2);
  assert.equal(scan.results[0].buyVenue, 'bybit');
  assert.equal(scan.results[0].sellVenue, 'okx');
  assert.ok(scan.results.every((row) => Number.isFinite(row.bookSkewMs)));
});

test('cross-venue snapshots beyond the skew budget are filtered before economics', async () => {
  const baseNow = Date.now();
  const exchangeBuilder = async (id) => ({ id, market: () => ({ taker: 0.001 }) });
  const bookFetcher = async (ex) => ({
    asks: [[100, 20]],
    bids: [[101, 20]],
    fetchedAt: ex.id === 'a' ? baseNow : baseNow - 1500,
    latencyMs: 10,
    exchangeTs: null,
  });

  const scan = await scanCrossExchangeArbShadowDetailed({
    exchanges: ['a', 'b'],
    symbols: ['SOL/USDT'],
    quoteNotional: 1000,
    rebalanceBps: 5,
    maxBookAgeMs: 5000,
    maxBookSkewMs: 500,
    exchangeBuilder,
    bookFetcher,
  });

  assert.equal(scan.results.length, 0);
  assert.equal(scan.filteredPairs.length, 2);
  assert.ok(scan.filteredPairs.every((row) => row.reason === 'book_skew'));
  assert.ok(scan.filteredPairs.every((row) => row.bookSkewMs === 1500));
});

test('module is structurally shadow-only', () => {
  assert.equal(MODE, 'SHADOW');
  assert.equal(EXECUTION_AUTHORITY, false);
});
