// learningLoop.test.mjs — Phase 2 Learning Loop Engine tests
//
// Tests 5 scenarios:
//   1. High confidence profitable trend → weights loosened
//   2. Low confidence outperforming → agentConsensus recalibrated
//   3. Safe mode → no updates, read-only
//   4. Missing data (< 10 outcomes) → graceful skip
//   5. Partial failures → no corruption

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import db from '../db/database.mjs';
import {
  computeMetrics,
  adjustWeights,
  DEFAULT_WEIGHTS,
  getActiveWeights,
  runWeightCalibrationCycle,
  _resetWeightsCacheForTest,
} from '../learning/learningEngine.mjs';
import {
  createOutcomeRecord,
  saveOutcome,
  getRecentOutcomes,
  getOutcomeCount,
} from '../learning/outcomeModel.mjs';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeOutcome(overrides = {}) {
  return {
    id:              overrides.id ?? `outcome-test-${Math.random().toString(36).slice(2)}`,
    tradeId:         overrides.tradeId ?? `trade-${Math.random().toString(36).slice(2)}`,
    agentSource:     overrides.agentSource    ?? 'market-agent-1',
    marketSource:    overrides.marketSource   ?? 'polymarket',
    marketCategory:  overrides.marketCategory ?? 'politics',
    recordedAt:      new Date().toISOString(),
    entryConfidence: overrides.entryConfidence ?? 0.80,
    confidenceBand:  overrides.confidenceBand  ?? 'GOOD_SETUP',
    pnlRealized:     overrides.pnlRealized     ?? 5.00,
    pnlPct:          overrides.pnlPct          ?? 0.05,
    durationHours:   overrides.durationHours   ?? 24,
    outcomeResult:   overrides.outcomeResult   ?? 'WIN',
    marketSnapshot:  '{}',
  };
}

function insertOutcome(outcome) {
  db.prepare(`
    INSERT OR IGNORE INTO trade_outcomes
      (id, trade_id, agent_source, market_source, market_category,
       recorded_at, entry_confidence, confidence_band,
       pnl_realized, pnl_pct, duration_hours, outcome_result, market_snapshot)
    VALUES
      (@id, @tradeId, @agentSource, @marketSource, @marketCategory,
       @recordedAt, @entryConfidence, @confidenceBand,
       @pnlRealized, @pnlPct, @durationHours, @outcomeResult, @marketSnapshot)
  `).run(outcome);
}

function clearTestOutcomes() {
  db.prepare(`DELETE FROM trade_outcomes WHERE id LIKE 'outcome-test-%'`).run();
}

function clearWeights() {
  db.prepare(`DELETE FROM org_state WHERE key = 'confidence_weights'`).run();
}

// Build a fake outcome row (as DB returns it — snake_case)
function fakeRow(conf, result, band) {
  return {
    id:               `row-${Math.random()}`,
    trade_id:         `t-${Math.random()}`,
    agent_source:     'market-agent-1',
    market_source:    'polymarket',
    market_category:  'politics',
    recorded_at:      new Date().toISOString(),
    entry_confidence: conf,
    confidence_band:  band,
    pnl_realized:     result === 'WIN' ? 10 : -5,
    pnl_pct:          result === 'WIN' ? 0.05 : -0.03,
    duration_hours:   12,
    outcome_result:   result,
    market_snapshot:  '{}',
  };
}

// ── Scenario 1: High confidence profitable trend → weights loosened ───────────

describe('Scenario 1: High-band overperformance → global weight loosen', () => {
  before(() => { _resetWeightsCacheForTest(); clearWeights(); });
  after(() => { clearWeights(); _resetWeightsCacheForTest(); });

  test('adjustWeights triggers globalLoosen when highBandWinRate > 0.72', () => {
    // 15 HIGH_CONVICTION wins, 3 losses → winRate = 15/18 = 83%
    const outcomes = [
      ...Array.from({ length: 15 }, () => fakeRow(0.85, 'WIN',  'HIGH_CONVICTION')),
      ...Array.from({ length: 3  }, () => fakeRow(0.85, 'LOSS', 'HIGH_CONVICTION')),
    ];

    const metrics = computeMetrics(outcomes);
    assert.ok(metrics.highBandWinRate > 0.72, `highBandWinRate should be > 0.72, got ${metrics.highBandWinRate}`);

    const { weights, changes } = adjustWeights({ ...DEFAULT_WEIGHTS }, metrics);
    assert.ok('globalLoosen' in changes, 'Should trigger globalLoosen');
    assert.ok(weights.signalQuality > DEFAULT_WEIGHTS.signalQuality, 'Weights should increase');
    assert.ok(Object.values(weights).every(v => v <= 1.4), 'All weights should be ≤ 1.4');
  });

  test('all 5 dimension weights increase proportionally', () => {
    const outcomes = Array.from({ length: 20 }, () => fakeRow(0.85, 'WIN', 'HIGH_CONVICTION'));
    const metrics  = computeMetrics(outcomes);
    const { weights, changes } = adjustWeights({ ...DEFAULT_WEIGHTS }, metrics);

    assert.ok('globalLoosen' in changes, 'Should trigger globalLoosen');
    for (const key of Object.keys(DEFAULT_WEIGHTS)) {
      assert.ok(weights[key] >= DEFAULT_WEIGHTS[key], `${key} should not decrease`);
    }
  });
});

