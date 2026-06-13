// alphaValidationEngine.mjs — Phase 5 Alpha Edge Validation System.
//
// MISSION: Measure whether Genesis has REAL edge.
// Truth over optimism. Never inflate performance metrics.
//
// Statistical thresholds (institutional standards):
//   MIN_TRADES_FOR_EDGE     = 30   (minimum for any meaningful EV estimate)
//   MIN_TRADES_FOR_CALIBRATION = 20
//   MIN_TRADES_FOR_REGIME   = 10   (per regime bucket)
//
// All public functions return { ok, dataQuality, ... }.
// dataQuality.sufficient = false when data is too sparse to draw conclusions.

import db from '../db/database.mjs';
import { MODERN_CRYPTO_TRADE_TYPES_SQL } from '../crypto/cryptoTradeUniverse.mjs';

// ── Constants ─────────────────────────────────────────────────────────────────

export const MIN_TRADES_FOR_EDGE        = 30;
export const MIN_TRADES_FOR_CALIBRATION = 20;
export const MIN_TRADES_FOR_REGIME      = 5;

// Confidence thresholds that map to bands (must mirror confidenceEngine.mjs)
const BAND_THRESHOLDS = [
  { band: 'HIGH_CONVICTION', min: 0.82, expectedWinRate: 0.82 },
  { band: 'GOOD_SETUP',      min: 0.75, expectedWinRate: 0.75 },
  { band: 'CAUTION',         min: 0.65, expectedWinRate: 0.65 },
  { band: 'LOW_CONFIDENCE',  min: 0.50, expectedWinRate: 0.50 },
  { band: 'BLOCK',           min: 0,    expectedWinRate: 0.40 },
];

function bandForConfidence(confidence) {
  for (const t of BAND_THRESHOLDS) {
    if (confidence >= t.min) return t;
  }
  return BAND_THRESHOLDS[BAND_THRESHOLDS.length - 1];
}

// ── Raw data loader ───────────────────────────────────────────────────────────

/**
 * Load all closed trades with their outcome information.
 * Returns an array of enriched trade records.
 */
function loadClosedTrades() {
  // Prefer trade_outcomes (richer data) over raw trades join
  const fromOutcomes = db.prepare(`
    SELECT
      t.id, t.agent_id, t.market_category, t.market_source,
      t.confidence, t.entry_price, t.capital_used, t.pnl,
      t.opened_at, t.closed_at, t.days_to_close,
      t.outcome, t.resolved_outcome, t.exit_reason,
      t.entry_volume24h,
      o.confidence_band, o.pnl_realized, o.pnl_pct,
      o.duration_hours, o.outcome_result
    FROM trades t
    LEFT JOIN trade_outcomes o ON o.trade_id = t.id
    WHERE t.status = 'closed'
    ORDER BY t.closed_at DESC
  `).all();

  if (fromOutcomes.length > 0) return fromOutcomes;

  // Fallback: direct from trades (older schema compatibility)
  return db.prepare(`
    SELECT
      id, agent_id, market_category, market_source,
      confidence, entry_price, capital_used, pnl,
      opened_at, closed_at, days_to_close,
      outcome, resolved_outcome, exit_reason, entry_volume24h,
      NULL AS confidence_band, pnl AS pnl_realized,
      NULL AS pnl_pct, NULL AS duration_hours, NULL AS outcome_result
    FROM trades
    WHERE status = 'closed'
    ORDER BY closed_at DESC
  `).all();
}

/**
 * Load only modern crypto trades (scalp_v2, swing_v1, breakout_v1).
 * Excludes prediction-market trades and old crypto_scalp so metrics reflect
 * the actual scalping strategy performance in isolation.
 */
