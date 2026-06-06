// confidenceEngine.mjs — Genesis Alpha Confidence Engine.
//
// Composite confidence scorer (0-100) across 5 weighted dimensions:
//   1. Signal Quality      (0-25) — evidence richness, price edge, volume depth
//   2. Agent Consensus     (0-25) — arbiter conviction, bear dissent penalty
//   3. Market Conditions   (0-20) — liquidity, horizon quality, price location
//   4. Historical Perf.    (0-20) — agent calibration, win rate
//   5. Risk Profile        (0-10) — drawdown, open exposure, safe mode
//
// Decision bands:
//   BLOCK (0-24)           → no trade, hard block
//   LOW_CONFIDENCE (25-49) → no trade, insufficient edge
//   CAUTION (50-69)        → trade at 0.5x Kelly
//   GOOD_SETUP (70-84)     → trade at 1.0x Kelly
//   HIGH_CONVICTION (85+)  → trade at 1.2x Kelly

import db from '../db/database.mjs';
import { getActiveWeights } from '../learning/learningEngine.mjs';

// ── Constants ─────────────────────────────────────────────────────────────────

export const NO_TRADE_REASONS = {
  COMPOSITE_SCORE_TOO_LOW:    'COMPOSITE_SCORE_TOO_LOW',
  SAFE_MODE_ACTIVE:           'SAFE_MODE_ACTIVE',
  AGENT_DISAGREEMENT:         'AGENT_DISAGREEMENT',
  POOR_MARKET_CONDITIONS:     'POOR_MARKET_CONDITIONS',
  HIGH_DRAWDOWN_PENALTY:      'HIGH_DRAWDOWN_PENALTY',
  LOW_HISTORICAL_PERFORMANCE: 'LOW_HISTORICAL_PERFORMANCE',
};

export const CONFIDENCE_BANDS = {
  BLOCK:           { min: 0,  max: 24,  kellyMultiplier: 0.0, shouldTrade: false },
  LOW_CONFIDENCE:  { min: 25, max: 49,  kellyMultiplier: 0.0, shouldTrade: false },
  CAUTION:         { min: 50, max: 69,  kellyMultiplier: 0.5, shouldTrade: true  },
  GOOD_SETUP:      { min: 70, max: 84,  kellyMultiplier: 1.0, shouldTrade: true  },
  HIGH_CONVICTION: { min: 85, max: 100, kellyMultiplier: 1.2, shouldTrade: true  },
};

// ── Rolling diagnostics state ─────────────────────────────────────────────────

const _stats = {
  recentScores: [],   // last 50 scores (ring buffer)
  bandCounts:   { BLOCK: 0, LOW_CONFIDENCE: 0, CAUTION: 0, GOOD_SETUP: 0, HIGH_CONVICTION: 0 },
  blockedCount: 0,
  noTradeReasonCounts: {},
  lastDecisionAt: null,
  lastScore: null,
  lastBand: null,
};

export function _resetConfidenceStatsForTest() {
  _stats.recentScores = [];
  _stats.bandCounts = { BLOCK: 0, LOW_CONFIDENCE: 0, CAUTION: 0, GOOD_SETUP: 0, HIGH_CONVICTION: 0 };
  _stats.blockedCount = 0;
  _stats.noTradeReasonCounts = {};
  _stats.lastDecisionAt = null;
  _stats.lastScore = null;
  _stats.lastBand = null;
}

// ── Dimension 1: Signal Quality (0-25) ───────────────────────────────────────

function scoreSignalQuality(market, debateResult) {
  let pts = 0;
  const positives = [], negatives = [];

  // Evidence richness (proxy for research signals)
  const evidenceCount = (debateResult.bull?.evidence?.length ?? 0) +
                        (debateResult.bear?.evidence?.length ?? 0);
  if (evidenceCount >= 6) {
    pts += 12;
    positives.push(`${evidenceCount} evidence items — well-researched`);
  } else if (evidenceCount >= 4) {
    pts += 8;
    positives.push(`${evidenceCount} evidence items collected`);
  } else if (evidenceCount >= 2) {
    pts += 5;
  } else {
    pts += 2;
    negatives.push('Thin evidence — only debate reasoning available');
  }

  // Price edge (how far from 50/50 — actual edge exists)
  const intendedPrice = debateResult.outcome === 'YES' ? market.yesPrice : market.noPrice;
  const priceEdge = Math.abs(intendedPrice - 0.50);
  if (priceEdge >= 0.20) {
    pts += 8;
    positives.push(`Strong price edge: ${(priceEdge * 100).toFixed(0)}pp from 50/50`);
  } else if (priceEdge >= 0.10) {
    pts += 5;
  } else {
    pts += 2;
    negatives.push(`Weak price edge: ${(priceEdge * 100).toFixed(1)}pp from 50/50`);
  }

  // Volume signal (more $ = more informed market)
  if (market.volumeTotal >= 100_000) {
    pts += 5;
    positives.push('High volume — liquid, informed market');
  } else if (market.volumeTotal >= 20_000) {
    pts += 3;
  } else {
    negatives.push(`Low volume: $${(market.volumeTotal / 1000).toFixed(0)}k`);
  }

  return { score: Math.min(pts, 25), positives, negatives };
}