// ── Scenario 2: Low confidence outperforming → agentConsensus recalibration ──

describe('Scenario 2: Low confidence + high win rate → signalQuality up', () => {
  before(() => { _resetWeightsCacheForTest(); clearWeights(); });
  after(() => { clearWeights(); _resetWeightsCacheForTest(); });

  test('adjustWeights triggers signalQualityUp when avgConf < 0.68 but winRate > 0.60', () => {
    // Low average confidence (0.62) but high win rate (70%)
    const outcomes = [
      ...Array.from({ length: 14 }, () => fakeRow(0.62, 'WIN',  'CAUTION')),
      ...Array.from({ length: 6  }, () => fakeRow(0.62, 'LOSS', 'CAUTION')),
    ];

    const metrics = computeMetrics(outcomes);
    assert.ok(metrics.avgConfidence < 0.68, `avgConf should be < 0.68, got ${metrics.avgConfidence}`);
    assert.ok(metrics.overallWinRate > 0.60, `winRate should be > 0.60, got ${metrics.overallWinRate}`);

    const { weights, changes } = adjustWeights({ ...DEFAULT_WEIGHTS }, metrics);
    assert.ok('signalQualityUp' in changes, 'Should trigger signalQualityUp');
    assert.ok(weights.signalQuality > DEFAULT_WEIGHTS.signalQuality, 'signalQuality should increase');
  });

  test('adjusted weight stays within [0.6, 1.4] bounds', () => {
    const outcomes = Array.from({ length: 15 }, () => fakeRow(0.60, 'WIN', 'CAUTION'));
    const metrics  = computeMetrics(outcomes);

    // Start with a near-ceiling weight
    const startWeights = { ...DEFAULT_WEIGHTS, signalQuality: 1.38 };
    const { weights } = adjustWeights(startWeights, metrics);
    assert.ok(weights.signalQuality <= 1.4, 'signalQuality should be clamped to 1.4');
  });
});

// ── Scenario 3: Safe mode → no weight updates ─────────────────────────────────

describe('Scenario 3: Safe mode → read-only, no DB writes', () => {
  before(() => { _resetWeightsCacheForTest(); clearWeights(); });
  after(() => { clearWeights(); _resetWeightsCacheForTest(); });

  test('runWeightCalibrationCycle returns skipped=true in safe mode', async () => {
    const result = await runWeightCalibrationCycle(true);  // safeMode=true
    assert.equal(result.skipped, true, 'Should be skipped in safe mode');
    assert.equal(result.reason, 'SAFE_MODE', 'Reason should be SAFE_MODE');
  });

  test('safe mode does not write to org_state', async () => {
    clearWeights();
    await runWeightCalibrationCycle(true);
    const row = db.prepare(`SELECT value FROM org_state WHERE key = 'confidence_weights'`).get();
    assert.equal(row, undefined, 'Should not write weights to DB in safe mode');
  });

  test('safe mode returns metrics for diagnostics', async () => {
    const result = await runWeightCalibrationCycle(true);
    // metrics should be present (may be empty if no outcomes)
    assert.ok('metrics' in result, 'Should return metrics even in safe mode');
  });
});

// ── Scenario 4: Insufficient data → graceful skip ─────────────────────────────

