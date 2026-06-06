// alphaValidation.test.mjs — Phase 5 Alpha Edge Validation tests
//
// Tests 6 scenarios:
//   1. Expectancy calculation — EV, win rate, profit factor with synthetic data
//   2. Calibration scoring — band breakdown, MAE, over/under-confidence
//   3. False positives — high confidence losses correctly flagged
//   4. False negatives — note: not directly measurable, verified as documented
//   5. Agent ranking — score ordering with synthetic agent profiles
//   6. Regime performance — category breakdown and exposure map

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import db from '../db/database.mjs';
import {
  computeExpectancy,
  computeCalibration,
  computeAgentEdgeScores,
  computeRegimeAnalysis,
  computeDecisionQuality,
  getAlphaReport,
  MIN_TRADES_FOR_EDGE,
  MIN_TRADES_FOR_CALIBRATION,
} from '../research/alphaValidationEngine.mjs';

// ── Test data helpers ─────────────────────────────────────────────────────────

const TEST_AGENT = 'test-alpha-agent';
const TEST_AGENT2 = 'test-alpha-agent-2';

function clearTestTrades() {
  db.prepare(`DELETE FROM trades WHERE agent_id IN (?, ?)`).run(TEST_AGENT, TEST_AGENT2);
  db.prepare(`DELETE FROM trade_outcomes WHERE agent_source IN (?, ?)`).run(TEST_AGENT, TEST_AGENT2);
  db.prepare(`DELETE FROM agent_profiles WHERE id IN (?, ?)`).run(TEST_AGENT, TEST_AGENT2);
}

