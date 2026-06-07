// trainingTuning.test.mjs — guards the training-mode thresholds so the paper
// engines actually generate enough trades to learn from.
//
// Root cause this protects against: the scalp confidence GATE was set ABOVE the
// scalp engine's minimum producible TRADE confidence (0.65), so every borderline
// (score 45–49) signal was generated and then immediately rejected — zero trades.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const { evaluateScalpSignal, scalpConfig } = await import('../strategies/scalpingEngine.mjs');
const { swingConfig } = await import('../strategies/swingEngine.mjs');
const { eventConfig } = await import('../strategies/eventAlphaEngine.mjs');

describe('scalp confidence floor vs gate (the regression that starved training)', () => {
  // The minimum confidence evaluateScalpSignal can EVER return for action='TRADE'.
  // From the formula: confidence = 0.65 + (score-45)/100, qualifying score ≥ 45 → 0.65.
  const ENGINE_FLOOR = 0.65;

  it('a minimal valid signal produces action=TRADE at the 0.65 floor', () => {
    // Build a ctx that yields exactly the minimum qualifying confluence:
    // EMA bull cross (30) + RSI bull momentum (20) = score 50 → but we want a
    // borderline case. Use EMA cross (30) + RSI (20) → 50 → conf 0.70. For the
    // floor, drop one signal's contribution by keeping score at 45 via volume.
    const ctx = {
      symbol: 'TST', closes: Array.from({ length: 20 }, (_, i) => 100 + i * 0.01),
      ema9: 100.2, ema21: 100, rsi14: 55, volume24h: 5_000_000, change1h: 0.5,
    };
    const s = evaluateScalpSignal(ctx);
    assert.equal(s.action, 'TRADE', `expected TRADE, got ${s.action} (score ${s.score})`);
    assert.ok(s.confidence >= ENGINE_FLOOR, `confidence ${s.confidence} below floor`);
  });

  it('the scalp gate does NOT exceed the engine confidence floor', () => {
    // This is THE invariant. If the gate > 0.65, borderline trades are auto-rejected.
    assert.ok(
      scalpConfig().minConfidence <= ENGINE_FLOOR,
      `scalp gate ${scalpConfig().minConfidence} exceeds engine floor ${ENGINE_FLOOR} — training starves`
    );
  });
});

describe('training-mode thresholds are conservative-but-active', () => {
  it('scalp confidence gate is in the 0.60–0.65 training band', () => {
    const c = scalpConfig().minConfidence;
    assert.ok(c >= 0.60 && c <= 0.65, `scalp minConfidence ${c} outside [0.60, 0.65]`);
  });
  it('swing confidence gate is ~0.70 (stricter than scalp, not 0.80+)', () => {
    const c = swingConfig().minConfidence;
    assert.ok(c >= 0.68 && c <= 0.75, `swing minConfidence ${c} outside [0.68, 0.75]`);
  });
  it('event EV threshold is a realistic positive edge (≤ 5%)', () => {
    const ev = eventConfig().evThreshold;
    assert.ok(ev > 0 && ev <= 0.05, `event EV threshold ${ev} not in (0, 0.05]`);
  });
});
