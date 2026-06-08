import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const {
  computeSetupStats, isVetoSetup, capFromWinRate, setupKey,
  getAutopsy, isSetupVetoed, confidenceCap,
  isHourBlocked, isConfidenceBandBlocked, isPairBlocked,
  buildEdgePauseDecision,
} = await import('../crypto/autoVeto.mjs');

function rows(side, regime, results /* array of pnl */) {
  return results.map(pnl => ({ side, regime, pnl, confidence: 0.7 }));
}

describe('computeSetupStats', () => {
  it('computes WR / expectancy / profit factor per setup', () => {
    const r = rows('SHORT', 'STRONG_BULL', [-1, -1, -1, 0.5]); // 1 win of 4
    const [s] = computeSetupStats(r);
    assert.equal(s.key, 'SHORT_STRONG_BULL');
    assert.equal(s.samples, 4);
    assert.equal(s.winRate, 0.25);
    assert.ok(s.expectancy < 0);
    assert.ok(s.profitFactor < 1);
  });
});

describe('isVetoSetup', () => {
  it('vetoes a setup with ≥20 samples, negative EV, PF < 0.9', () => {
    const losing = computeSetupStats(rows('SHORT', 'STRONG_BULL', [...Array(18).fill(-1), ...Array(6).fill(0.5)]))[0];
    assert.ok(losing.samples >= 20);
    assert.equal(isVetoSetup(losing), true);
  });
  it('does NOT veto a profitable setup', () => {
    const winning = computeSetupStats(rows('LONG', 'BULL', [...Array(15).fill(1.5), ...Array(8).fill(-0.5)]))[0];
    assert.equal(isVetoSetup(winning), false);
  });
  it('does NOT veto with too few samples even if losing', () => {
    const small = computeSetupStats(rows('SHORT', 'BULL', [-1, -1, -1]))[0];
    assert.equal(isVetoSetup(small), false);
  });
});

describe('capFromWinRate (confidence honesty)', () => {
  it('caps a 38% WR setup around 0.56', () => {
    assert.ok(Math.abs(capFromWinRate(0.38) - 0.56) < 1e-9);
  });
  it('caps a 52% WR setup at 0.70', () => {
    assert.ok(Math.abs(capFromWinRate(0.52) - 0.70) < 1e-9);
  });
  it('never below 0.50 or above 0.92', () => {
    assert.equal(capFromWinRate(0.0), 0.50);
    assert.equal(capFromWinRate(1.0), 0.92);
  });
  it('returns 1 (no cap) when WR unknown', () => {
    assert.equal(capFromWinRate(null), 1);
  });
});

describe('DB-backed accessors are safe on the live DB', () => {
  it('getAutopsy returns a well-formed object', () => {
    const a = getAutopsy();
    assert.ok(a.config && Array.isArray(a.setups) && Array.isArray(a.vetoes));
    // minSamples is env-tunable (VETO_MIN_SAMPLES) — assert it's a sane positive number,
    // not a hardcoded value, so tuning the default doesn't break this test.
    assert.ok(typeof a.config.minSamples === 'number' && a.config.minSamples > 0);
  });
  it('isSetupVetoed / confidenceCap never throw', () => {
    assert.equal(typeof isSetupVetoed('LONG', 'BULL'), 'boolean');
    assert.ok(confidenceCap('LONG', 'BULL') <= 1);
  });
  it('manual context blockers are safe and deterministic', () => {
    assert.equal(isHourBlocked('2026-06-08T16:30:00Z'), true);
    assert.equal(isHourBlocked('2026-06-08T12:30:00Z'), false);
    assert.equal(isConfidenceBandBlocked(0.85), true);
    assert.equal(isPairBlocked('BTCUSDT'), false);
  });
  it('setupKey composes side_regime', () => {
    assert.equal(setupKey('SHORT', 'STRONG_BULL'), 'SHORT_STRONG_BULL');
  });
});

describe('buildEdgePauseDecision', () => {
  it('pauses scalp entries after enough negative closed trades and additive filters', () => {
    const decision = buildEdgePauseDecision(
      { trades: 103, winRate: 0.184, expectancy: -0.67, profitFactor: 0.10, totalPnl: -68.58 },
      { manualFiltersActive: 3 },
    );

    assert.equal(decision.pause, true);
    assert.equal(decision.action, 'pause_or_redesign_strategy');
    assert.equal(decision.thresholdTrades, 40);
    assert.equal(decision.thresholdManualFilters, 3);
  });

  it('does not pause before the hard trade threshold is reached', () => {
    const decision = buildEdgePauseDecision(
      { trades: 12, winRate: 0.2, expectancy: -0.7, profitFactor: 0.2, totalPnl: -8.4 },
      { manualFiltersActive: 3 },
    );

    assert.equal(decision.pause, false);
  });

  it('does not pause when the edge is positive', () => {
    const decision = buildEdgePauseDecision(
      { trades: 80, winRate: 0.48, expectancy: 0.12, profitFactor: 1.2, totalPnl: 9.6 },
      { manualFiltersActive: 3 },
    );

    assert.equal(decision.pause, false);
  });
});
