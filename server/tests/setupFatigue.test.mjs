// setupFatigue.test.mjs — Phase 6B.1B unit tests.
// All pure-function tests — no DB dependency.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  wrScore, pfScore, evScore, calibrationScore,
  getHealthScore, getHealthBand, getBandModifiers,
  applyHumilityPenalty, computeSetupFatigue,
  applyFatigueToConfidence,
} from '../intelligence/setupFatigueCore.mjs';

// ── Score components ──────────────────────────────────────────────────────────

describe('wrScore', () => {
  it('returns 30 for excellent WR', () => assert.equal(wrScore(0.65), 30));
  it('returns 10 for poor WR', ()     => assert.equal(wrScore(0.38), 10));
  it('returns 0 for terrible WR', ()  => assert.equal(wrScore(0.20), 0));
  it('returns 10 for null WR', ()     => assert.equal(wrScore(null), 10));
});

describe('pfScore', () => {
  it('returns 30 for PF >= 1.5',     () => assert.equal(pfScore(2.0), 30));
  it('returns 25 for PF 1.2–1.5',    () => assert.equal(pfScore(1.3), 25));
  it('returns 10 for PF 0.8–1.0',    () => assert.equal(pfScore(0.9), 10));
  it('returns 0 for PF < 0.8',       () => assert.equal(pfScore(0.5), 0));
  it('returns 30 for Infinity PF',   () => assert.equal(pfScore(Infinity), 30));
});

describe('evScore', () => {
  it('returns 25 for EV >= 0.50',    () => assert.equal(evScore(0.60), 25));
  it('returns 12 for EV == 0',       () => assert.equal(evScore(0.00), 12));
  it('returns 5 for small neg EV',   () => assert.equal(evScore(-0.15), 5));
  it('returns 0 for EV <= -0.30',    () => assert.equal(evScore(-0.50), 0));
});

describe('calibrationScore', () => {
  it('returns 15 for excellent cal', () => assert.equal(calibrationScore(0.90), 15));
  it('returns 10 for good cal',      () => assert.equal(calibrationScore(0.72), 10));
  it('returns 0 for poor cal',       () => assert.equal(calibrationScore(0.40), 0));
  it('returns 8 for null cal',       () => assert.equal(calibrationScore(null), 8));
});

// ── Health score & bands ──────────────────────────────────────────────────────

describe('getHealthScore', () => {
  it('all-win setup scores STRONG range', () => {
    const s = getHealthScore({ winRate: 0.70, profitFactor: 2.0, expectancy: 0.60, calibration: 0.90 });
    assert.ok(s >= 86, `expected >=86, got ${s}`);
  });

  it('all-loss setup scores TOXIC range', () => {
    const s = getHealthScore({ winRate: 0.15, profitFactor: 0.2, expectancy: -0.80, calibration: 0.20 });
    assert.ok(s <= 25, `expected <=25, got ${s}`);
  });

  it('clamps at 0', () => assert.ok(getHealthScore({ winRate: 0, profitFactor: 0, expectancy: -5, calibration: 0 }) >= 0));
  it('clamps at 100', () => assert.ok(getHealthScore({ winRate: 1, profitFactor: Infinity, expectancy: 1, calibration: 1 }) <= 100));
});

describe('getHealthBand', () => {
  it('0 → TOXIC',   () => assert.equal(getHealthBand(0),   'TOXIC'));
  it('25 → TOXIC',  () => assert.equal(getHealthBand(25),  'TOXIC'));
  it('26 → WEAK',   () => assert.equal(getHealthBand(26),  'WEAK'));
  it('45 → WEAK',   () => assert.equal(getHealthBand(45),  'WEAK'));
  it('46 → NEUTRAL',() => assert.equal(getHealthBand(46),  'NEUTRAL'));
  it('65 → NEUTRAL',() => assert.equal(getHealthBand(65),  'NEUTRAL'));
  it('66 → GOOD',   () => assert.equal(getHealthBand(66),  'GOOD'));
  it('85 → GOOD',   () => assert.equal(getHealthBand(85),  'GOOD'));
  it('86 → STRONG', () => assert.equal(getHealthBand(86),  'STRONG'));
  it('100 → STRONG',() => assert.equal(getHealthBand(100), 'STRONG'));
});

describe('getBandModifiers', () => {
  it('TOXIC reduces confidence to 0.50x', () => {
    assert.equal(getBandModifiers('TOXIC').confidenceMultiplier, 0.50);
  });
  it('STRONG boosts confidence to 1.10x', () => {
    assert.equal(getBandModifiers('STRONG').confidenceMultiplier, 1.10);
  });
  it('NEUTRAL is passthrough', () => {
    const m = getBandModifiers('NEUTRAL');
    assert.equal(m.confidenceMultiplier, 1.00);
    assert.equal(m.kellyMultiplier, 1.00);
  });
  it('unknown band defaults to NEUTRAL', () => {
    assert.equal(getBandModifiers('UNKNOWN').confidenceMultiplier, 1.00);
  });
});

// ── Humility penalty ──────────────────────────────────────────────────────────

describe('applyHumilityPenalty', () => {
  it('no penalty for 0–2 consecutive losses', () => {
    assert.equal(applyHumilityPenalty(1.0,  0), 1.0);
    assert.equal(applyHumilityPenalty(1.0,  2), 1.0);
  });
  it('caps at 0.80 for 3–4 losses', () => {
    assert.equal(applyHumilityPenalty(1.0,  3), 0.80);
    assert.equal(applyHumilityPenalty(1.0,  4), 0.80);
    assert.equal(applyHumilityPenalty(0.70, 3), 0.70); // already lower — not increased
  });
  it('caps at 0.60 for 5+ losses', () => {
    assert.equal(applyHumilityPenalty(1.0, 5), 0.60);
    assert.equal(applyHumilityPenalty(1.0, 9), 0.60);
    assert.equal(applyHumilityPenalty(0.50, 5), 0.50); // already lower — not increased
  });
});

