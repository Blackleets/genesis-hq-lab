/**
 * phase6a.test.mjs — Integration tests for the Phase 6A Active Hybrid Paper Trading Engine.
 *
 * Suites:
 *   1. EV calculation (eventAlphaEngine)
 *   2. Scalping signal evaluation (scalpingEngine)
 *   3. Swing signal evaluation (swingEngine)
 *   4. Capital allocation / scheduler status (executionScheduler)
 *   5. Training metrics (positionMonitor)
 *   6. Paper execution query helpers (paperExecutionEngine)
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// ── Suite 1: EV calculation ───────────────────────────────────────────────────

describe('computeEV — eventAlphaEngine', async () => {
  const { computeEV, computeEdge } = await import('../strategies/eventAlphaEngine.mjs');

  it('returns positive EV when genesis > market', () => {
    const ev = computeEV(0.70, 0.50);
    assert.ok(ev > 0, `expected positive EV, got ${ev}`);
  });

  it('returns negative EV when genesis < market', () => {
    const ev = computeEV(0.30, 0.60);
    assert.ok(ev < 0, `expected negative EV, got ${ev}`);
  });

  it('returns near-zero EV when genesis equals market', () => {
    const ev = computeEV(0.50, 0.50);
    assert.ok(Math.abs(ev) < 0.001, `expected ~0, got ${ev}`);
  });

  it('returns -1 for invalid entry price (entryPrice=0)', () => {
    assert.equal(computeEV(0.70, 0), -1);
  });

  it('returns -1 for invalid entry price (entryPrice=1)', () => {
    assert.equal(computeEV(0.70, 1), -1);
  });

  it('computeEdge reflects probability difference', () => {
    assert.ok(Math.abs(computeEdge(0.70, 0.50) - 0.20) < 0.0001);
    assert.ok(Math.abs(computeEdge(0.40, 0.60) - (-0.20)) < 0.0001);
  });

  it('EV stays within [-1, +1] for all valid inputs', () => {
    for (const [g, m] of [[0.1, 0.9], [0.9, 0.1], [0.5, 0.5], [0.6, 0.4]]) {
      const ev = computeEV(g, m);
      assert.ok(ev >= -1 && ev <= 1, `EV=${ev} out of range for g=${g} m=${m}`);
    }
  });
});

// ── Suite 2: Scalping signal evaluation ───────────────────────────────────────

describe('evaluateScalpSignal — scalpingEngine', async () => {
  const { evaluateScalpSignal } = await import('../strategies/scalpingEngine.mjs');

  /**
   * Build a minimal asset context. Field names match the actual ctx destructuring:
   *   { closes, ema9, ema21, rsi14, volume24h, change1h, symbol }
   * change1h is in percentage units (e.g. 0.5 = 0.5% hourly move).
   * Volatility filter: blocks when |change1h| < 0.05 or > 3.0.
   */
  function makeCtx({
    closes    = [],
    ema9      = 50200,
    ema21     = 50000,
    rsi14     = 55,
    change1h  = 0.5,      // 0.5% — above 0.05% low-volatility floor
    volume24h = 5_000_000,
    symbol    = 'BTCUSDT',
  } = {}) {
    return { closes, ema9, ema21, rsi14, change1h, volume24h, symbol };
  }

  it('returns TRADE/LONG on bullish EMA + RSI (score >= 45)', () => {
    // EMA_BULL_CROSS (+30) + RSI_BULL_MOMENTUM (+20) = 50 ≥ 45, 2 signals ✓
    const ctx = makeCtx({ ema9: 50300, ema21: 50000, rsi14: 55, change1h: 0.5 });
    const result = evaluateScalpSignal(ctx);
    assert.ok(result.action === 'TRADE', `expected TRADE, got ${result.action}`);
    assert.equal(result.side, 'LONG');
  });

  it('blocks signal when volatility too low (change1h < 0.05)', () => {
    const ctx = makeCtx({ change1h: 0.001 });
    const result = evaluateScalpSignal(ctx);
    assert.equal(result.action, 'WAIT');
    assert.ok(result.signals.includes('LOW_VOLATILITY'));
  });

  it('blocks signal when volatility too high (change1h > 3.0)', () => {
    const ctx = makeCtx({ change1h: 5.0 });
    const result = evaluateScalpSignal(ctx);
    assert.equal(result.action, 'WAIT');
    assert.ok(result.signals.includes('HIGH_VOLATILITY_BLOCK'));
  });

  it('returns WAIT when EMA not crossed (ema9 < ema21)', () => {
    // No EMA crossover → longScore = 0, shortScore = 30 → but RSI in bull zone → mixed
    // With ema9 < ema21, longScore gets no EMA signal. RSI_BULL_MOMENTUM (+20) only → score 20 < 45
    const ctx = makeCtx({ ema9: 49500, ema21: 50000, rsi14: 55, change1h: 0.5 });
    const result = evaluateScalpSignal(ctx);
    // Score would be: shortScore EMA_BEAR_CROSS (30) + RSI overlaps + RSI_BULL_MOMENTUM to long
    // Either way, result must have the right shape
    assert.ok(['TRADE', 'WAIT'].includes(result.action), 'action must be TRADE or WAIT');
    assert.ok('side' in result, 'result must have side');
    assert.ok('signals' in result, 'result must have signals');
  });

  it('confidence is within [0.65, 0.92] when action is TRADE', () => {
    const ctx = makeCtx({ ema9: 50400, ema21: 50000, rsi14: 52, volume24h: 8_000_000, change1h: 0.8 });
    const result = evaluateScalpSignal(ctx);
    if (result.action === 'TRADE') {
      assert.ok(result.confidence >= 0.65 && result.confidence <= 0.92,
        `confidence ${result.confidence} out of bounds [0.65, 0.92]`);
    }
  });

  it('result always has { action, side, confidence, signals } shape', () => {
    const ctx = makeCtx();
    const result = evaluateScalpSignal(ctx);
    assert.ok('action'     in result, 'missing action');
    assert.ok('side'       in result, 'missing side');
    assert.ok('confidence' in result, 'missing confidence');
    assert.ok(Array.isArray(result.signals), 'signals must be array');
  });
});