// ── Dimension 2: Agent Consensus (0-25) ──────────────────────────────────────

function scoreAgentConsensus(debateResult) {
  let pts = 0;
  const positives = [], negatives = [];

  const arbiterConf = debateResult.confidence ?? 0.65;
  const bearConf    = debateResult.bear?.confidence ?? 0.50;

  // Arbiter conviction base
  if (arbiterConf >= 0.82) {
    pts += 22;
    positives.push(`High arbiter conviction: ${(arbiterConf * 100).toFixed(0)}%`);
  } else if (arbiterConf >= 0.75) {
    pts += 17;
    positives.push(`Good arbiter conviction: ${(arbiterConf * 100).toFixed(0)}%`);
  } else if (arbiterConf >= 0.70) {
    pts += 13;
  } else {
    pts += 8;
    negatives.push(`Marginal arbiter conviction: ${(arbiterConf * 100).toFixed(0)}%`);
  }

  // Bear dissent penalty
  if (bearConf > 0.56) {
    pts -= 8;
    negatives.push(`Bear strongly dissenting: ${(bearConf * 100).toFixed(0)}% confidence`);
  } else if (bearConf > 0.48) {
    pts -= 4;
    negatives.push(`Bear moderately dissenting: ${(bearConf * 100).toFixed(0)}%`);
  } else {
    pts += 3;
    positives.push('Bear concedes — strong bull consensus');
  }

  return { score: Math.max(0, Math.min(pts, 25)), positives, negatives };
}

// ── Dimension 3: Market Conditions (0-20) ────────────────────────────────────

function scoreMarketConditions(market) {
  let pts = 0;
  const positives = [], negatives = [];

  // Volume depth
  if (market.volumeTotal >= 50_000) {
    pts += 7;
    positives.push(`Deep market: $${(market.volumeTotal / 1000).toFixed(0)}k volume`);
  } else if (market.volumeTotal >= 20_000) {
    pts += 5;
  } else if (market.volumeTotal >= 10_000) {
    pts += 3;
  } else {
    pts += 1;
    negatives.push(`Thin market: $${(market.volumeTotal / 1000).toFixed(0)}k volume`);
  }

  // Time horizon (sweet spot: 3-21 days)
  const d = market.daysToClose;
  if (d >= 3 && d <= 14) {
    pts += 8;
    positives.push(`Optimal horizon: ${d} days to close`);
  } else if (d >= 15 && d <= 28) {
    pts += 6;
  } else if (d >= 29 && d <= 45) {
    pts += 4;
  } else if (d <= 2) {
    pts += 2;
    negatives.push(`Very short horizon: ${d} days`);
  } else {
    pts += 1;
  }

  // Price location (not near certainty — room to be right)
  const bestPrice = Math.max(market.yesPrice, market.noPrice);
  const distFromCeiling = 1 - bestPrice;
  if (distFromCeiling >= 0.20) {
    pts += 5;
    positives.push('Price has meaningful upside potential');
  } else if (distFromCeiling >= 0.10) {
    pts += 3;
  } else {
    pts += 1;
    negatives.push('Price near ceiling — limited upside');
  }

  return { score: Math.min(pts, 20), positives, negatives };
}

// ── Dimension 4: Historical Performance (0-20) ───────────────────────────────

function scoreHistoricalPerformance(agentId = 'market-agent-1') {
  const positives = [], negatives = [];

  try {
    const profile = db.prepare(`
      SELECT calibration_score, total_trades, wins
      FROM agent_profiles WHERE id = ?
    `).get(agentId);

    if (!profile || (profile.total_trades ?? 0) < 5) {
      negatives.push('Insufficient trade history — using neutral score');
      return { score: 10, positives, negatives };
    }

    let pts = 0;

    // Calibration score (0.0-1.0 → 0-10 pts)
    const cal = profile.calibration_score ?? 0.50;
    pts += Math.round(cal * 10);
    if (cal >= 0.70) positives.push(`Strong calibration: ${(cal * 100).toFixed(0)}%`);
    else if (cal < 0.50) negatives.push(`Poor calibration: ${(cal * 100).toFixed(0)}%`);

    // Win rate (0-10 pts)
    const winRate = profile.total_trades > 0 ? (profile.wins ?? 0) / profile.total_trades : 0.5;
    if (winRate >= 0.60) {
      pts += 10;
      positives.push(`Strong win rate: ${(winRate * 100).toFixed(0)}%`);
    } else if (winRate >= 0.55) {
      pts += 7;
    } else if (winRate >= 0.50) {
      pts += 5;
    } else {
      pts += 2;
      negatives.push(`Below-average win rate: ${(winRate * 100).toFixed(0)}%`);
    }

    return { score: Math.min(pts, 20), positives, negatives };
  } catch {
    negatives.push('Agent profile unavailable — using neutral score');
    return { score: 10, positives, negatives };
  }
}

