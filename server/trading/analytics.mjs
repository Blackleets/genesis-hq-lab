// analytics.mjs — performance metrics for Genesis HQ trading.
// Sharpe ratio, Brier score, win rate, drawdown, category breakdown.
// These are the metrics a real hedge fund watches. No vanity numbers.

import db from '../db/database.mjs';
import { getTreasury, getPnLSummary, getCapitalHistory } from './treasury.mjs';

// ─── Brier Score — calibration metric ────────────────────────────────────────
// Measures how accurate confidence scores are.
// Perfect = 0.0 | Random = 0.25 | Terrible = 0.50+
// Target for Genesis HQ: < 0.20 (solid) → < 0.15 (professional)

export function computeBrierScore() {
  const trades = db.prepare(`
    SELECT confidence, resolved_outcome, outcome
    FROM trades
    WHERE status = 'closed' AND confidence IS NOT NULL
  `).all();

  if (trades.length < 5) return { score: null, label: 'Insufficient data (need 5+ closed trades)', n: trades.length };

  let sumSquaredError = 0;
  for (const trade of trades) {
    // f = our stated probability that YES wins (confidence when betting YES, 1-confidence when betting NO)
    const yesProb = trade.outcome === 'YES'
      ? trade.confidence
      : 1 - trade.confidence;

    // o = 1 if YES actually won, 0 if NO won
    const yesOutcome = trade.resolved_outcome === 'YES' ? 1 : 0;

    sumSquaredError += Math.pow(yesProb - yesOutcome, 2);
  }

  const score = sumSquaredError / trades.length;
  const label = score < 0.10 ? 'Excellent' :
    score < 0.15 ? 'Professional' :
      score < 0.20 ? 'Good' :
        score < 0.25 ? 'Average' :
          'Below average';

  return { score: Math.round(score * 1000) / 1000, label, n: trades.length };
}

// ─── Sharpe Ratio — risk-adjusted return ─────────────────────────────────────
// Using per-trade returns as our "time series"
// Target: > 1.0 | Excellent: > 2.0

export function computeSharpe() {
  const trades = db.prepare(`
    SELECT pnl, capital_used FROM trades
    WHERE status = 'closed' AND capital_used > 0
    ORDER BY closed_at ASC
  `).all();

  if (trades.length < 10) return { ratio: null, label: 'Insufficient data (need 10+ trades)', n: trades.length };

  // Per-trade return = pnl / capital_used
  const returns = trades.map(t => (t.pnl ?? 0) / t.capital_used);

  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;

  const variance = returns.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return { ratio: 0, label: 'No variance', n: trades.length };

  // Risk-free rate = 0 for the current strategy.
  const sharpe = mean / stdDev;
  const label = sharpe > 2.0 ? 'Excellent' :
    sharpe > 1.5 ? 'Very good' :
      sharpe > 1.0 ? 'Good' :
        sharpe > 0.5 ? 'Acceptable' :
          'Needs improvement';

  return { ratio: Math.round(sharpe * 100) / 100, label, mean, stdDev, n: trades.length };
}

// ─── Category breakdown — where are we winning and losing ─────────────────────

export function getCategoryBreakdown() {
  return db.prepare(`
    SELECT
      market_category                                              AS category,
      COUNT(*)                                                     AS total,
      SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END)                   AS wins,
      SUM(CASE WHEN pnl <= 0 THEN 1 ELSE 0 END)                  AS losses,
      ROUND(CAST(SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) AS REAL) / COUNT(*), 3) AS win_rate,
      ROUND(SUM(pnl), 2)                                          AS total_pnl,
      ROUND(AVG(confidence), 3)                                   AS avg_confidence
    FROM trades
    WHERE status = 'closed'
    GROUP BY market_category
    ORDER BY total_pnl DESC
  `).all();
}

// ─── Confidence distribution — are we well-calibrated? ───────────────────────