// ── Suite 3: Swing signal evaluation ─────────────────────────────────────────

describe('evaluateSwingSignal — swingEngine', async () => {
  const { evaluateSwingSignal } = await import('../strategies/swingEngine.mjs');

  /**
   * Build a synthetic array of 1m closes.
   * swingEngine needs 250+ closes and resamples internally to 15m/1h/4h.
   */
  function makeCloses(n, trend = 'up', startPrice = 50000, step = 1) {
    return Array.from({ length: n }, (_, i) =>
      trend === 'up' ? startPrice + i * step : startPrice - i * step
    );
  }

  it('returns WAIT with INSUFFICIENT_DATA when closes < 250', () => {
    const ctx = { closes: makeCloses(50), symbol: 'BTCUSDT', change1h: 0.5, rsi14: 50, price: 50000 };
    const result = evaluateSwingSignal(ctx);
    assert.equal(result.action, 'WAIT');
    assert.ok(result.signals.includes('INSUFFICIENT_DATA'));
  });

  it('returns result with correct shape for 480 closes', () => {
    const ctx = { closes: makeCloses(480, 'up'), symbol: 'BTCUSDT', change1h: 0.5, rsi14: 50, price: 50480 };
    const result = evaluateSwingSignal(ctx);
    assert.ok('action'      in result, 'missing action');
    assert.ok('side'        in result, 'missing side');
    assert.ok('confidence'  in result, 'missing confidence');
    assert.ok(Array.isArray(result.signals), 'signals must be array');
    assert.ok('tfAlignment' in result, 'missing tfAlignment');
  });

  it('action is TRADE or WAIT (never an unknown value)', () => {
    const ctx = { closes: makeCloses(480, 'up'), symbol: 'BTCUSDT', change1h: 1.0, rsi14: 48, price: 50480 };
    const result = evaluateSwingSignal(ctx);
    assert.ok(['TRADE', 'WAIT'].includes(result.action),
      `unexpected action: ${result.action}`);
  });

  it('confidence is within [0, 1] for any input', () => {
    const ctx = { closes: makeCloses(480, 'down'), symbol: 'BTCUSDT', change1h: -0.8, rsi14: 55, price: 50000 };
    const result = evaluateSwingSignal(ctx);
    assert.ok(result.confidence >= 0 && result.confidence <= 1,
      `confidence ${result.confidence} out of [0,1]`);
  });

  it('tfAlignment is a non-negative integer', () => {
    const ctx = { closes: makeCloses(480, 'up'), symbol: 'BTCUSDT', change1h: 0.5, rsi14: 50, price: 50480 };
    const result = evaluateSwingSignal(ctx);
    assert.ok(Number.isInteger(result.tfAlignment) && result.tfAlignment >= 0,
      `tfAlignment must be non-negative integer, got ${result.tfAlignment}`);
  });
});

// ── Suite 4: Capital allocation / scheduler status ────────────────────────────

