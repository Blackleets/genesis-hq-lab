import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeMetrics } from '../crypto/backtest/metrics.mjs';

test('empty trade list → zeroed metrics', () => {
  const m = computeMetrics([], { startCapital: 10_000 });
  assert.strictEqual(m.trades, 0);
  assert.strictEqual(m.winRate, 0);
  assert.strictEqual(m.netPnl, 0);
  assert.strictEqual(m.expectancy, 0);
});

test('counts wins/losses and win rate', () => {
  const m = computeMetrics([
    { pnl: 10, capitalUsed: 100 },
    { pnl: -5, capitalUsed: 100 },
    { pnl: 20, capitalUsed: 100 },
  ], { startCapital: 10_000 });
  assert.strictEqual(m.trades, 3);
  assert.strictEqual(m.wins, 2);
  assert.strictEqual(m.losses, 1);
  assert.ok(Math.abs(m.winRate - 2 / 3) < 1e-9);
  assert.strictEqual(m.netPnl, 25);
});

test('profit factor = gross profit / gross loss', () => {
  const m = computeMetrics([
    { pnl: 30, capitalUsed: 100 },
    { pnl: -10, capitalUsed: 100 },
    { pnl: -5, capitalUsed: 100 },
  ], { startCapital: 10_000 });
  // grossProfit 30, grossLoss 15 → PF 2
  assert.ok(Math.abs(m.profitFactor - 2) < 1e-9, `PF expected 2, got ${m.profitFactor}`);
});

test('expectancy = average pnl per trade', () => {
  const m = computeMetrics([
    { pnl: 10, capitalUsed: 100 },
    { pnl: -4, capitalUsed: 100 },
  ], { startCapital: 10_000 });
  assert.ok(Math.abs(m.expectancy - 3) < 1e-9);
});

test('max drawdown captures the worst peak-to-trough on the equity curve', () => {
  // equity: 10000 → 10100 → 10050 → 9900 → 10200
  // peak 10100, trough 9900 → drawdown (10100-9900)/10100 ≈ 0.0198
  const m = computeMetrics([
    { pnl: 100, capitalUsed: 100 },
    { pnl: -50, capitalUsed: 100 },
    { pnl: -150, capitalUsed: 100 },
    { pnl: 300, capitalUsed: 100 },
  ], { startCapital: 10_000 });
  assert.ok(Math.abs(m.maxDrawdown - (200 / 10100)) < 1e-6, `got ${m.maxDrawdown}`);
});

test('roi = net pnl over total capital risked', () => {
  const m = computeMetrics([
    { pnl: 10, capitalUsed: 100 },
    { pnl: -5, capitalUsed: 100 },
  ], { startCapital: 10_000 });
  assert.ok(Math.abs(m.roi - (5 / 200)) < 1e-9, `got ${m.roi}`);
});

test('no losses → profitFactor is finite (not NaN/Infinity in output)', () => {
  const m = computeMetrics([{ pnl: 10, capitalUsed: 100 }], { startCapital: 10_000 });
  assert.ok(Number.isFinite(m.profitFactor) || m.profitFactor === null, `got ${m.profitFactor}`);
});