export function getCalibrationData() {
  // Group trades by confidence bucket (0.65-0.70, 0.70-0.75, etc.)
  const trades = db.prepare(`
    SELECT
      ROUND(confidence / 0.05) * 0.05 AS bucket,
      COUNT(*) AS cnt,
      SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) AS wins
    FROM trades
    WHERE status = 'closed' AND confidence >= 0.50
    GROUP BY bucket
    ORDER BY bucket
  `).all();

  return trades.map(row => ({
    confBucket: Math.round(row.bucket * 100) / 100,
    count: row.cnt,
    actualWinRate: row.cnt > 0 ? Math.round((row.wins / row.cnt) * 1000) / 1000 : 0,
    expectedWinRate: Math.round(row.bucket * 1000) / 1000,
    calibrationGap: Math.round((row.bucket - (row.wins / row.cnt || 0)) * 1000) / 1000,
  }));
  // If actualWinRate ≈ confBucket → well-calibrated
  // If actualWinRate < confBucket → overconfident (bad)
  // If actualWinRate > confBucket → underconfident (conservative)
}

// ─── Signal accuracy — which evidence types actually work ─────────────────────

export function getSignalAccuracy() {
  const trades = db.prepare(`
    SELECT evidence, pnl FROM trades
    WHERE status = 'closed' AND evidence != '[]'
  `).all();

  const signalStats = {};

  for (const trade of trades) {
    let evidence;
    try { evidence = JSON.parse(trade.evidence); } catch { continue; }

    const won = (trade.pnl ?? 0) > 0;
    for (const signal of evidence) {
      // Normalize signal to a short keyword
      const key = signal.toLowerCase().slice(0, 40);
      if (!signalStats[key]) signalStats[key] = { uses: 0, wins: 0 };
      signalStats[key].uses++;
      if (won) signalStats[key].wins++;
    }
  }

  return Object.entries(signalStats)
    .filter(([, s]) => s.uses >= 2)
    .map(([signal, s]) => ({
      signal,
      uses: s.uses,
      wins: s.wins,
      winRate: Math.round((s.wins / s.uses) * 1000) / 1000,
    }))
    .sort((a, b) => b.winRate - a.winRate);
}

// ─── Max drawdown from trade history ─────────────────────────────────────────

export function computeMaxDrawdown() {
  const history = getCapitalHistory(500);
  if (history.length < 2) return { pct: 0, amount: 0 };

  let peak = history[0]?.total ?? 10000;
  let maxDrawdown = 0;
  let maxDrawdownAmount = 0;

  for (const row of history) {
    if (row.total > peak) peak = row.total;
    const dd = (peak - row.total) / peak;
    if (dd > maxDrawdown) {
      maxDrawdown = dd;
      maxDrawdownAmount = peak - row.total;
    }
  }

  return {
    pct: Math.round(maxDrawdown * 1000) / 1000,
    amount: Math.round(maxDrawdownAmount * 100) / 100,
  };
}

// ─── Edge scorecard — GO / NO-GO / INSUFFICIENT_DATA ─────────────────────────
// The single source of truth on whether this engine has proven real edge.
// Only flip REAL_TRADING=1 when verdict is GO.

const MIN_TRADES_FOR_VERDICT = 50;