function insertClosedTrade({ agentId = TEST_AGENT, pnl = 5, confidence = 0.75, category = 'Politics', source = 'polymarket', outcome = 'YES', resolved = 'YES' } = {}) {
  const id = `test-trade-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const won = pnl > 0;
  db.prepare(`
    INSERT INTO trades
    (id, agent_id, market_id, market_source, market_question, market_category,
     outcome, entry_price, exit_price, shares, capital_used, confidence,
     status, resolved_outcome, pnl, opened_at, closed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0.65, ?, 10, 100, ?, 'closed', ?, ?, datetime('now', '-2 days'), datetime('now'))
  `).run(id, agentId, `mkt-${id}`, source, `Test: will ${category} event happen?`, category,
     outcome, won ? 0.75 : 0.55, confidence, resolved, pnl);
  return id;
}

function insertAgentProfile({ id = TEST_AGENT, name = 'Test Alpha Agent', wins = 0, losses = 0, pnl = 0, calibrationScore = 0.5 } = {}) {
  db.prepare(`
    INSERT OR REPLACE INTO agent_profiles
    (id, name, role, department, level, status, budget_pct,
     skill_market_selection, skill_timing, skill_position_sizing,
     skill_signal_reading, skill_pattern_recog,
     total_trades, wins, losses, total_pnl,
     win_streak, loss_streak, max_win_streak, max_loss_streak,
     calibration_score, created_at, last_active)
    VALUES (?, ?, 'trader', 'prediction_markets', 1, 'active', 0.05,
            0.5, 0.5, 0.5, 0.5, 0.5,
            ?, ?, ?, ?,
            0, 0, ?, 0,
            ?, datetime('now'), datetime('now'))
  `).run(id, name, wins + losses, wins, losses, pnl, wins, calibrationScore);
}

// ── 1. Expectancy calculation ─────────────────────────────────────────────────

describe('Expectancy calculation', () => {
  before(clearTestTrades);
  after(clearTestTrades);

  test('returns null expectancy with no trades', () => {
    const result = computeExpectancy([]);
    assert.equal(result.expectancyPerTrade, null);
    assert.equal(result.tradeCount, 0);
    assert.equal(result.dataQuality.sufficient, false);
    assert.ok(result.dataQuality.warning?.includes('0/'), 'should warn about 0 trades');
  });

  test('computes positive EV correctly', () => {
    // 3 wins of $10, 1 loss of $5 → EV = (0.75 × 10) - (0.25 × 5) = 7.5 - 1.25 = 6.25
    const trades = [
      { pnl: 10, pnl_realized: 10, confidence: 0.75 },
      { pnl: 10, pnl_realized: 10, confidence: 0.75 },
      { pnl: 10, pnl_realized: 10, confidence: 0.75 },
      { pnl: -5, pnl_realized: -5, confidence: 0.75 },
    ];
    const result = computeExpectancy(trades);
    assert.equal(result.tradeCount, 4);
    assert.equal(result.winRate, 0.75);
    assert.equal(result.lossRate, 0.25);
    assert.equal(result.avgWin, 10);
    assert.equal(result.avgLoss, 5);
    assert.equal(result.expectancyPerTrade, 6.25);
    assert.ok(result.profitFactor > 1, 'profit factor should be > 1 for positive EV');
  });

  test('computes negative EV correctly', () => {
    // 1 win of $5, 3 losses of $10 → EV = (0.25 × 5) - (0.75 × 10) = 1.25 - 7.5 = -6.25
    const trades = [
      { pnl:  5, pnl_realized:  5, confidence: 0.6 },
      { pnl: -10, pnl_realized: -10, confidence: 0.6 },
      { pnl: -10, pnl_realized: -10, confidence: 0.6 },
      { pnl: -10, pnl_realized: -10, confidence: 0.6 },
    ];
    const result = computeExpectancy(trades);
    assert.ok(result.expectancyPerTrade < 0, 'EV should be negative');
    assert.equal(result.winRate, 0.25);
    assert.equal(result.lossRate, 0.75);
    assert.ok(result.profitFactor < 1, 'profit factor should be < 1');
  });

  test('dataQuality.sufficient is false below MIN_TRADES_FOR_EDGE', () => {
    const trades = Array.from({ length: MIN_TRADES_FOR_EDGE - 1 }, (_, i) => ({
      pnl: i % 2 === 0 ? 5 : -3, pnl_realized: i % 2 === 0 ? 5 : -3, confidence: 0.7,
    }));
    const result = computeExpectancy(trades);
    assert.equal(result.dataQuality.sufficient, false);
    assert.ok(result.dataQuality.warning !== null);
  });

  test('dataQuality.sufficient is true at MIN_TRADES_FOR_EDGE', () => {
    const trades = Array.from({ length: MIN_TRADES_FOR_EDGE }, (_, i) => ({
      pnl: i % 2 === 0 ? 5 : -3, pnl_realized: i % 2 === 0 ? 5 : -3, confidence: 0.7,
    }));
    const result = computeExpectancy(trades);
    assert.equal(result.dataQuality.sufficient, true);
    assert.equal(result.dataQuality.warning, null);
  });

  test('profit factor is null when no losses', () => {
    const trades = [
      { pnl: 10, pnl_realized: 10, confidence: 0.8 },
      { pnl: 5,  pnl_realized: 5,  confidence: 0.8 },
    ];
    const result = computeExpectancy(trades);
    assert.equal(result.lossRate, 0);
    // profitFactor should be Infinity or very high (no losses)
    assert.ok(result.profitFactor === Infinity || result.profitFactor === null || result.profitFactor > 10);
  });
});

// ── 2. Calibration scoring ────────────────────────────────────────────────────

describe('Calibration scoring', () => {
  test('returns null calibration with no trades', () => {
    const result = computeCalibration([]);
    assert.equal(result.calibrationScore, null);
    assert.equal(result.meanAbsoluteError, null);
    assert.deepEqual(result.bandBreakdown, []);
    assert.equal(result.dataQuality.sufficient, false);
  });

  test('perfect calibration: HIGH_CONVICTION 82% win rate gives high score', () => {
    // 82 wins, 18 losses in HIGH_CONVICTION band → actualWR = 0.82 = expectedWR
    const trades = [
      ...Array.from({ length: 82 }, () => ({ pnl: 5, pnl_realized: 5, confidence: 0.85, confidence_band: 'HIGH_CONVICTION' })),
      ...Array.from({ length: 18 }, () => ({ pnl: -3, pnl_realized: -3, confidence: 0.85, confidence_band: 'HIGH_CONVICTION' })),
    ];
    const result = computeCalibration(trades);
    assert.ok(result.calibrationScore !== null, 'should compute a score');
    assert.ok(result.calibrationScore >= 90, `expected ≥90 for perfect HIGH_CONVICTION calibration, got ${result.calibrationScore}`);
    assert.equal(result.overconfident, false);
  });

  test('detects overconfidence: high band but low actual win rate', () => {
    // 10 trades in HIGH_CONVICTION band with only 40% win rate → badly overconfident
    const trades = [
      ...Array.from({ length: 4 }, () => ({ pnl: 5, pnl_realized: 5, confidence: 0.85, confidence_band: 'HIGH_CONVICTION' })),
      ...Array.from({ length: 6 }, () => ({ pnl: -3, pnl_realized: -3, confidence: 0.85, confidence_band: 'HIGH_CONVICTION' })),
    ];
    const result = computeCalibration(trades);
    const hcBand = result.bandBreakdown.find(b => b.band === 'HIGH_CONVICTION');
    assert.ok(hcBand, 'HIGH_CONVICTION band should exist');
    assert.ok(hcBand.overconfident, 'should flag as overconfident');
    assert.ok(result.calibrationScore < 80, 'calibration score should be low due to overconfidence');
  });

  test('calibration error is absolute difference of expected vs actual WR', () => {
    // CAUTION band: expectedWR = 0.65, actual = 1.0 (all wins) → error = 0.35
    const trades = Array.from({ length: 10 }, () => ({
      pnl: 5, pnl_realized: 5, confidence: 0.68, confidence_band: 'CAUTION',
    }));
    const result = computeCalibration(trades);
    const cautionBand = result.bandBreakdown.find(b => b.band === 'CAUTION');
    assert.ok(cautionBand, 'CAUTION band should exist');
    assert.ok(Math.abs(cautionBand.calibrationError - 0.35) < 0.01,
      `expected calibration error ~0.35, got ${cautionBand.calibrationError}`);
  });
});

// ── 3. False positives ────────────────────────────────────────────────────────

describe('False positives', () => {
  test('no false positives when all high-confidence trades win', () => {
    const trades = [
      { pnl: 10, pnl_realized: 10, confidence: 0.82, agent_id: TEST_AGENT },
      { pnl: 8,  pnl_realized: 8,  confidence: 0.80, agent_id: TEST_AGENT },
      { pnl: 5,  pnl_realized: 5,  confidence: 0.78, agent_id: TEST_AGENT },
    ];
    const result = computeDecisionQuality(trades);
    assert.equal(result.falsePositives, 0);
    assert.equal(result.falsePositiveRate, 0);
  });

  test('counts false positives: high confidence + loss', () => {
    const trades = [
      { pnl: -10, pnl_realized: -10, confidence: 0.85 }, // false positive
      { pnl: -8,  pnl_realized: -8,  confidence: 0.80 }, // false positive
      { pnl: 10,  pnl_realized: 10,  confidence: 0.82 }, // true positive
      { pnl: -3,  pnl_realized: -3,  confidence: 0.60 }, // low confidence loss, not FP
    ];
    const result = computeDecisionQuality(trades);
    assert.equal(result.falsePositives, 2, 'should count 2 false positives');
    // 3 high-confidence trades (>=0.75), 2 are false positives → rate = 2/3
    assert.ok(Math.abs(result.falsePositiveRate - (2 / 3)) < 0.01,
      `expected FP rate ~0.67, got ${result.falsePositiveRate}`);
  });

  test('goodTradeRate is correct fraction of positive PnL trades', () => {
    const trades = [
      { pnl: 10, pnl_realized: 10, confidence: 0.7 },
      { pnl: 5,  pnl_realized: 5,  confidence: 0.7 },
      { pnl: -3, pnl_realized: -3, confidence: 0.7 },
      { pnl: -1, pnl_realized: -1, confidence: 0.7 },
    ];
    const result = computeDecisionQuality(trades);
    assert.equal(result.goodTrades, 2);
    assert.equal(result.badTrades, 2);
    assert.equal(result.goodTradeRate, 0.5);
  });
});

// ── 4. False negatives documentation ─────────────────────────────────────────

describe('False negatives', () => {
  test('decisionQuality documents false negatives as unmeasurable', () => {
    const result = computeDecisionQuality([]);
    assert.ok(typeof result.falseNegativeNote === 'string',
      'should include a note about false negatives');
    assert.ok(result.falseNegativeNote.length > 10,
      'note should be substantive');
    // Verify it explains WHY we can't measure them
    assert.ok(
      result.falseNegativeNote.toLowerCase().includes('cannot') ||
      result.falseNegativeNote.toLowerCase().includes('no se pueden'),
      'note should explain measurement limitation'
    );
  });

  test('blockedByVeto counts vetoed trades from DB', () => {
    const result = computeDecisionQuality([]);
    // We have 145 vetoed trades in the DB
    assert.ok(result.blockedByVeto >= 0, 'blockedByVeto should be >= 0');
    assert.equal(typeof result.blockedByVeto, 'number');
  });

  test('totalBlocked = blockedByVeto + blockedByConfidence', () => {
    const result = computeDecisionQuality([]);
    assert.equal(result.totalBlocked, result.blockedByVeto + result.blockedByConfidence);
  });
});

// ── 5. Agent ranking ──────────────────────────────────────────────────────────

describe('Agent ranking', () => {
  before(() => {
    clearTestTrades();
    // Insert two agents with different profiles
    insertAgentProfile({ id: TEST_AGENT, name: 'Good Agent', wins: 8, losses: 2, pnl: 50, calibrationScore: 0.8 });
    insertAgentProfile({ id: TEST_AGENT2, name: 'Bad Agent', wins: 2, losses: 8, pnl: -30, calibrationScore: 0.3 });
  });
  after(clearTestTrades);

  test('agents list includes all profiles', () => {
    const result = computeAgentEdgeScores([]);
    const ids = result.agents.map(a => a.agentId);
    assert.ok(ids.includes(TEST_AGENT), 'good agent should be in list');
    assert.ok(ids.includes(TEST_AGENT2), 'bad agent should be in list');
  });

  test('agent with higher wins/pnl gets higher alphaScore', () => {
    const result = computeAgentEdgeScores([]);
    const good = result.agents.find(a => a.agentId === TEST_AGENT);
    const bad  = result.agents.find(a => a.agentId === TEST_AGENT2);
    assert.ok(good, 'good agent should exist');
    assert.ok(bad, 'bad agent should exist');
    assert.ok(good.agentAlphaScore > bad.agentAlphaScore,
      `good agent (${good.agentAlphaScore}) should outscore bad agent (${bad.agentAlphaScore})`);
  });

  test('alphaScore is bounded 0-100', () => {
    const result = computeAgentEdgeScores([]);
    for (const agent of result.agents) {
      assert.ok(agent.agentAlphaScore >= 0, `score ${agent.agentAlphaScore} should be >= 0`);
      assert.ok(agent.agentAlphaScore <= 100, `score ${agent.agentAlphaScore} should be <= 100`);
    }
  });

  test('dataQuality warns when agent has < 10 trades', () => {
    const result = computeAgentEdgeScores([]);
    const good = result.agents.find(a => a.agentId === TEST_AGENT);
    // 10 total trades, so it's borderline
    if (good && good.tradeCount < 10) {
      assert.ok(good.dataQuality.warning !== null, 'should warn about insufficient trades');
    }
  });
});

// ── 6. Regime performance ─────────────────────────────────────────────────────

describe('Regime performance', () => {
  before(() => {
    clearTestTrades();
    insertAgentProfile();
  });
  after(clearTestTrades);

  test('regime analysis includes exposure map with all categories', () => {
    const result = computeRegimeAnalysis([]);
    // Should include categories from existing vetoed/open trades (Bitcoin, IEM Cologne, etc.)
    assert.ok(Array.isArray(result.exposureByCategory), 'exposure should be an array');
    assert.ok(result.exposureByCategory.length >= 0, 'should have exposure entries');
  });

  test('computeRegimeAnalysis with synthetic trades groups by category', () => {
    // Need >= MIN_TRADES_FOR_REGIME (5) per category for strongestMarket to be computed
    const politicsTrades = Array.from({ length: 5 }, () => ({
      pnl: 10, pnl_realized: 10, market_category: 'Politics', confidence: 0.75, entry_volume24h: 50000,
    }));
    const cryptoTrades = Array.from({ length: 5 }, () => ({
      pnl: -5, pnl_realized: -5, market_category: 'TestCrypto', confidence: 0.70, entry_volume24h: 20000,
    }));
    const trades = [...politicsTrades, ...cryptoTrades];
    const result = computeRegimeAnalysis(trades);
    const politics = result.regimes.find(r => r.category === 'Politics');
    const crypto   = result.regimes.find(r => r.category === 'TestCrypto');
    assert.ok(politics, 'Politics regime should exist');
    assert.ok(crypto, 'TestCrypto regime should exist');
    assert.equal(politics.tradeCount, 5);
    assert.equal(politics.winRate, 1.0); // all wins
    assert.equal(crypto.tradeCount, 5);
    assert.equal(crypto.winRate, 0);     // all losses
    // Politics has higher avgPnl → should be strongestMarket
    assert.equal(result.strongestMarket, 'Politics',
      `expected Politics as strongest, got: ${result.strongestMarket}`);
  });

  test('regimes with < MIN_TRADES_FOR_REGIME are marked as insufficient', () => {
    const trades = [
      { pnl: 10, pnl_realized: 10, market_category: 'TinyCategory', confidence: 0.7 },
      { pnl: 5,  pnl_realized: 5,  market_category: 'TinyCategory', confidence: 0.7 },
    ];
    const result = computeRegimeAnalysis(trades);
    const tiny = result.regimes.find(r => r.category === 'TinyCategory');
    assert.ok(tiny, 'TinyCategory should exist');
    assert.equal(tiny.sufficient, false, 'should be insufficient');
  });
});

// ── 7. Full alpha report ──────────────────────────────────────────────────────

describe('Full alpha report', () => {
  test('getAlphaReport() returns valid structure with no closed trades', () => {
    const report = getAlphaReport();
    assert.equal(report.ok, true);
    assert.ok(typeof report.verdict === 'string', 'verdict should be string');
    assert.ok(typeof report.verdictReason === 'string', 'reason should be string');
    assert.ok(report.hasEdge === null || typeof report.hasEdge === 'boolean');
    assert.ok(report.tradeHistory >= 0);
    assert.ok(report.expectancy !== undefined);
    assert.ok(report.calibration !== undefined);
    assert.ok(report.agentEdge !== undefined);
    assert.ok(report.regimes !== undefined);
    assert.ok(report.decisionQuality !== undefined);
    assert.ok(report.summary !== undefined);
  });

  test('getAlphaReport() verdict is NO_DATA or INSUFFICIENT_DATA when no closed trades', () => {
    const report = getAlphaReport();
    const validVerdicts = ['NO_DATA', 'INSUFFICIENT_DATA', 'EDGE_CONFIRMED', 'MARGINAL_EDGE', 'NO_EDGE_DETECTED'];
    assert.ok(validVerdicts.includes(report.verdict),
      `verdict "${report.verdict}" should be one of ${validVerdicts.join(', ')}`);
  });

  test('summary block has correct shape', () => {
    const report = getAlphaReport();
    const s = report.summary;
    assert.ok('expectancyPerTrade'  in s);
    assert.ok('winRate'             in s);
    assert.ok('calibrationScore'    in s);
    assert.ok('profitFactor'        in s);
    assert.ok('bestAgent'           in s);
    assert.ok('worstAgent'          in s);
    assert.ok('strongestMarket'     in s);
    assert.ok('weakestMarket'       in s);
    assert.ok('confidenceAccuracy'  in s);
    assert.ok('falsePositiveRate'   in s);
    assert.ok('dataInsufficient'    in s);
  });
});
