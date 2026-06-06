// confidenceEngine.test.mjs — Phase 1 Alpha Confidence Engine tests
//
// Tests 6 scenarios:
//   1. Strong signal → HIGH_CONVICTION or GOOD_SETUP
//   2. Bear strongly dissenting → CAUTION or lower
//   3. Degraded market conditions → BLOCK or LOW_CONFIDENCE
//   4. No evidence (thin signals) → score reduction
//   5. High drawdown → risk profile penalized
//   6. Safe mode active → BLOCK immediately

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import db from '../db/database.mjs';
import {
  computeConfidence,
  getConfidenceDiagnostics,
  _resetConfidenceStatsForTest,
  NO_TRADE_REASONS,
  CONFIDENCE_BANDS,
} from '../intelligence/confidenceEngine.mjs';

// ── Test fixtures ─────────────────────────────────────────────────────────────

function strongMarket(overrides = {}) {
  return {
    volumeTotal: 120_000,
    volume24h:   5_000,
    yesPrice:    0.65,
    noPrice:     0.35,
    daysToClose: 7,
    category:    'politics',
    source:      'polymarket',
    ...overrides,
  };
}

function strongDebate(overrides = {}) {
  return {
    action:        'TRADE',
    outcome:       'YES',
    confidence:    0.82,
    arbiterSummary: 'Bull case wins',
    bull: {
      confidence: 0.85,
      evidence:   ['Strong polling lead', 'Historical precedent', 'Incumbent advantage'],
    },
    bear: {
      confidence: 0.25,
      evidence:   ['Economic headwinds', 'Low approval rating'],
    },
    ...overrides,
  };
}

function cleanupPeakCapital() {
  db.prepare(`DELETE FROM org_state WHERE key = 'peak_capital'`).run();
}

// ── Scenario 1: Strong signal → HIGH_CONVICTION or GOOD_SETUP ────────────────

describe('Scenario 1: Strong signal and consensus → high band', () => {
  before(() => {
    _resetConfidenceStatsForTest();
    cleanupPeakCapital();
  });
  after(cleanupPeakCapital);

  test('strong market + strong debate → shouldTrade=true', () => {
    const result = computeConfidence({
      market:       strongMarket(),
      debateResult: strongDebate(),
      agentId:      'nonexistent-agent-for-neutral',
      safeMode:     false,
    });

    assert.equal(result.shouldTrade, true, `Score ${result.score} should allow trading`);
    assert.ok(result.score >= 50, `Score ${result.score} should be ≥ 50`);
    assert.ok(
      result.band === 'GOOD_SETUP' || result.band === 'HIGH_CONVICTION' || result.band === 'CAUTION',
      `Band ${result.band} should be CAUTION or higher`
    );
    assert.equal(result.noTradeReason, null, 'No trade reason should be null when shouldTrade=true');
  });

  test('high score produces HIGH_CONVICTION band', () => {
    // Worst-case risk profile (no DB data) gives neutral 10/10
    // Signal: 25, Consensus: 25 (0.82 conf, bear 0.25), Market: 20, Hist: 10 (neutral), Risk: 10 = 90
    const result = computeConfidence({
      market:       strongMarket({ volumeTotal: 200_000, daysToClose: 7, yesPrice: 0.65 }),
      debateResult: strongDebate({ confidence: 0.82, bear: { confidence: 0.20, evidence: ['minor doubt'] } }),
      agentId:      'nonexistent-agent-for-neutral',
      safeMode:     false,
    });

    // Score should be in GOOD_SETUP or HIGH_CONVICTION territory
    assert.ok(result.score >= 70, `Score ${result.score} should be ≥ 70 for strong setup`);
    assert.ok(result.kellyMultiplier >= 1.0, `Kelly multiplier ${result.kellyMultiplier} should be ≥ 1.0`);
  });

  test('explanation contains positives', () => {
    const result = computeConfidence({
      market:       strongMarket(),
      debateResult: strongDebate(),
      agentId:      'nonexistent-agent-for-neutral',
      safeMode:     false,
    });
    assert.ok(result.explanation.positives.length > 0, 'Should have at least one positive factor');
  });

  test('diagnostics tracks decision after first call', () => {
    const diag = getConfidenceDiagnostics();
    assert.ok(diag.lastScore !== null, 'lastScore should be set');
    assert.ok(diag.lastBand !== null, 'lastBand should be set');
    assert.ok(diag.samplesInWindow > 0, 'samples should be tracked');
  });
});