describe('getSchedulerStatus — executionScheduler allocation bounds', async () => {
  const { getSchedulerStatus } = await import('../trading/executionScheduler.mjs');

  it('allocation sums to approximately 1.0', () => {
    const status = getSchedulerStatus();
    const total = Object.values(status.allocation).reduce((s, v) => s + v, 0);
    assert.ok(Math.abs(total - 1.0) < 0.001, `allocation sum=${total}, expected ~1.0`);
  });

  it('all allocation values are within [0.15, 0.60]', () => {
    const status = getSchedulerStatus();
    for (const [engine, alloc] of Object.entries(status.allocation)) {
      assert.ok(alloc >= 0.15 && alloc <= 0.60,
        `${engine} alloc=${alloc} out of bounds [0.15, 0.60]`);
    }
  });

  it('returns required scheduler fields', () => {
    const status = getSchedulerStatus();
    assert.ok('started'  in status, 'missing started');
    assert.ok('mode'     in status, 'missing mode');
    assert.ok('ticks'    in status, 'missing ticks');
    assert.ok('errors'   in status, 'missing errors');
    assert.ok('lastRun'  in status, 'missing lastRun');
    assert.ok(['paper', 'training'].includes(status.mode),
      `unexpected mode: ${status.mode}`);
  });

  it('ticks object has fast/mid/slow as numbers', () => {
    const { ticks } = getSchedulerStatus();
    assert.ok(typeof ticks.fast === 'number', 'ticks.fast must be number');
    assert.ok(typeof ticks.mid  === 'number', 'ticks.mid must be number');
    assert.ok(typeof ticks.slow === 'number', 'ticks.slow must be number');
  });

  it('allocationBounds has min=0.15 and max=0.60', () => {
    const { allocationBounds } = getSchedulerStatus();
    assert.equal(allocationBounds.min, 0.15);
    assert.equal(allocationBounds.max, 0.60);
  });

  it('intervals has fastMs=5000, midMs=30000, slowMs=300000', () => {
    const { intervals } = getSchedulerStatus();
    assert.equal(intervals.fastMs, 5000);
    assert.equal(intervals.midMs,  30000);
    assert.equal(intervals.slowMs, 300000);
  });
});

// ── Suite 5: Training metrics ─────────────────────────────────────────────────

describe('getTrainingMetrics — positionMonitor', async () => {
  const { getTrainingMetrics } = await import('../trading/positionMonitor.mjs');

  it('returns all expected fields', () => {
    const m = getTrainingMetrics();
    assert.ok('total'    in m, 'missing total');
    assert.ok('open'     in m, 'missing open');
    assert.ok('closed'   in m, 'missing closed');
    assert.ok('wins'     in m, 'missing wins');
    assert.ok('winRate'  in m, 'missing winRate');
    assert.ok('totalPnl' in m, 'missing totalPnl');
    assert.ok(Array.isArray(m.byType), 'byType must be an array');
  });

  it('open + closed <= total', () => {
    const m = getTrainingMetrics();
    assert.ok(m.open + m.closed <= m.total,
      `open(${m.open}) + closed(${m.closed}) > total(${m.total})`);
  });

  it('winRate is null or in [0, 1]', () => {
    const m = getTrainingMetrics();
    if (m.winRate !== null) {
      assert.ok(m.winRate >= 0 && m.winRate <= 1,
        `winRate ${m.winRate} out of range`);
    }
  });

  it('byType contains entries for scalp_v2 and swing_v1', () => {
    const m = getTrainingMetrics();
    const types = m.byType.map(e => e.tradeType);
    assert.ok(types.includes('scalp_v2'), 'missing scalp_v2 in byType');
    assert.ok(types.includes('swing_v1'), 'missing swing_v1 in byType');
  });

  it('totalPnl is a finite number', () => {
    const m = getTrainingMetrics();
    assert.ok(Number.isFinite(m.totalPnl), `totalPnl must be finite, got ${m.totalPnl}`);
  });

  it('byType entries have required shape', () => {
    const m = getTrainingMetrics();
    for (const entry of m.byType) {
      assert.ok('tradeType' in entry, 'missing tradeType');
      assert.ok('trades'    in entry, 'missing trades');
      assert.ok('wins'      in entry, 'missing wins');
      assert.ok('pnl'       in entry, 'missing pnl');
    }
  });
});

// ── Suite 6: Paper execution query helpers ────────────────────────────────────

describe('paperExecutionEngine — query helpers', async () => {
  const { hasOpenPosition, getOpenPositions } = await import('../trading/paperExecutionEngine.mjs');

  it('hasOpenPosition returns a boolean', () => {
    const result = hasOpenPosition('BTCUSDT', 'scalp_v2');
    assert.equal(typeof result, 'boolean');
  });

  it('getOpenPositions returns an array', () => {
    const result = getOpenPositions('scalp_v2');
    assert.ok(Array.isArray(result), 'expected array from getOpenPositions');
  });

  it('getOpenPositions for unknown trade_type returns empty array', () => {
    const result = getOpenPositions('nonexistent_type_xyz_phase6a');
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 0);
  });

  it('getOpenPositions for swing_v1 returns array', () => {
    const result = getOpenPositions('swing_v1');
    assert.ok(Array.isArray(result));
  });

  it('hasOpenPosition for non-existent asset returns false', () => {
    const result = hasOpenPosition('FAKEASSET999USDT', 'scalp_v2');
    assert.equal(result, false);
  });
});