// ── Dimension 5: Risk Profile (0-10) ─────────────────────────────────────────

function scoreRiskProfile(safeMode = false) {
  const positives = [], negatives = [];

  if (safeMode) {
    return {
      score: 0,
      positives,
      negatives: ['SAFE_MODE active — all new trades blocked'],
      isSafeMode: true,
    };
  }

  let pts = 10;

  try {
    const peakRow  = db.prepare(`SELECT value FROM org_state WHERE key = 'peak_capital'`).get();
    const capRow   = db.prepare(`SELECT total FROM capital_history ORDER BY recorded_at DESC LIMIT 1`).get();

    if (peakRow && capRow) {
      const peak     = parseFloat(peakRow.value);
      const current  = capRow.total;
      const drawdown = (peak - current) / peak;

      if (drawdown > 0.12) {
        pts -= 6;
        negatives.push(`High drawdown: ${(drawdown * 100).toFixed(1)}% from peak`);
      } else if (drawdown > 0.08) {
        pts -= 3;
        negatives.push(`Moderate drawdown: ${(drawdown * 100).toFixed(1)}% from peak`);
      } else if (drawdown > 0.04) {
        pts -= 1;
      } else {
        positives.push('Capital near peak — healthy position');
      }
    }

    // Open trade exposure
    const openCount = db.prepare(`SELECT COUNT(*) AS n FROM trades WHERE status = 'open'`).get()?.n ?? 0;
    if (openCount >= 4) {
      pts -= 3;
      negatives.push(`${openCount} open trades — near max exposure`);
    } else if (openCount >= 3) {
      pts -= 1;
    } else if (openCount === 0) {
      positives.push('No existing exposure');
    }
  } catch {
    // Neutral if DB unavailable
  }

  return { score: Math.max(0, pts), positives, negatives, isSafeMode: false };
}

// ── Band classification ───────────────────────────────────────────────────────

function classifyBand(score) {
  for (const [name, band] of Object.entries(CONFIDENCE_BANDS)) {
    if (score >= band.min && score <= band.max) return { name, ...band };
  }
  return { name: 'BLOCK', ...CONFIDENCE_BANDS.BLOCK };
}

// ── Primary no-trade reason ───────────────────────────────────────────────────

function determineNoTradeReason(factors, band, safeMode) {
  if (safeMode) return NO_TRADE_REASONS.SAFE_MODE_ACTIVE;
  if (band.shouldTrade) return null;

  // Find the worst-scoring dimension
  if (factors.riskProfile.score <= 2)           return NO_TRADE_REASONS.HIGH_DRAWDOWN_PENALTY;
  if (factors.agentConsensus.score <= 5)         return NO_TRADE_REASONS.AGENT_DISAGREEMENT;
  if (factors.marketConditions.score <= 3)       return NO_TRADE_REASONS.POOR_MARKET_CONDITIONS;
  if (factors.historicalPerformance.score <= 5)  return NO_TRADE_REASONS.LOW_HISTORICAL_PERFORMANCE;
  return NO_TRADE_REASONS.COMPOSITE_SCORE_TOO_LOW;
}

// ── Main export: compute composite confidence ─────────────────────────────────

/**
 * @param {object} market          — market data object from scanner
 * @param {object} debateResult    — output from runDebate()
 * @param {string} agentId         — agent profile to look up historical perf
 * @param {boolean} safeMode       — pass isSafeMode() result from caller
 * @returns {{ score, band, shouldTrade, kellyMultiplier, noTradeReason, factors, explanation }}
 */