function loadClosedCryptoTrades() {
  const fromOutcomes = db.prepare(`
    SELECT
      t.id, t.agent_id, t.market_category, t.market_source,
      t.confidence, t.entry_price, t.capital_used, t.pnl,
      t.opened_at, t.closed_at, t.days_to_close,
      t.outcome, t.resolved_outcome, t.exit_reason,
      t.entry_volume24h,
      o.confidence_band, o.pnl_realized, o.pnl_pct,
      o.duration_hours, o.outcome_result
    FROM trades t
    LEFT JOIN trade_outcomes o ON o.trade_id = t.id
    WHERE t.status = 'closed' AND t.trade_type IN ${MODERN_CRYPTO_TRADE_TYPES_SQL}
    ORDER BY t.closed_at DESC
  `).all();

  if (fromOutcomes.length > 0) return fromOutcomes;

  return db.prepare(`
    SELECT
      id, agent_id, market_category, market_source,
      confidence, entry_price, capital_used, pnl,
      opened_at, closed_at, days_to_close,
      outcome, resolved_outcome, exit_reason, entry_volume24h,
      NULL AS confidence_band, pnl AS pnl_realized,
      NULL AS pnl_pct, NULL AS duration_hours, NULL AS outcome_result
    FROM trades
    WHERE status = 'closed' AND trade_type IN ${MODERN_CRYPTO_TRADE_TYPES_SQL}
    ORDER BY closed_at DESC
  `).all();
}

/**
 * Load agents with their performance profiles.
 */
function loadAgentProfiles() {
  return db.prepare(`
    SELECT
      id, name, role, total_trades, wins, losses,
      total_pnl, win_streak, loss_streak,
      max_win_streak, max_loss_streak,
      calibration_score,
      skill_market_selection, skill_timing,
      skill_position_sizing, skill_signal_reading, skill_pattern_recog
    FROM agent_profiles
    ORDER BY total_trades DESC, total_pnl DESC
  `).all();
}

// ── PART 1: Expectancy ────────────────────────────────────────────────────────

/**
 * Compute expected value per trade and related metrics.
 *
 * EV = (win_rate × avg_win) - (loss_rate × avg_loss)
 *
 * Returns:
 *   { expectancyPerTrade, winRate, lossRate, avgWin, avgLoss,
 *     totalPnl, tradeCount, dataQuality }
 */
