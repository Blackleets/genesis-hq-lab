import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSignal } from '../crypto/signal.mjs';
import { DEFAULTS } from '../crypto/strategyParams.mjs';

const P = DEFAULTS;

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

test('score is in [0,1] and higher for stronger confluence', () => {
  const weak   = evaluateSignal(ctx({ ema9: 100.2, ema21: 100, change1h: 0.25, rsi14: 66 }), P);
  const strong = evaluateSignal(ctx({ ema9: 101.5, ema21: 100, change1h: 0.9,  rsi14: 56 }), P);
  assert.ok(weak.score >= 0 && weak.score <= 1, `weak score in range, got ${weak.score}`);
  assert.ok(strong.score >= 0 && strong.score <= 1, `strong score in range, got ${strong.score}`);
  assert.ok(strong.score > weak.score, `strong (${strong.score}) should beat weak (${weak.score})`);
});