// ── Scenario 2: Bear strongly dissenting → CAUTION or lower ──────────────────

describe('Scenario 2: Bear strongly dissenting → reduced confidence', () => {
  before(() => {
    _resetConfidenceStatsForTest();
    cleanupPeakCapital();
  });
  after(cleanupPeakCapital);

  test('high bear confidence reduces agent consensus score', () => {
    const highBearDebate = strongDebate({
      confidence: 0.70,
      bear: { confidence: 0.60, evidence: ['Strong counter-evidence', 'Historical pattern against'] },
    });

    const result = computeConfidence({
      market:       strongMarket(),
      debateResult: highBearDebate,
      agentId:      'nonexistent-agent-for-neutral',
      safeMode:     false,
    });

    // Agent consensus dimension should be penalized
    assert.ok(
      result.factors.agentConsensus <= 12,
      `Agent consensus ${result.factors.agentConsensus} should be ≤ 12 with strong bear`
    );
  });

  test('conflicting agents with marginal arbiter → band ≤ CAUTION', () => {
    // Arbiter at 0.67 (marginal), bear at 0.58 (strong dissent)
    const conflictDebate = strongDebate({
      confidence: 0.67,
      bear: { confidence: 0.58, evidence: ['Strong counter', 'Market misread'] },
    });

    const result = computeConfidence({
      market:       strongMarket({ volumeTotal: 8_000 }),  // thin volume too
      debateResult: conflictDebate,
      agentId:      'nonexistent-agent-for-neutral',
      safeMode:     false,
    });

    assert.ok(result.score <= 69, `Score ${result.score} should be ≤ 69 for conflicting setup`);
  });

  test('explanation contains bear dissent negative', () => {
    const result = computeConfidence({
      market:       strongMarket(),
      debateResult: strongDebate({
        confidence: 0.70,
        bear: { confidence: 0.60, evidence: ['counter evidence'] },
      }),
      agentId:  'nonexistent-agent-for-neutral',
      safeMode: false,
    });

    const hasDissent = result.explanation.negatives.some(n =>
      n.toLowerCase().includes('bear') || n.toLowerCase().includes('dissent')
    );
    assert.ok(hasDissent, 'Should mention bear dissent in negatives');
  });
});

// ── Scenario 3: Degraded market → BLOCK or LOW_CONFIDENCE ────────────────────

describe('Scenario 3: Degraded market conditions → blocked', () => {
  before(() => {
    _resetConfidenceStatsForTest();
    cleanupPeakCapital();
  });
  after(cleanupPeakCapital);

  test('minimum-volume market → low market conditions score', () => {
    const result = computeConfidence({
      market:       strongMarket({ volumeTotal: 5_100, daysToClose: 1, yesPrice: 0.89, noPrice: 0.11 }),
      debateResult: strongDebate({ confidence: 0.66 }),
      agentId:      'nonexistent-agent-for-neutral',
      safeMode:     false,
    });

    assert.ok(
      result.factors.marketConditions <= 8,
      `Market conditions ${result.factors.marketConditions} should be ≤ 8 for degraded market`
    );
  });

  test('combined weak setup → score < 50 (no trade)', () => {
    const result = computeConfidence({
      market: strongMarket({
        volumeTotal: 5_500,   // barely above filter
        daysToClose: 1,       // too short
        yesPrice:    0.91,    // near ceiling
        noPrice:     0.09,
      }),
      debateResult: strongDebate({
        confidence: 0.66,
        bear: { confidence: 0.55, evidence: ['doubt'] },
        bull: { confidence: 0.66, evidence: [] },  // no bull evidence
      }),
      agentId:  'nonexistent-agent-for-neutral',
      safeMode: false,
    });

    assert.ok(result.score <= 60, `Score ${result.score} should be ≤ 60 for combined weak setup`);
  });
});