export function computeExpectancy(trades = null) {
  const closed = trades ?? loadClosedTrades();
  const n = closed.length;

  const dataQuality = {
    tradeCount: n,
    sufficient: n >= MIN_TRADES_FOR_EDGE,
    minRequired: MIN_TRADES_FOR_EDGE,
    warning: n < MIN_TRADES_FOR_EDGE
      ? `Only ${n}/${MIN_TRADES_FOR_EDGE} trades needed for statistical significance`
      : null,
  };

  if (n === 0) {
    return {
      expectancyPerTrade: null,
      winRate: null,
      lossRate: null,
      avgWin: null,
      avgLoss: null,
      totalPnl: 0,
      tradeCount: 0,
      profitFactor: null,
      sharpeProxy: null,
      dataQuality,
    };
  }

  const wins   = closed.filter(t => (t.pnl_realized ?? t.pnl ?? 0) > 0);
  const losses = closed.filter(t => (t.pnl_realized ?? t.pnl ?? 0) < 0);

  const winRate  = wins.length / n;
  const lossRate = losses.length / n;

  const avgWin  = wins.length > 0
    ? wins.reduce((s, t) => s + (t.pnl_realized ?? t.pnl ?? 0), 0) / wins.length
    : 0;
  const avgLoss = losses.length > 0
    ? losses.reduce((s, t) => s + Math.abs(t.pnl_realized ?? t.pnl ?? 0), 0) / losses.length
    : 0;

  const expectancyPerTrade = (winRate * avgWin) - (lossRate * avgLoss);
  const totalPnl = closed.reduce((s, t) => s + (t.pnl_realized ?? t.pnl ?? 0), 0);

  // Profit factor: gross wins / gross losses
  const grossWin  = wins.reduce((s, t) => s + (t.pnl_realized ?? t.pnl ?? 0), 0);
  const grossLoss = losses.reduce((s, t) => s + Math.abs(t.pnl_realized ?? t.pnl ?? 0), 0);
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : null);

  // Sharpe proxy: mean PnL / std PnL
  const pnls = closed.map(t => t.pnl_realized ?? t.pnl ?? 0);
  const meanPnl = totalPnl / n;
  const variance = pnls.reduce((s, p) => s + (p - meanPnl) ** 2, 0) / n;
  const stdPnl = Math.sqrt(variance);
  const sharpeProxy = stdPnl > 0 ? meanPnl / stdPnl : null;

  // Sortino proxy: mean PnL / downside std (only negative returns)
  const downsidePnls = pnls.filter(p => p < 0);
  const downsideVariance = downsidePnls.length > 0
    ? downsidePnls.reduce((s, p) => s + p ** 2, 0) / downsidePnls.length
    : 0;
  const downsideStd = Math.sqrt(downsideVariance);
  const sortinoProxy = downsideStd > 0 ? meanPnl / downsideStd : null;

  // Max drawdown (equity curve): chronological order required
  const chronological = [...closed].sort((a, b) =>
    new Date(a.closed_at ?? a.opened_at).getTime() - new Date(b.closed_at ?? b.opened_at).getTime()
  );
  let equity = 0, peak = 0, maxDrawdownAbs = 0;
  for (const t of chronological) {
    equity += t.pnl_realized ?? t.pnl ?? 0;
    if (equity > peak) peak = equity;
    const dd = peak > 0 ? (peak - equity) / peak : 0;
    if (dd > maxDrawdownAbs) maxDrawdownAbs = dd;
  }
  const maxDrawdownPct = round2(maxDrawdownAbs);

  // Rolling profit factor over last 15 trades (most recent — trades are DESC)
  const recent15 = closed.slice(0, 15);
  const r15wins  = recent15.filter(t => (t.pnl_realized ?? t.pnl ?? 0) > 0);
  const r15loss  = recent15.filter(t => (t.pnl_realized ?? t.pnl ?? 0) < 0);
  const r15gw    = r15wins.reduce((s, t) => s + (t.pnl_realized ?? t.pnl ?? 0), 0);
  const r15gl    = r15loss.reduce((s, t) => s + Math.abs(t.pnl_realized ?? t.pnl ?? 0), 0);
  const rollingPf15 = recent15.length >= 5
    ? (r15gl > 0 ? round2(r15gw / r15gl) : (r15gw > 0 ? Infinity : null))
    : null;

  // Max consecutive loss streak
  const maxLossStreak = computeMaxLossStreak(closed);

  return {
    expectancyPerTrade: round2(expectancyPerTrade),
    winRate:            round2(winRate),
    lossRate:           round2(lossRate),
    avgWin:             round2(avgWin),
    avgLoss:            round2(avgLoss),
    totalPnl:           round2(totalPnl),
    tradeCount:         n,
    profitFactor:       profitFactor !== null ? round2(profitFactor) : null,
    sharpeProxy:        sharpeProxy  !== null ? round2(sharpeProxy)  : null,
    sortinoProxy:       sortinoProxy !== null ? round2(sortinoProxy) : null,
    maxDrawdownPct,
    rollingPf15,
    maxLossStreak,
    dataQuality,
  };
}

// ── PART 2: Confidence Calibration ───────────────────────────────────────────

/**
 * Measure whether confidence scores predict actual outcomes.
 *
 * For each confidence band:
 *   expected_win_rate = band.threshold (e.g. 0.82 for HIGH_CONVICTION)
 *   actual_win_rate   = wins / total in band
 *   calibration_error = |expected - actual|
 *
 * Overall calibration score = 100 - (mean_absolute_error × 100)
 *
 * Returns:
 *   { calibrationScore, bandBreakdown[], meanAbsoluteError, dataQuality }
 */