export function computeConfidence({
  market,
  debateResult,
  agentId = 'market-agent-1',
  safeMode = false,
}) {
  // Safe mode is an unconditional hard block — skip all scoring
  if (safeMode) {
    _stats.recentScores.push(0);
    if (_stats.recentScores.length > 50) _stats.recentScores.shift();
    _stats.bandCounts.BLOCK = (_stats.bandCounts.BLOCK ?? 0) + 1;
    _stats.blockedCount++;
    _stats.noTradeReasonCounts[NO_TRADE_REASONS.SAFE_MODE_ACTIVE] =
      (_stats.noTradeReasonCounts[NO_TRADE_REASONS.SAFE_MODE_ACTIVE] ?? 0) + 1;
    _stats.lastDecisionAt = new Date().toISOString();
    _stats.lastScore      = 0;
    _stats.lastBand       = 'BLOCK';
    return {
      score:           0,
      band:            'BLOCK',
      shouldTrade:     false,
      kellyMultiplier: 0.0,
      noTradeReason:   NO_TRADE_REASONS.SAFE_MODE_ACTIVE,
      factors: { signalQuality: 0, agentConsensus: 0, marketConditions: 0, historicalPerformance: 0, riskProfile: 0 },
      explanation: {
        positives: [],
        negatives: ['SAFE_MODE active — startup reconciliation degraded, all new trades blocked'],
      },
    };
  }

  const signalQuality        = scoreSignalQuality(market, debateResult);
  const agentConsensus       = scoreAgentConsensus(debateResult);
  const marketConditions     = scoreMarketConditions(market);
  const historicalPerformance = scoreHistoricalPerformance(agentId);
  const riskProfile          = scoreRiskProfile(safeMode);

  // Apply dynamic weights from learning engine (all weights=1.0 by default → identical to raw sum)
  const weights = getActiveWeights();
  const BASE_MAXES = { signalQuality: 25, agentConsensus: 25, marketCondition: 20, historicalPerf: 20, riskProfile: 10 };
  const weightedMaxTotal =
    BASE_MAXES.signalQuality   * weights.signalQuality +
    BASE_MAXES.agentConsensus  * weights.agentConsensus +
    BASE_MAXES.marketCondition * weights.marketCondition +
    BASE_MAXES.historicalPerf  * weights.historicalPerf +
    BASE_MAXES.riskProfile     * weights.riskProfile;
  const rawTotal =
    signalQuality.score         * weights.signalQuality +
    agentConsensus.score        * weights.agentConsensus +
    marketConditions.score      * weights.marketCondition +
    historicalPerformance.score * weights.historicalPerf +
    riskProfile.score           * weights.riskProfile;
  const score = Math.round(Math.min(100, (rawTotal / weightedMaxTotal) * 100));

  const band         = classifyBand(score);
  const noTradeReason = determineNoTradeReason(
    { signalQuality, agentConsensus, marketConditions, historicalPerformance, riskProfile },
    band,
    safeMode,
  );

  const positives = [
    ...signalQuality.positives,
    ...agentConsensus.positives,
    ...marketConditions.positives,
    ...historicalPerformance.positives,
    ...riskProfile.positives,
  ];
  const negatives = [
    ...signalQuality.negatives,
    ...agentConsensus.negatives,
    ...marketConditions.negatives,
    ...historicalPerformance.negatives,
    ...riskProfile.negatives,
  ];

  // Track rolling stats
  _stats.recentScores.push(score);
  if (_stats.recentScores.length > 50) _stats.recentScores.shift();
  _stats.bandCounts[band.name] = (_stats.bandCounts[band.name] ?? 0) + 1;
  if (!band.shouldTrade) {
    _stats.blockedCount++;
    if (noTradeReason) {
      _stats.noTradeReasonCounts[noTradeReason] =
        (_stats.noTradeReasonCounts[noTradeReason] ?? 0) + 1;
    }
  }
  _stats.lastDecisionAt = new Date().toISOString();
  _stats.lastScore      = score;
  _stats.lastBand       = band.name;

  return {
    score,
    band:            band.name,
    shouldTrade:     band.shouldTrade,
    kellyMultiplier: band.kellyMultiplier,
    noTradeReason,
    factors: {
      signalQuality:         signalQuality.score,
      agentConsensus:        agentConsensus.score,
      marketConditions:      marketConditions.score,
      historicalPerformance: historicalPerformance.score,
      riskProfile:           riskProfile.score,
    },
    explanation: { positives, negatives },
  };
}

// ── Diagnostics for truthLayer ────────────────────────────────────────────────

export function getConfidenceDiagnostics() {
  const n   = _stats.recentScores.length;
  const avg = n > 0 ? _stats.recentScores.reduce((a, b) => a + b, 0) / n : null;
  return {
    averageScore:        avg != null ? Math.round(avg * 10) / 10 : null,
    lastScore:           _stats.lastScore,
    lastBand:            _stats.lastBand,
    blockedTrades:       _stats.blockedCount,
    noTradeReasonCounts: { ..._stats.noTradeReasonCounts },
    bandDistribution:    { ..._stats.bandCounts },
    lastDecisionAt:      _stats.lastDecisionAt,
    samplesInWindow:     n,
  };
}