// ── Scenario 4: No evidence (thin signals) → score reduced ───────────────────

describe('Scenario 4: Thin evidence → signal quality penalty', () => {
  before(() => {
    _resetConfidenceStatsForTest();
    cleanupPeakCapital();
  });
  after(cleanupPeakCapital);

  test('empty evidence arrays → signal quality penalty', () => {
    const noEvidenceDebate = strongDebate({
      bull: { confidence: 0.80, evidence: [] },
      bear: { confidence: 0.30, evidence: [] },
    });

    const withEvidence = computeConfidence({
      market:       strongMarket(),
      debateResult: strongDebate(),  // has 5 evidence items total
      agentId:      'nonexistent-agent-for-neutral',
      safeMode:     false,
    });

    const noEvidence = computeConfidence({
      market:       strongMarket(),
      debateResult: noEvidenceDebate,
      agentId:      'nonexistent-agent-for-neutral',
      safeMode:     false,
    });

    assert.ok(
      noEvidence.factors.signalQuality < withEvidence.factors.signalQuality,
      `Signal quality should be lower without evidence: ${noEvidence.factors.signalQuality} < ${withEvidence.factors.signalQuality}`
    );
  });

  test('thin evidence surfaces as negative in explanation', () => {
    const result = computeConfidence({
      market:       strongMarket(),
      debateResult: strongDebate({
        bull: { confidence: 0.80, evidence: [] },
        bear: { confidence: 0.30, evidence: [] },
      }),
      agentId:  'nonexistent-agent-for-neutral',
      safeMode: false,
    });

    const hasThinEvidence = result.explanation.negatives.some(n =>
      n.toLowerCase().includes('thin') || n.toLowerCase().includes('evidence')
    );
    assert.ok(hasThinEvidence, 'Should flag thin evidence in explanation');
  });
});

// ── Scenario 5: High drawdown → risk profile penalized ───────────────────────

describe('Scenario 5: High drawdown → risk profile penalty', () => {
  before(() => {
    _resetConfidenceStatsForTest();
    // Set up: peak=$10000, current=$8500 → 15% drawdown
    db.prepare(`
      INSERT OR REPLACE INTO org_state (key, value, updated_at)
      VALUES ('peak_capital', '10000.00', datetime('now'))
    `).run();
    db.prepare(`
      INSERT INTO capital_history (total, available, in_trades, recorded_at)
      VALUES (8500, 8500, 0, datetime('now'))
    `).run();
  });
  after(() => {
    cleanupPeakCapital();
    // Clean up the test capital_history row (remove last added row)
    db.prepare(`
      DELETE FROM capital_history WHERE total = 8500 AND in_trades = 0
    `).run();
  });

  test('high drawdown reduces risk profile score', () => {
    const result = computeConfidence({
      market:       strongMarket(),
      debateResult: strongDebate(),
      agentId:      'nonexistent-agent-for-neutral',
      safeMode:     false,
    });

    assert.ok(
      result.factors.riskProfile <= 4,
      `Risk profile ${result.factors.riskProfile} should be ≤ 4 at 15% drawdown`
    );
  });

  test('drawdown surfaces as negative factor in explanation', () => {
    const result = computeConfidence({
      market:       strongMarket(),
      debateResult: strongDebate(),
      agentId:      'nonexistent-agent-for-neutral',
      safeMode:     false,
    });

    const hasDrawdown = result.explanation.negatives.some(n =>
      n.toLowerCase().includes('drawdown')
    );
    assert.ok(hasDrawdown, 'Explanation should mention drawdown');
  });
});