export function computeCalibration(trades = null) {
  const closed = trades ?? loadClosedTrades();
  const n = closed.length;

  const dataQuality = {
    tradeCount: n,
    sufficient: n >= MIN_TRADES_FOR_CALIBRATION,
    minRequired: MIN_TRADES_FOR_CALIBRATION,
    warning: n < MIN_TRADES_FOR_CALIBRATION
      ? `Only ${n}/${MIN_TRADES_FOR_CALIBRATION} trades needed for calibration`
      : null,
  };

  if (n === 0) {
    return {
      calibrationScore: null,
      bandBreakdown: [],
      meanAbsoluteError: null,
      overconfident: null,
      underconfident: null,
      dataQuality,
    };
  }

  // Group by confidence band
  const bandMap = {};
  for (const t of BAND_THRESHOLDS) {
    bandMap[t.band] = { band: t.band, expectedWinRate: t.expectedWinRate, trades: [], wins: 0 };
  }

  for (const trade of closed) {
    const conf = trade.confidence ?? 0;
    const binfo = bandForConfidence(conf);
    const won = (trade.pnl_realized ?? trade.pnl ?? 0) > 0;
    // Use stored band if available, otherwise compute
    const bandKey = trade.confidence_band ?? binfo.band;
    if (bandMap[bandKey]) {
      bandMap[bandKey].trades.push(trade);
      if (won) bandMap[bandKey].wins++;
    }
  }

  const breakdown = [];
  let totalError = 0;
  let bandsCounted = 0;

  for (const [, b] of Object.entries(bandMap)) {
    const cnt = b.trades.length;
    if (cnt === 0) {
      breakdown.push({ band: b.band, tradeCount: 0, expectedWinRate: b.expectedWinRate, actualWinRate: null, calibrationError: null });
      continue;
    }
    const actualWR = b.wins / cnt;
    const err = Math.abs(b.expectedWinRate - actualWR);
    totalError += err;
    bandsCounted++;
    breakdown.push({
      band:             b.band,
      tradeCount:       cnt,
      expectedWinRate:  round2(b.expectedWinRate),
      actualWinRate:    round2(actualWR),
      calibrationError: round2(err),
      overconfident:    actualWR < b.expectedWinRate - 0.05,
      underconfident:   actualWR > b.expectedWinRate + 0.05,
    });
  }

  const meanAbsoluteError = bandsCounted > 0 ? totalError / bandsCounted : null;
  const calibrationScore  = meanAbsoluteError !== null
    ? Math.max(0, Math.round((1 - meanAbsoluteError) * 100))
    : null;

  // Are we systematically over or underconfident?
  const overconfidentBands  = breakdown.filter(b => b.overconfident).length;
  const underconfidentBands = breakdown.filter(b => b.underconfident).length;

  return {
    calibrationScore,
    bandBreakdown: breakdown,
    meanAbsoluteError: meanAbsoluteError !== null ? round2(meanAbsoluteError) : null,
    overconfident:  overconfidentBands > underconfidentBands,
    underconfident: underconfidentBands > overconfidentBands,
    dataQuality,
  };
}

// ── PART 3: Agent Edge Scoring ────────────────────────────────────────────────

/**
 * Rank agents by their edge contribution.
 * Score = weighted composite:
 *   - realized PnL (25%)
 *   - win rate (25%)
 *   - drawdown contribution (20%) — lower loss streak is better
 *   - false positive rate (15%) — high confidence losses
 *   - trade quality / calibration (15%)
 *
 * Returns: agentAlphaScore (0-100) per agent.
 */
