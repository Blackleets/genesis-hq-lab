import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeMetrics, MIN_TRADES_FOR_METRICS } from '../predictionMarkets/backtesting/metrics.mjs';

function makeTrades(n, winRate = 0.6, entryPrice = 0.50) {
  return Array.from({ length: n }, (_, i) => {
    const won = i < Math.floor(n * winRate);
    return {
      entryPrice,
      exitPrice: won ? 1.0 : 0.0,
      size: 10,
      feePaid: 0.02,
      slippage: 0.05,
      won,
    };
  });
}

describe('computeMetrics', () => {
  test('returns INSUFFICIENT_DATA for fewer than minimum trades', () => {
    const result = computeMetrics(makeTrades(MIN_TRADES_FOR_METRICS - 1));
    assert.equal(result.ok, false);
    assert.equal(result.error, 'INSUFFICIENT_DATA');
    assert.ok(result.minRequired > 0);
  });

  test('returns INSUFFICIENT_DATA for empty array', () => {
    const result = computeMetrics([]);
    assert.equal(result.ok, false);
    assert.equal(result.error, 'INSUFFICIENT_DATA');
  });

  test('computes correct winRate', () => {
    const trades = makeTrades(10, 0.6);
    const result = computeMetrics(trades);
    assert.equal(result.ok, true);
    assert.ok(result.metrics.winRate >= 0 && result.metrics.winRate <= 1);
    assert.ok(Math.abs(result.metrics.winRate - 0.6) < 0.05, 'winRate ~0.6');
  });

  test('includes all required metric fields', () => {
    const result = computeMetrics(makeTrades(10));
    assert.equal(result.ok, true);
    const m = result.metrics;
    assert.ok('totalTrades' in m);
    assert.ok('winRate' in m);
    assert.ok('EV' in m);
    assert.ok('maxDrawdown' in m);
    assert.ok('profitFactor' in m);
    assert.ok('fees' in m);
    assert.ok('slippageEstimate' in m);
    assert.ok('totalPnL' in m);
    assert.ok('avgPnL' in m);
    assert.ok('sharpeProxy' in m);
  });

  test('fees and slippage are non-zero', () => {
    const result = computeMetrics(makeTrades(10));
    assert.ok(result.metrics.fees > 0, 'fees > 0');
    assert.ok(result.metrics.slippageEstimate > 0, 'slippage > 0');
  });

  test('maxDrawdown is non-negative', () => {
    // Drawdown can exceed 1.0 when equity goes deeply negative (expected for losing strategies)
    const result = computeMetrics(makeTrades(20, 0.3)); // losing strategy
    assert.ok(result.metrics.maxDrawdown >= 0);
    // Note: drawdown > 1.0 is valid when cumulative equity goes below zero
  });

  test('profitFactor is positive for winning strategy', () => {
    const result = computeMetrics(makeTrades(20, 0.8));
    assert.ok(result.metrics.profitFactor > 0);
  });

  test('totalTrades matches input length', () => {
    const n = 15;
    const result = computeMetrics(makeTrades(n));
    assert.equal(result.metrics.totalTrades, n);
  });
});