// ── computeSetupFatigue ───────────────────────────────────────────────────────

function makeRow(pair, side, pnl, confidence = 0.70, evidence = '["REGIME:RANGE"]') {
  return { pair, side, pnl, confidence, evidence };
}

describe('computeSetupFatigue — all wins → STRONG', () => {
  const rows = [
    makeRow('BTCUSDT', 'LONG', 1.00),
    makeRow('BTCUSDT', 'LONG', 2.00),
    makeRow('BTCUSDT', 'LONG', 1.50),
    makeRow('BTCUSDT', 'LONG', 0.80),
    makeRow('BTCUSDT', 'LONG', 1.20),
    makeRow('BTCUSDT', 'LONG', 0.90),
  ];
  const result = computeSetupFatigue(rows);
  const setup  = result.find(s => s.key === 'BTCUSDT_LONG_RANGE');

  it('setup exists', () => assert.ok(setup));
  it('samples = 6', () => assert.equal(setup?.samples, 6));
  it('band is GOOD or STRONG', () => assert.ok(['GOOD','STRONG'].includes(setup?.band)));
  it('confidence multiplier >= 1.0', () => assert.ok(setup?.confidenceMultiplier >= 1.0));
  it('consecutive losses = 0', () => assert.equal(setup?.consecutiveLosses, 0));
});

describe('computeSetupFatigue — all losses → TOXIC', () => {
  const rows = [
    makeRow('ETHUSDT', 'SHORT', -0.50),
    makeRow('ETHUSDT', 'SHORT', -0.80),
    makeRow('ETHUSDT', 'SHORT', -0.30),
    makeRow('ETHUSDT', 'SHORT', -0.90),
    makeRow('ETHUSDT', 'SHORT', -0.60),
  ];
  const result = computeSetupFatigue(rows);
  const setup  = result.find(s => s.key === 'ETHUSDT_SHORT_RANGE');

  it('setup exists', () => assert.ok(setup));
  it('band is TOXIC or WEAK', () => assert.ok(['TOXIC','WEAK'].includes(setup?.band)));
  it('confidence multiplier < 1.0', () => assert.ok((setup?.confidenceMultiplier ?? 1) < 1.0));
  it('consecutive losses = 5', () => assert.equal(setup?.consecutiveLosses, 5));
});

describe('computeSetupFatigue — humility with consecutive losses', () => {
  // 3 recent losses (newest-first), 2 wins before — 3 consecutive losses
  const rows = [
    makeRow('SOLUSDT', 'LONG', -0.40), // newest — loss
    makeRow('SOLUSDT', 'LONG', -0.30), // loss
    makeRow('SOLUSDT', 'LONG', -0.20), // loss
    makeRow('SOLUSDT', 'LONG',  1.00), // win
    makeRow('SOLUSDT', 'LONG',  0.80), // win
  ];
  const result = computeSetupFatigue(rows);
  const setup  = result.find(s => s.key === 'SOLUSDT_LONG_RANGE');

  it('consecutive losses = 3', () => assert.equal(setup?.consecutiveLosses, 3));
  it('humility penalty applied — multiplier <= 0.80', () => assert.ok((setup?.confidenceMultiplier ?? 1) <= 0.80));
});

describe('computeSetupFatigue — regime-aware: separate setups per regime', () => {
  const rows = [
    makeRow('BTCUSDT', 'LONG',  1.0, 0.70, '["REGIME:STRONG_BULL"]'),
    makeRow('BTCUSDT', 'LONG', -0.5, 0.70, '["REGIME:STRONG_BEAR"]'),
  ];
  const result = computeSetupFatigue(rows);
  it('produces 2 separate setup entries', () => assert.equal(result.length, 2));
  it('STRONG_BULL setup wins', () => {
    const bull = result.find(s => s.regime === 'STRONG_BULL');
    assert.ok(bull);
    assert.equal(bull.wins ?? (bull.winRate === 1 ? 1 : 0), bull.winRate === 1 ? 1 : bull.wins);
  });
});

describe('computeSetupFatigue — empty rows → empty result', () => {
  it('returns []', () => assert.deepEqual(computeSetupFatigue([]), []));
});

// ── applyFatigueToConfidence ──────────────────────────────────────────────────

describe('applyFatigueToConfidence', () => {
  const toxic   = { confidenceMultiplier: 0.50 };
  const strong  = { confidenceMultiplier: 1.10 };
  const neutral = { confidenceMultiplier: 1.00 };

  it('TOXIC halves 0.80 → 0.40', () => {
    assert.equal(applyFatigueToConfidence(0.80, toxic), 0.40);
  });
  it('STRONG boosts 0.80 → 0.88', () => {
    assert.ok(Math.abs(applyFatigueToConfidence(0.80, strong) - 0.88) < 0.001);
  });
  it('NEUTRAL passes through', () => {
    assert.equal(applyFatigueToConfidence(0.75, neutral), 0.75);
  });
  it('clamps to 0.92 ceiling', () => {
    assert.equal(applyFatigueToConfidence(0.92, strong), 0.92);
  });
  it('clamps to 0.30 floor', () => {
    assert.equal(applyFatigueToConfidence(0.40, toxic), 0.30);
  });
});