export function computeAgentEdgeScores(trades = null) {
  const closed   = trades ?? loadClosedTrades();
  const profiles = loadAgentProfiles();

  // Group closed trades by agent
  const byAgent = {};
  for (const t of closed) {
    const aid = t.agent_id ?? 'unknown';
    if (!byAgent[aid]) byAgent[aid] = [];
    byAgent[aid].push(t);
  }

  const scored = profiles.map(agent => {
    const agentTrades = byAgent[agent.id] ?? [];
    const n = agentTrades.length || agent.total_trades;

    // Use agent_profiles data if no direct trade records
    const wins   = agentTrades.length > 0
      ? agentTrades.filter(t => (t.pnl_realized ?? t.pnl ?? 0) > 0).length
      : agent.wins;
    const losses = agentTrades.length > 0
      ? agentTrades.filter(t => (t.pnl_realized ?? t.pnl ?? 0) <= 0).length
      : agent.losses;
    const totalPnl = agentTrades.length > 0
      ? agentTrades.reduce((s, t) => s + (t.pnl_realized ?? t.pnl ?? 0), 0)
      : agent.total_pnl;

    const winRate = n > 0 ? wins / n : null;

    // False positives: high confidence (>=0.75) losses
    const highConfTrades = agentTrades.filter(t => t.confidence >= 0.75);
    const falsePositives = highConfTrades.filter(t => (t.pnl_realized ?? t.pnl ?? 0) <= 0);
    const fpRate = highConfTrades.length > 0 ? falsePositives.length / highConfTrades.length : null;

    // Drawdown contribution: max consecutive loss streak
    const maxLoss = agentTrades.length > 0
      ? computeMaxLossStreak(agentTrades)
      : agent.max_loss_streak;

    // Score components (0-1 each)
    const pnlScore      = totalPnl > 0 ? Math.min(1, totalPnl / 100) : Math.max(0, 1 + totalPnl / 100);
    const wrScore       = winRate !== null ? winRate : 0.5;
    const ddScore       = Math.max(0, 1 - maxLoss / 10);  // 0 streak = 1.0, 10 streak = 0.0
    const fpScore       = fpRate !== null ? 1 - fpRate : 0.5;
    const calScore      = agent.calibration_score ?? 0.5;

    const alphaScore = Math.round(
      (pnlScore  * 0.25 +
       wrScore   * 0.25 +
       ddScore   * 0.20 +
       fpScore   * 0.15 +
       calScore  * 0.15) * 100
    );

    return {
      agentId:         agent.id,
      name:            agent.name,
      role:            agent.role,
      tradeCount:      n,
      wins,
      losses,
      totalPnl:        round2(totalPnl),
      winRate:         winRate !== null ? round2(winRate) : null,
      falsePositiveRate: fpRate !== null ? round2(fpRate) : null,
      maxLossStreak:   maxLoss,
      calibrationScore: round2(agent.calibration_score ?? 0.5),
      agentAlphaScore: Math.min(100, Math.max(0, alphaScore)),
      dataQuality: {
        sufficient: n >= 10,
        tradeCount: n,
        warning: n < 10 ? `Only ${n} trades — score not statistically reliable` : null,
      },
    };
  });

  // Sort: active traders first (by trade count), then by alphaScore
  scored.sort((a, b) => {
    if (b.tradeCount !== a.tradeCount) return b.tradeCount - a.tradeCount;
    return b.agentAlphaScore - a.agentAlphaScore;
  });

  const best  = scored.find(a => a.tradeCount > 0) ?? scored[0] ?? null;
  const worst = scored.length > 1
    ? scored.filter(a => a.tradeCount > 0).sort((a, b) => a.agentAlphaScore - b.agentAlphaScore)[0] ?? null
    : null;

  return {
    agents:      scored,
    bestAgent:   best,
    worstAgent:  worst,
    dataQuality: { tradeCount: closed.length, sufficient: closed.length >= 10 },
  };
}

// ── PART 4: Market Regime Analysis ───────────────────────────────────────────

/**
 * Track performance by market category and liquidity proxy.
 *
 * Also uses vetoed/open trades to understand WHERE Genesis is looking
 * vs WHERE it's actually executing.
 *
 * Returns: regimes[], strongestMarket, weakestMarket, exposureByCategory
 */
