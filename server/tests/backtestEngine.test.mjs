import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBacktest } from '../crypto/backtest/backtestEngine.mjs';
import { DEFAULTS } from '../crypto/strategyParams.mjs';

// Kline: [openTime, open, high, low, close, volume, closeTime, quoteVolume, ...]
function k(openTime, { high, low, close }) {
  return [openTime, close, high, low, close, 1000, openTime + 59_999, 5_000_000, 0, 0, 0, 0];
}

// A signalFn stub that fires LONG exactly once, then always SKIPs.
function longOnce() {
  let fired = false;
  return () => {
    if (fired) return { action: 'SKIP', side: null, score: 0, reasons: [] };
    fired = true;
    return { action: 'TRADE', side: 'LONG', score: 0.8, reasons: ['stub'] };
  };
}

const MIN = 60_000;
const OPTS = (over = {}) => ({ warmup: 2, positionUsd: 100, startCapital: 10_000, signalFn: longOnce(), ...over });

test('LONG target hit produces one winning trade', () => {
  // entry at close 100 → target 101.5 (DEFAULTS). Candle 3 trades up to 102.
  const klines = [
    k(0 * MIN, { high: 100, low: 100, close: 100 }),
    k(1 * MIN, { high: 100, low: 100, close: 100 }),
    k(2 * MIN, { high: 100, low: 100, close: 100 }), // entry here
    k(3 * MIN, { high: 102, low: 100, close: 101 }), // hits target 101.5
  ];
  const { trades } = runBacktest(klines, DEFAULTS, OPTS());
  assert.strictEqual(trades.length, 1);
  assert.strictEqual(trades[0].side, 'LONG');
  assert.strictEqual(trades[0].exitReason, 'target_hit');
  assert.ok(trades[0].pnl > 0, `target win should be positive net, got ${trades[0].pnl}`);
});

test('LONG stop hit produces one losing trade', () => {
  // entry 100 → stop 99.25. Candle 3 drops to 99.
  const klines = [
    k(0 * MIN, { high: 100, low: 100, close: 100 }),
    k(1 * MIN, { high: 100, low: 100, close: 100 }),
    k(2 * MIN, { high: 100, low: 100, close: 100 }), // entry
    k(3 * MIN, { high: 100, low: 99, close: 99.5 }), // hits stop 99.25
  ];
  const { trades } = runBacktest(klines, DEFAULTS, OPTS());
  assert.strictEqual(trades.length, 1);
  assert.strictEqual(trades[0].exitReason, 'stop_loss');
  assert.ok(trades[0].pnl < 0, `stop should be a loss, got ${trades[0].pnl}`);
});

test('timeout closes the position at candle close when no level is touched', () => {
  // 1h spacing, timeoutHours=1 → next candle after entry triggers timeout.
  const HOUR = 60 * MIN;
  const klines = [
    k(0 * HOUR, { high: 100, low: 100, close: 100 }),
    k(1 * HOUR, { high: 100, low: 100, close: 100 }),
    k(2 * HOUR, { high: 100, low: 100, close: 100 }),   // entry
    k(3 * HOUR, { high: 100.2, low: 99.9, close: 100 }), // within band → timeout
  ];
  const params = { ...DEFAULTS, timeoutHours: 1 };
  const { trades } = runBacktest(klines, params, OPTS());
  assert.strictEqual(trades.length, 1);
  assert.strictEqual(trades[0].exitReason, 'timeout');
});

test('returns metrics alongside trades', () => {
  const klines = [
    k(0 * MIN, { high: 100, low: 100, close: 100 }),
    k(1 * MIN, { high: 100, low: 100, close: 100 }),
    k(2 * MIN, { high: 100, low: 100, close: 100 }),
    k(3 * MIN, { high: 102, low: 100, close: 101 }),
  ];
  const { metrics } = runBacktest(klines, DEFAULTS, OPTS());
  assert.strictEqual(metrics.trades, 1);
  assert.strictEqual(metrics.wins, 1);
});

test('no signal → no trades, zeroed metrics', () => {
  const klines = [
    k(0 * MIN, { high: 100, low: 100, close: 100 }),
    k(1 * MIN, { high: 100, low: 100, close: 100 }),
    k(2 * MIN, { high: 100, low: 100, close: 100 }),
  ];
  const neverFire = () => ({ action: 'SKIP', side: null, score: 0, reasons: [] });
  const { trades, metrics } = runBacktest(klines, DEFAULTS, OPTS({ signalFn: neverFire }));
  assert.strictEqual(trades.length, 0);
  assert.strictEqual(metrics.trades, 0);
});