export function computeEdgeScorecard() {
  const pnl     = getPnLSummary();
  const brier   = computeBrierScore();
  const sharpe  = computeSharpe();
  const cal     = getCalibrationData();

  const totalClosed  = pnl.closed.total;
  const winRate      = pnl.closed.winRate;
  const totalPnl     = pnl.closed.totalPnl;
  const totalRisked  = pnl.closed.totalRisked;
  const roi          = totalRisked > 0 ? totalPnl / totalRisked : 0;

  // Calibration gap: average absolute gap across confidence buckets
  const calibrationGap = cal.length > 0
    ? cal.reduce((s, r) => s + Math.abs(r.calibrationGap), 0) / cal.length
    : null;

  // Brier skill score: 1 - (brier / 0.25). Positive = better than random.
  const brierSkill = brier.score != null ? 1 - brier.score / 0.25 : null;

  const checks = {
    sufficientData:   { pass: totalClosed >= MIN_TRADES_FOR_VERDICT, value: totalClosed, threshold: MIN_TRADES_FOR_VERDICT, label: `${totalClosed} / ${MIN_TRADES_FOR_VERDICT} trades resolved` },
    brierSkill:       { pass: brierSkill != null && brierSkill > 0,  value: brierSkill != null ? Math.round(brierSkill * 1000) / 1000 : null, threshold: 0, label: 'Brier skill > 0 (better than random)' },
    sharpe:           { pass: sharpe.ratio != null && sharpe.ratio > 0.8, value: sharpe.ratio, threshold: 0.8, label: 'Sharpe (net of fees) > 0.8' },
    positiveRoi:      { pass: roi > 0, value: Math.round(roi * 10000) / 100, threshold: 0, label: 'Positive ROI on closed trades' },
    calibration:      { pass: calibrationGap != null && calibrationGap < 0.10, value: calibrationGap != null ? Math.round(calibrationGap * 1000) / 1000 : null, threshold: 0.10, label: 'Calibration gap < 0.10' },
  };

  let verdict;
  if (!checks.sufficientData.pass) {
    verdict = 'INSUFFICIENT_DATA';
  } else if (Object.values(checks).every(c => c.pass)) {
    verdict = 'GO';
  } else {
    verdict = 'NO_GO';
  }

  const failingChecks = Object.entries(checks)
    .filter(([, c]) => !c.pass)
    .map(([key, c]) => ({ key, label: c.label, value: c.value, threshold: c.threshold }));

  return {
    verdict,
    totalClosed,
    winRate: Math.round(winRate * 1000) / 1000,
    roi: Math.round(roi * 10000) / 100,
    totalPnl: Math.round(totalPnl * 100) / 100,
    brierScore: brier.score,
    brierSkill,
    brierLabel: brier.label,
    sharpeRatio: sharpe.ratio,
    sharpeLabel: sharpe.label,
    calibrationGap,
    checks,
    failingChecks,
    nextMilestone: totalClosed < MIN_TRADES_FOR_VERDICT
      ? `${MIN_TRADES_FOR_VERDICT - totalClosed} more trades needed for verdict`
      : null,
  };
}

// ─── Full dashboard payload ───────────────────────────────────────────────────

export function getDashboardMetrics() {
  const treasury = getTreasury();
  const pnl = getPnLSummary();
  const brier = computeBrierScore();
  const sharpe = computeSharpe();
  const breakdown = getCategoryBreakdown();
  const calibration = getCalibrationData();
  const signalAcc = getSignalAccuracy();
  const drawdown = computeMaxDrawdown();
  const history = getCapitalHistory(50);

  // Recent skips and vetoes (to track discipline)
  const skipCount = db.prepare(`
    SELECT COUNT(*) AS cnt FROM trades
    WHERE status = 'vetoed' AND date(opened_at) = date('now')
  `).get()?.cnt ?? 0;

  return {
    treasury: {
      total: treasury.total,
      available: treasury.available,
      inTrades: treasury.inTrades,
      totalReturn: treasury.totalReturn,
      isPaused: treasury.isPaused,
      drawdownPct: treasury.drawdownPct,
    },
    performance: {
      totalTrades: pnl.closed.total,
      winRate: pnl.closed.winRate,
      totalPnl: pnl.closed.totalPnl,
      avgPnl: pnl.closed.avgPnl,
      bestTrade: pnl.closed.bestTrade,
      worstTrade: pnl.closed.worstTrade,
      roi: pnl.closed.roi,
    },
    risk: {
      brierScore: brier,
      sharpeRatio: sharpe,
      maxDrawdown: drawdown,
      openTrades: pnl.open.count,
      atRisk: pnl.open.atRisk,
      todaySkips: skipCount,
    },
    breakdown,
    calibration,
    signalAccuracy: signalAcc.slice(0, 10),
    capitalHistory: history,
  };
}