export function computeRegimeAnalysis(trades = null) {
  const closed = trades ?? loadClosedTrades();

  // Also load all trades (including open/vetoed) for exposure map
  const allTrades = db.prepare(`
    SELECT market_category, market_source, status, confidence, entry_volume24h
    FROM trades
  `).all();

  // Group closed by category
  const byCategory = {};
  for (const t of closed) {
    const cat = t.market_category ?? 'unknown';
    if (!byCategory[cat]) byCategory[cat] = { category: cat, trades: [], wins: 0, totalPnl: 0 };
    byCategory[cat].trades.push(t);
    const pnl = t.pnl_realized ?? t.pnl ?? 0;
    if (pnl > 0) byCategory[cat].wins++;
    byCategory[cat].totalPnl += pnl;
  }

  const regimes = Object.values(byCategory).map(c => {
    const n = c.trades.length;
    const winRate = n > 0 ? c.wins / n : null;
    const avgPnl  = n > 0 ? c.totalPnl / n : null;

    // Liquidity proxy: avg entry_volume24h
    const volData = c.trades.filter(t => t.entry_volume24h != null);
    const avgVol = volData.length > 0
      ? volData.reduce((s, t) => s + (t.entry_volume24h ?? 0), 0) / volData.length
      : null;

    return {
      category:   c.category,
      tradeCount: n,
      winRate:    winRate !== null ? round2(winRate) : null,
      totalPnl:   round2(c.totalPnl),
      avgPnl:     avgPnl !== null ? round2(avgPnl) : null,
      avgVolume:  avgVol !== null ? round2(avgVol) : null,
      sufficient: n >= MIN_TRADES_FOR_REGIME,
    };
  });

  regimes.sort((a, b) => (b.totalPnl ?? 0) - (a.totalPnl ?? 0));

  const sufficient = regimes.filter(r => r.sufficient);
  const strongest  = sufficient.sort((a, b) => (b.avgPnl ?? 0) - (a.avgPnl ?? 0))[0] ?? null;
  const weakest    = sufficient.sort((a, b) => (a.avgPnl ?? 0) - (b.avgPnl ?? 0))[0] ?? null;

  // Exposure map: what categories does Genesis see/veto/execute
  const exposure = {};
  for (const t of allTrades) {
    const cat = t.market_category ?? 'unknown';
    if (!exposure[cat]) exposure[cat] = { category: cat, seen: 0, vetoed: 0, open: 0, closed: 0 };
    exposure[cat].seen++;
    if (t.status === 'vetoed') exposure[cat].vetoed++;
    if (t.status === 'open')   exposure[cat].open++;
    if (t.status === 'closed') exposure[cat].closed++;
  }

  const exposureList = Object.values(exposure).sort((a, b) => b.seen - a.seen);

  return {
    regimes,
    strongestMarket: strongest?.category ?? null,
    weakestMarket:   weakest?.category ?? null,
    exposureByCategory: exposureList,
    dataQuality: {
      totalClosed: closed.length,
      sufficient:  regimes.some(r => r.sufficient),
      warning: regimes.every(r => !r.sufficient)
        ? `No category has ${MIN_TRADES_FOR_REGIME}+ closed trades — regime analysis unreliable`
        : null,
    },
  };
}

// ── PART 5: Decision Quality ──────────────────────────────────────────────────

/**
 * Classify trades by decision quality:
 *
 * Good trade    = positive expectancy (profitable or >0 PnL)
 * Bad trade     = negative expectancy (loss)
 * False positive = high confidence (>=0.75) + loss
 * False negative = blocked by confidence but proxied by operator_events
 *
 * Returns decision quality metrics.
 */
