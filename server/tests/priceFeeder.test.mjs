import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeEma, computeRsi, buildAssetContext } from '../crypto/priceFeeder.mjs';

test('computeEma — single value returns that value', () => {
  assert.strictEqual(computeEma([100], 9), 100);
});

test('computeEma — rising series, EMA9 > EMA21', () => {
  const closes = Array.from({ length: 25 }, (_, i) => 100 + i);
  const e9  = computeEma(closes, 9);
  const e21 = computeEma(closes, 21);
  assert.ok(e9 > e21, `EMA9 ${e9} should be > EMA21 ${e21} for rising series`);
});

test('computeRsi — all gains returns near 100', () => {
  const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
  const rsi = computeRsi(closes, 14);
  assert.ok(rsi > 90, `RSI should be >90 for all-gain series, got ${rsi}`);
});

test('computeRsi — all losses returns near 0', () => {
  const closes = Array.from({ length: 20 }, (_, i) => 120 - i);
  const rsi = computeRsi(closes, 14);
  assert.ok(rsi < 10, `RSI should be <10 for all-loss series, got ${rsi}`);
});

test('computeRsi — flat series returns 50', () => {
  const closes = Array.from({ length: 20 }, () => 100);
  const rsi = computeRsi(closes, 14);
  assert.strictEqual(rsi, 50);
});

test('buildAssetContext — returns correct structure from mock klines', () => {
  const klines = Array.from({ length: 30 }, (_, i) => [
    Date.now() - (30 - i) * 60000,
    String(100 + i), String(101 + i), String(99 + i), String(100.5 + i),
    String(1000), 0, 0, 0, 0, 0, 0,
  ]);
  const ticker = { lastPrice: '129.5', priceChangePercent: '1.5', quoteVolume: '5000000' };
  const ctx = buildAssetContext('BTC', 'BTCUSDT', klines, ticker);
  assert.strictEqual(ctx.symbol, 'BTC');
  assert.strictEqual(ctx.pair, 'BTCUSDT');
  assert.ok(typeof ctx.price === 'number');
  assert.ok(typeof ctx.ema9 === 'number');
  assert.ok(typeof ctx.ema21 === 'number');
  assert.ok(typeof ctx.rsi14 === 'number');
  assert.ok(['bullish', 'bearish', 'neutral'].includes(ctx.trend));
});
