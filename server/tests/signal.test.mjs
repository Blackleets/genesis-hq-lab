import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSignal, computeHtfTrend } from '../crypto/signal.mjs';
import { DEFAULTS } from '../crypto/strategyParams.mjs';

const P = DEFAULTS;

// Enough 1m closes for a 15m EMA21 (21 * 15 = 315) following a slope.
const sloped = (dir) => Array.from({ length: 360 }, (_, i) => 1000 + dir * i * 0.2);

// Helper to build a context with sane defaults, overridable per test.
function ctx(over = {}) {
  return {
    symbol: 'BTC', pair: 'BTCUSDT', price: 100,
    change1h: 0, change24h: 0, volume24h: 5_000_000,
    ema9: 100, ema21: 100, rsi14: 50, trend: 'neutral',
    ...over,
  };
}

test('LONG when trend up + positive momentum + RSI in band + volume ok', () => {
  const s = evaluateSignal(ctx({ ema9: 101, ema21: 100, change1h: 0.5, rsi14: 55 }), P);
  assert.strictEqual(s.action, 'TRADE');
  assert.strictEqual(s.side, 'LONG');
  assert.ok(Array.isArray(s.reasons) && s.reasons.length > 0);
});

test('SHORT when trend down + negative momentum + RSI in band', () => {
  const s = evaluateSignal(ctx({ ema9: 99, ema21: 100, change1h: -0.5, rsi14: 45 }), P);
  assert.strictEqual(s.action, 'TRADE');
  assert.strictEqual(s.side, 'SHORT');
});

test('SKIP a LONG that is overbought (RSI above band)', () => {
  const s = evaluateSignal(ctx({ ema9: 101, ema21: 100, change1h: 0.5, rsi14: 75 }), P);
  assert.strictEqual(s.action, 'SKIP');
  assert.strictEqual(s.side, null);
});

test('SKIP when momentum is just noise (below momentumPct)', () => {
  const s = evaluateSignal(ctx({ ema9: 101, ema21: 100, change1h: 0.05, rsi14: 55 }), P);
  assert.strictEqual(s.action, 'SKIP');
});

test('SKIP when 24h volume is below the floor', () => {
  const s = evaluateSignal(ctx({ ema9: 101, ema21: 100, change1h: 0.5, rsi14: 55, volume24h: 500_000 }), P);
  assert.strictEqual(s.action, 'SKIP');
});

test('SKIP when EMAs are flat (no trend confluence)', () => {
  const s = evaluateSignal(ctx({ ema9: 100.01, ema21: 100, change1h: 0.5, rsi14: 55 }), P);
  assert.strictEqual(s.action, 'SKIP');
});

test('SKIP when trend up but momentum is negative (conflict)', () => {
  const s = evaluateSignal(ctx({ ema9: 101, ema21: 100, change1h: -0.5, rsi14: 55 }), P);
  assert.strictEqual(s.action, 'SKIP');
});

test('computeHtfTrend — bullish/bearish/neutral by slope', () => {
  assert.strictEqual(computeHtfTrend(sloped(+1), P), 'bullish');
  assert.strictEqual(computeHtfTrend(sloped(-1), P), 'bearish');
  assert.strictEqual(computeHtfTrend(Array.from({ length: 360 }, () => 1000), P), 'neutral');
  assert.strictEqual(computeHtfTrend([1, 2, 3], P), 'neutral'); // insufficient data
});

test('HTF filter blocks a 1m LONG when the higher timeframe is bearish', () => {
  const c = { ema9: 101, ema21: 100, change1h: 0.5, rsi14: 55, closes: sloped(-1) };
  const s = evaluateSignal(ctx(c), { ...P, useHtfFilter: 1 });
  assert.strictEqual(s.action, 'SKIP');
});

test('HTF filter allows a 1m LONG when the higher timeframe is bullish', () => {
  const c = { ema9: 101, ema21: 100, change1h: 0.5, rsi14: 55, closes: sloped(+1) };
  const s = evaluateSignal(ctx(c), { ...P, useHtfFilter: 1 });
  assert.strictEqual(s.action, 'TRADE');
  assert.strictEqual(s.side, 'LONG');
});

test('HTF filter OFF ignores the higher timeframe', () => {
  const c = { ema9: 101, ema21: 100, change1h: 0.5, rsi14: 55, closes: sloped(-1) };
  const s = evaluateSignal(ctx(c), { ...P, useHtfFilter: 0 });
  assert.strictEqual(s.action, 'TRADE'); // bearish HTF ignored
});

test('HTF filter does not block when HTF data is missing (neutral)', () => {
  const s = evaluateSignal(ctx({ ema9: 101, ema21: 100, change1h: 0.5, rsi14: 55 }), { ...P, useHtfFilter: 1 });
  assert.strictEqual(s.action, 'TRADE'); // no closes → neutral → allowed
});

// ── Mean-reversion strategy ──
const MR = { ...P, strategy: 'meanreversion', useHtfFilter: 0 };

test('mean-reversion LONG when oversold AND price stretched below the mean', () => {
  // RSI 25 ≤ 30, price 99.4 vs EMA21 100 → −0.6% ≤ −0.4%
  const s = evaluateSignal(ctx({ rsi14: 25, price: 99.4, ema21: 100, ema9: 100 }), MR);
  assert.strictEqual(s.action, 'TRADE');
  assert.strictEqual(s.side, 'LONG');
});

test('mean-reversion SHORT when overbought AND price stretched above the mean', () => {
  const s = evaluateSignal(ctx({ rsi14: 75, price: 100.6, ema21: 100, ema9: 100 }), MR);
  assert.strictEqual(s.action, 'TRADE');
  assert.strictEqual(s.side, 'SHORT');
});

test('mean-reversion SKIP when RSI is extreme but price is NOT stretched', () => {
  const s = evaluateSignal(ctx({ rsi14: 25, price: 99.95, ema21: 100, ema9: 100 }), MR);
  assert.strictEqual(s.action, 'SKIP');
});

test('mean-reversion SKIP when price stretched but RSI not extreme', () => {
  const s = evaluateSignal(ctx({ rsi14: 50, price: 99.4, ema21: 100, ema9: 100 }), MR);
  assert.strictEqual(s.action, 'SKIP');
});

test('momentum and mean-reversion take OPPOSITE sides on the same oversold dip', () => {
  // Oversold dip with a little downward momentum + bearish 1m EMA.
  const dip = { rsi14: 28, price: 99.4, ema21: 100, ema9: 99.8, change1h: -0.3 };
  const mom = evaluateSignal(ctx(dip), { ...P, useHtfFilter: 0 });          // momentum
  const mr  = evaluateSignal(ctx(dip), MR);                                  // mean-reversion
  // momentum would short the breakdown; mean-reversion buys the dip
  assert.strictEqual(mr.side, 'LONG');
  assert.ok(mom.side !== 'LONG');
});

test('score is in [0,1] and higher for stronger confluence', () => {
  const weak   = evaluateSignal(ctx({ ema9: 100.2, ema21: 100, change1h: 0.25, rsi14: 66 }), P);
  const strong = evaluateSignal(ctx({ ema9: 101.5, ema21: 100, change1h: 0.9,  rsi14: 56 }), P);
  assert.ok(weak.score >= 0 && weak.score <= 1, `weak score in range, got ${weak.score}`);
  assert.ok(strong.score >= 0 && strong.score <= 1, `strong score in range, got ${strong.score}`);
  assert.ok(strong.score > weak.score, `strong (${strong.score}) should beat weak (${weak.score})`);
});