export function computeDecisionQuality(trades = null) {
  const closed = trades ?? loadClosedTrades();
  const n = closed.length;

  // Good and bad trades
  const goodTrades = closed.filter(t => (t.pnl_realized ?? t.pnl ?? 0) > 0);
  const badTrades  = closed.filter(t => (t.pnl_realized ?? t.pnl ?? 0) <= 0);

  // False positives: high confidence (>=0.75) losses
  const highConfTrades  = closed.filter(t => (t.confidence ?? 0) >= 0.75);
  const falsePositives  = highConfTrades.filter(t => (t.pnl_realized ?? t.pnl ?? 0) <= 0);

  // False negatives: blocked trades that might have won — proxy via operator_events
  let blockedCount = 0;
  let confidenceBlocked = 0;
  try {
    blockedCount = db.prepare(`
      SELECT COUNT(*) AS n FROM operator_events
      WHERE category = 'TRADING' AND reason LIKE 'BLOCKED%'
    `).get()?.n ?? 0;
    confidenceBlocked = db.prepare(`
      SELECT COUNT(*) AS n FROM operator_events
      WHERE reason LIKE 'BLOCKED_CONFIDENCE%'
    `).get()?.n ?? 0;
  } catch { /* operator_events may not have data yet */ }

  // Also count veto-blocked trades (structural false negatives we can't evaluate)
  const vetoedCount = db.prepare(`
    SELECT COUNT(*) AS n FROM trades WHERE status = 'vetoed'
  `).get()?.n ?? 0;

  return {
    tradeCount:    n,
    goodTrades:    goodTrades.length,
    badTrades:     badTrades.length,
    goodTradeRate: n > 0 ? round2(goodTrades.length / n) : null,

    falsePositives:     falsePositives.length,
    falsePositiveRate:  highConfTrades.length > 0
      ? round2(falsePositives.length / highConfTrades.length)
      : null,

    // We can't compute true false negatives without knowing what blocked trades would have resolved to.
    // Keep totalBlocked aligned with the two explicit buckets shown in the UI.
    // Other BLOCKED_* operator events are intentionally excluded from this metric.
    blockedByConfidence:  confidenceBlocked,
    blockedByVeto:        vetoedCount,
    totalBlocked:         confidenceBlocked + vetoedCount,
    blockedByOther:       Math.max(0, blockedCount - confidenceBlocked),
    falseNegativeNote:    'False negatives cannot be measured without outcome data on blocked trades.',

    dataQuality: {
      tradeCount: n,
      sufficient: n >= MIN_TRADES_FOR_EDGE,
      warning: n < MIN_TRADES_FOR_EDGE
        ? `${n}/${MIN_TRADES_FOR_EDGE} closed trades needed for decision quality analysis`
        : null,
    },
  };
}

// ── Full alpha report ─────────────────────────────────────────────────────────

/**
 * Generate a complete alpha validation report.
 * This is the single function called by the API endpoints.
 */
export function getAlphaReport() {
  let closed, cryptoClosed;
  try {
    closed       = loadClosedTrades();
    cryptoClosed = loadClosedCryptoTrades();
  } catch (err) {
    return {
      ok: false,
      error: err.message,
      hasEdge: null,
      verdict: 'ERROR',
    };
  }

  const expectancy      = computeExpectancy(closed);
  const calibration     = computeCalibration(closed);
  const agentEdge       = computeAgentEdgeScores(closed);
  const regimes         = computeRegimeAnalysis(closed);
  const decisionQuality = computeDecisionQuality(closed);

  // Crypto-only expectancy: scalp_v2 + swing_v1 + breakout_v1 (excludes prediction market)
  const cryptoExpectancy = computeExpectancy(cryptoClosed);
  const cryptoVerdict    = deriveVerdict(cryptoExpectancy, computeCalibration(cryptoClosed), cryptoClosed.length);

  // Overall edge verdict (institutional-grade honesty)
  const verdict = deriveVerdict(expectancy, calibration, closed.length);

  return {
    ok: true,
    generatedAt:     new Date().toISOString(),
    tradeHistory:    closed.length,
    hasEdge:         verdict.hasEdge,
    verdict:         verdict.label,
    verdictReason:   verdict.reason,
    minTradesNeeded: MIN_TRADES_FOR_EDGE,

    expectancy,
    calibration,
    agentEdge,
    regimes,
    decisionQuality,

    // Isolated crypto strategy edge (scalp_v2 / swing_v1 / breakout_v1 only)
    cryptoExpectancy: {
      ...cryptoExpectancy,
      tradeCount:   cryptoClosed.length,
      hasEdge:      cryptoVerdict.hasEdge,
      verdict:      cryptoVerdict.label,
      verdictReason: cryptoVerdict.reason,
    },

    // Quick-access summary for truthLayer
    summary: {
      expectancyPerTrade:  expectancy.expectancyPerTrade,
      winRate:             expectancy.winRate,
      calibrationScore:    calibration.calibrationScore,
      profitFactor:        expectancy.profitFactor,
      bestAgent:           agentEdge.bestAgent?.agentId ?? null,
      worstAgent:          agentEdge.worstAgent?.agentId ?? null,
      strongestMarket:     regimes.strongestMarket,
      weakestMarket:       regimes.weakestMarket,
      confidenceAccuracy:  calibration.calibrationScore,
      falsePositiveRate:   decisionQuality.falsePositiveRate,
      dataInsufficient:    closed.length < MIN_TRADES_FOR_EDGE,
    },
  };
}