describe('Scenario 4: < 10 outcomes → no adjustment', () => {
  before(() => { _resetWeightsCacheForTest(); clearWeights(); clearTestOutcomes(); });
  after(() => { clearWeights(); _resetWeightsCacheForTest(); clearTestOutcomes(); });

  test('adjustWeights returns unchanged weights with < 10 outcomes', () => {
    const outcomes = Array.from({ length: 5 }, () => fakeRow(0.80, 'WIN', 'GOOD_SETUP'));
    const metrics  = computeMetrics(outcomes);
    const { weights, changes, reason } = adjustWeights({ ...DEFAULT_WEIGHTS }, metrics);

    assert.deepEqual(weights, DEFAULT_WEIGHTS, 'Weights should not change with < 10 outcomes');
    assert.deepEqual(changes, {}, 'Changes should be empty');
    assert.equal(reason, 'INSUFFICIENT_DATA');
  });

  test('runWeightCalibrationCycle skips and returns INSUFFICIENT_DATA when < 10 outcomes in DB', async () => {
    // Insert only 5 test outcomes
    for (let i = 0; i < 5; i++) {
      insertOutcome(makeOutcome({ id: `outcome-test-s4-${i}`, tradeId: `trade-s4-${i}` }));
    }

    const result = await runWeightCalibrationCycle(false);
    assert.equal(result.skipped, true, 'Should skip with < 10 outcomes');
    assert.equal(result.reason, 'INSUFFICIENT_DATA', 'Reason should be INSUFFICIENT_DATA');
  });

  test('computeMetrics handles empty array without throwing', () => {
    const metrics = computeMetrics([]);
    assert.equal(metrics.totalOutcomes, 0);
    assert.equal(metrics.overallWinRate, null);
    assert.equal(metrics.highBandWinRate, null);
  });
});

// ── Scenario 5: No corruption on partial failures ─────────────────────────────

describe('Scenario 5: Partial failure resilience', () => {
  before(() => { _resetWeightsCacheForTest(); clearWeights(); });
  after(() => { clearWeights(); _resetWeightsCacheForTest(); clearTestOutcomes(); });

  test('getActiveWeights returns DEFAULT_WEIGHTS when no DB entry exists', () => {
    _resetWeightsCacheForTest();
    clearWeights();
    const weights = getActiveWeights();
    assert.deepEqual(weights, DEFAULT_WEIGHTS, 'Should return defaults when no DB entry');
  });

  test('createOutcomeRecord handles missing optional fields gracefully', () => {
    const minimal = {
      id: 'trade-minimal-123',
      pnl: 5,
      // No opened_at, closed_at, capital_used, market_source, etc.
    };
    const record = createOutcomeRecord(minimal);
    assert.equal(record.id, 'outcome-trade-minimal-123');
    assert.equal(record.outcomeResult, 'WIN');
    assert.ok(record.durationHours >= 0, 'durationHours should be non-negative');
    assert.equal(record.agentSource, 'market-agent-1');
    assert.equal(record.marketSource, 'unknown');
  });

  test('saveOutcome is idempotent (INSERT OR IGNORE on duplicate id)', () => {
    const outcome = makeOutcome({ id: 'outcome-test-idem', tradeId: 'trade-idem' });
    saveOutcome(outcome);
    saveOutcome(outcome);  // second call should be ignored
    const rows = db.prepare(`SELECT COUNT(*) AS n FROM trade_outcomes WHERE id = 'outcome-test-idem'`).get();
    assert.equal(rows.n, 1, 'Should have exactly 1 row after two inserts');
    // Cleanup
    db.prepare(`DELETE FROM trade_outcomes WHERE id = 'outcome-test-idem'`).run();
  });

  test('computeMetrics does not throw on outcomes with null pnl', () => {
    const outcomes = [
      { ...fakeRow(0.80, 'WIN', 'GOOD_SETUP'), pnl_realized: null },
      { ...fakeRow(0.80, 'LOSS', 'GOOD_SETUP'), pnl_realized: null },
    ];
    // Should not throw
    assert.doesNotThrow(() => computeMetrics(outcomes));
  });

  test('adjustWeights clamps near-boundary weights correctly', () => {
    // Set all weights to max boundary (1.40) — globalLoosen should not exceed 1.4
    const startWeights = {
      signalQuality:   1.40,
      agentConsensus:  1.40,
      marketCondition: 1.40,
      historicalPerf:  1.40,
      riskProfile:     1.40,
    };

    // Force a globalLoosen scenario
    const outcomes = Array.from({ length: 20 }, () => fakeRow(0.85, 'WIN', 'HIGH_CONVICTION'));
    const metrics  = computeMetrics(outcomes);
    const { weights } = adjustWeights(startWeights, metrics);

    for (const [key, val] of Object.entries(weights)) {
      assert.ok(val <= 1.4, `${key} should not exceed 1.4, got ${val}`);
    }
  });
});