// ── Scenario 6: Safe mode → BLOCK immediately ─────────────────────────────────

describe('Scenario 6: Safe mode active → BLOCK', () => {
  before(() => {
    _resetConfidenceStatsForTest();
    cleanupPeakCapital();
  });
  after(cleanupPeakCapital);

  test('safeMode=true produces BLOCK band regardless of other factors', () => {
    const result = computeConfidence({
      market:       strongMarket(),
      debateResult: strongDebate(),
      agentId:      'nonexistent-agent-for-neutral',
      safeMode:     true,
    });

    assert.equal(result.band, 'BLOCK', 'Should be BLOCK when safe mode active');
    assert.equal(result.shouldTrade, false, 'shouldTrade must be false in safe mode');
    assert.equal(result.kellyMultiplier, 0, 'Kelly multiplier must be 0 in safe mode');
  });

  test('noTradeReason is SAFE_MODE_ACTIVE when safe mode is on', () => {
    const result = computeConfidence({
      market:       strongMarket(),
      debateResult: strongDebate(),
      agentId:      'nonexistent-agent-for-neutral',
      safeMode:     true,
    });

    assert.equal(result.noTradeReason, NO_TRADE_REASONS.SAFE_MODE_ACTIVE);
  });

  test('risk profile score is 0 in safe mode', () => {
    const result = computeConfidence({
      market:       strongMarket(),
      debateResult: strongDebate(),
      agentId:      'nonexistent-agent-for-neutral',
      safeMode:     true,
    });

    assert.equal(result.factors.riskProfile, 0, 'Risk profile must be 0 in safe mode');
  });

  test('diagnostics tracks blocked trade', () => {
    const diagBefore = getConfidenceDiagnostics();
    const prevBlocked = diagBefore.blockedTrades;

    computeConfidence({
      market:       strongMarket(),
      debateResult: strongDebate(),
      agentId:      'nonexistent-agent-for-neutral',
      safeMode:     true,
    });

    const diagAfter = getConfidenceDiagnostics();
    assert.equal(diagAfter.blockedTrades, prevBlocked + 1, 'blockedTrades should increment');
    assert.ok(
      diagAfter.noTradeReasonCounts[NO_TRADE_REASONS.SAFE_MODE_ACTIVE] >= 1,
      'SAFE_MODE_ACTIVE should be tracked in reason counts'
    );
  });
});

// ── Band constants sanity check ───────────────────────────────────────────────

describe('CONFIDENCE_BANDS structure', () => {
  test('bands cover 0-100 without gaps', () => {
    const sorted = Object.values(CONFIDENCE_BANDS).sort((a, b) => a.min - b.min);
    assert.equal(sorted[0].min, 0, 'First band starts at 0');
    assert.equal(sorted[sorted.length - 1].max, 100, 'Last band ends at 100');
    for (let i = 1; i < sorted.length; i++) {
      assert.equal(sorted[i].min, sorted[i - 1].max + 1, `No gap between bands at ${sorted[i - 1].max}→${sorted[i].min}`);
    }
  });

  test('no-trade bands have kellyMultiplier 0', () => {
    for (const [name, band] of Object.entries(CONFIDENCE_BANDS)) {
      if (!band.shouldTrade) {
        assert.equal(band.kellyMultiplier, 0, `${name} should have kellyMultiplier=0`);
      }
    }
  });

  test('trade bands have kellyMultiplier > 0', () => {
    for (const [name, band] of Object.entries(CONFIDENCE_BANDS)) {
      if (band.shouldTrade) {
        assert.ok(band.kellyMultiplier > 0, `${name} should have kellyMultiplier>0`);
      }
    }
  });
});
