import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const { classifyRegime, applyRegimeBias, BIAS } = await import('../crypto/regime.mjs');

// Build a ctx. closes long enough that computeHtfTrend can resample; direction set by slope.
function ctx({ ema9, ema21, change1h, trend = 'flat' }) {
  const n = 360;
  const closes = [];
  for (let i = 0; i < n; i++) {
    const base = 100;
    const slope = trend === 'up' ? 0.05 : trend === 'down' ? -0.05 : 0;
    closes.push(base + slope * i);
  }
  return { ema9, ema21, change1h, closes };
}

describe('classifyRegime', () => {
  it('STRONG_BULL: htf up + ema up + strong momentum', () => {
    assert.equal(classifyRegime(ctx({ ema9: 101, ema21: 100, change1h: 0.8, trend: 'up' })), 'STRONG_BULL');
  });
  it('BULL: ema up + mild momentum, flat htf', () => {
    assert.equal(classifyRegime(ctx({ ema9: 100.3, ema21: 100, change1h: 0.6, trend: 'flat' })), 'BULL');
  });
  it('RANGE: everything flat', () => {
    assert.equal(classifyRegime(ctx({ ema9: 100.0, ema21: 100, change1h: 0.1, trend: 'flat' })), 'RANGE');
  });
  it('BEAR: ema down + mild down momentum', () => {
    assert.equal(classifyRegime(ctx({ ema9: 99.7, ema21: 100, change1h: -0.6, trend: 'flat' })), 'BEAR');
  });
  it('STRONG_BEAR: htf down + ema down + strong down momentum', () => {
    assert.equal(classifyRegime(ctx({ ema9: 99, ema21: 100, change1h: -0.8, trend: 'down' })), 'STRONG_BEAR');
  });
  it('HIGH_VOLATILITY: violent 1h move overrides direction', () => {
    assert.equal(classifyRegime(ctx({ ema9: 103, ema21: 100, change1h: 3.0, trend: 'up' })), 'HIGH_VOLATILITY');
  });
  it('defaults to RANGE on bad data', () => {
    assert.equal(classifyRegime({ ema9: NaN, ema21: 100, change1h: 0 }), 'RANGE');
  });
});

describe('applyRegimeBias', () => {
  it('STRONG_BULL penalises SHORT by 20 points', () => {
    const r = applyRegimeBias(0.70, 'SHORT', 'STRONG_BULL');
    assert.ok(Math.abs(r.confidence - 0.50) < 1e-9, `got ${r.confidence}`);
    assert.equal(r.bias, -20);
  });
  it('STRONG_BULL boosts LONG but clamps at 0.92', () => {
    const r = applyRegimeBias(0.85, 'LONG', 'STRONG_BULL');
    assert.equal(r.confidence, 0.92);  // 0.85 + 0.10 = 0.95 → clamped
  });
  it('RANGE leaves confidence unchanged', () => {
    const r = applyRegimeBias(0.71, 'LONG', 'RANGE');
    assert.equal(r.confidence, 0.71);
    assert.equal(r.bias, 0);
  });
  it('HIGH_VOLATILITY penalises both sides by 5', () => {
    assert.equal(applyRegimeBias(0.70, 'LONG', 'HIGH_VOLATILITY').bias, -5);
    assert.equal(applyRegimeBias(0.70, 'SHORT', 'HIGH_VOLATILITY').bias, -5);
  });
  it('never goes below 0', () => {
    const r = applyRegimeBias(0.10, 'LONG', 'STRONG_BEAR'); // -20
    assert.ok(r.confidence >= 0);
  });
});

describe('the regression this fixes: bad countertrend short', () => {
  it('a 0.70 SHORT in STRONG_BULL falls below the 0.65 gate (rejected)', () => {
    const r = applyRegimeBias(0.70, 'SHORT', 'STRONG_BULL');
    assert.ok(r.confidence < 0.65, `expected < gate, got ${r.confidence}`);
  });
  it('a 0.66 LONG in STRONG_BULL stays above the gate (kept)', () => {
    const r = applyRegimeBias(0.66, 'LONG', 'STRONG_BULL');
    assert.ok(r.confidence >= 0.65);
  });
});