/**
 * Derive the honest edge verdict from available evidence.
 */
function deriveVerdict(expectancy, calibration, tradeCount) {
  if (tradeCount === 0) {
    return {
      hasEdge: null,
      label: 'NO_DATA',
      reason: 'Zero closed trades. Genesis has not yet generated a track record. Edge cannot be measured.',
    };
  }

  if (tradeCount < MIN_TRADES_FOR_EDGE) {
    const ev = expectancy.expectancyPerTrade;
    const direction = ev === null ? 'unknown' : ev > 0 ? 'positive' : 'negative';
    return {
      hasEdge: null,
      label: 'INSUFFICIENT_DATA',
      reason: `Only ${tradeCount}/${MIN_TRADES_FOR_EDGE} trades required for statistical significance. ` +
              `Early EV direction: ${direction}. Do not draw conclusions yet.`,
    };
  }

  const ev = expectancy.expectancyPerTrade ?? 0;
  const wr = expectancy.winRate ?? 0;
  const pf = expectancy.profitFactor ?? 0;

  if (ev > 0 && wr > 0.55 && pf > 1.2) {
    return {
      hasEdge: true,
      label: 'EDGE_CONFIRMED',
      reason: `EV=$${ev.toFixed(2)}/trade, WR=${(wr * 100).toFixed(0)}%, PF=${pf.toFixed(2)}. ` +
              `Edge appears real but requires continued monitoring for regime persistence.`,
    };
  }

  if (ev > 0 && wr > 0.5) {
    return {
      hasEdge: null,
      label: 'MARGINAL_EDGE',
      reason: `EV=$${ev.toFixed(2)}/trade positive but profit factor ${pf.toFixed(2)} is borderline. ` +
              `More trades needed to distinguish edge from luck.`,
    };
  }

  return {
    hasEdge: false,
    label: 'NO_EDGE_DETECTED',
    reason: `EV=$${ev.toFixed(2)}/trade, WR=${(wr * 100).toFixed(0)}%. ` +
            `No statistically significant edge detected. Review strategy before scaling.`,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function round2(v) {
  if (v === null || v === undefined || !isFinite(v)) return v;
  return Math.round(v * 100) / 100;
}

function computeMaxLossStreak(trades) {
  // Sorted oldest first
  const sorted = [...trades].sort((a, b) => new Date(a.opened_at) - new Date(b.opened_at));
  let max = 0, cur = 0;
  for (const t of sorted) {
    if ((t.pnl_realized ?? t.pnl ?? 0) <= 0) {
      cur++;
      if (cur > max) max = cur;
    } else {
      cur = 0;
    }
  }
  return max;
}
