// cryptoAnalytics.mjs — crypto-only performance & training visibility.
// Separates crypto_scalp trades from prediction-market trades so each strategy
// is judged on its own. Read-only (DB + the optimizer's JSON logs). Never import
// runOptimizer here — that would start the training loop inside the API process.

import db from '../db/database.mjs';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getParams, getParamsMeta } from './strategyParams.mjs';
import { CRYPTO_TRADE_TYPES_SQL, getClosedCryptoMetrics } from './cryptoTradeUniverse.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const RUNS_LOG = join(__dir, '..', '..', 'data', 'strategy', 'optimizer_runs.json');
const HEARTBEAT = join(__dir, '..', '..', 'data', 'strategy', 'optimizer_heartbeat.json');

/** Last optimizer pass status — proves the 24/7 training loop is alive. */
export function getOptimizerHeartbeat() {
  try {
    return JSON.parse(readFileSync(HEARTBEAT, 'utf8'));
  } catch {
    return null;
  }
}

export function getCryptoPnlSummary() {
  const closed = getClosedCryptoMetrics();

  const open = db.prepare(`
    SELECT COUNT(*) AS cnt, COALESCE(SUM(capital_used), 0) AS at_risk
    FROM trades WHERE trade_type IN ${CRYPTO_TRADE_TYPES_SQL} AND status = 'open'
  `).get();

  const byAsset = db.prepare(`
    SELECT asset_pair AS pair,
           COUNT(*)   AS trades,
           COALESCE(SUM(pnl), 0) AS pnl,
           SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) AS wins
    FROM trades WHERE trade_type IN ${CRYPTO_TRADE_TYPES_SQL} AND status = 'closed'
    GROUP BY asset_pair ORDER BY pnl DESC
  `).all();

  const total = closed?.trades ?? 0;
  return {
    closed: {
      total,
      wins: closed?.wins ?? 0,
      losses: closed?.losses ?? 0,
      winRate: closed?.winRate ?? 0,
      totalPnl: closed?.totalPnl ?? 0,
      bestTrade: closed?.bestTrade ?? 0,
      worstTrade: closed?.worstTrade ?? 0,
      avgPnl: closed?.avgPnl ?? 0,
      totalRisked: closed?.totalRisked ?? 0,
      roi: closed?.roi ?? 0,
    },
    open: { count: open?.cnt ?? 0, atRisk: open?.at_risk ?? 0 },
    byAsset: byAsset.map(a => ({ ...a, winRate: a.trades > 0 ? a.wins / a.trades : 0 })),
  };
}

export function getOpenCryptoPositions() {
  return db.prepare(`
    SELECT id, asset_pair AS pair, outcome AS side, entry_price, target_price, stop_price,
           capital_used, confidence, opened_at
    FROM trades WHERE trade_type IN ${CRYPTO_TRADE_TYPES_SQL} AND status = 'open'
    ORDER BY opened_at DESC
  `).all();
}

export function getRecentCryptoTrades(limit = 25) {
  return db.prepare(`
    SELECT id, asset_pair AS pair, outcome AS side, entry_price, exit_price, pnl,
           exit_reason, confidence, opened_at, closed_at
    FROM trades WHERE trade_type IN ${CRYPTO_TRADE_TYPES_SQL} AND status = 'closed'
    ORDER BY closed_at DESC LIMIT ?
  `).all(limit);
}

/** Optimizer run log (most recent first) — the visible proof of 24/7 training. */
export function getOptimizerRuns(limit = 20) {
  try {
    const log = JSON.parse(readFileSync(RUNS_LOG, 'utf8'));
    return log.slice(-limit).reverse();
  } catch {
    return [];
  }
}

// ─── Crypto edge scorecard — GO / NO-GO for real crypto capital ──────────────
// Unlike the prediction scorecard (which needs resolved YES/NO trades), this is
// driven by the optimizer's walk-forward OUT-OF-SAMPLE result — the honest
// "did training find a config with real, validated edge?" signal. Falls back to
// live closed crypto trades when no optimizer run exists yet.

const CRYPTO_MIN_TRADES = 30;
const CRYPTO_START_CAPITAL = Number.parseFloat(process.env.CRYPTO_START_CAPITAL ?? '10000');

// Profit factor + max drawdown computed from the actual closed-trade PnL
// series, so the live-trades scorecard shows real values instead of "—".
function getLiveRiskMetrics() {
  const rows = db.prepare(`
    SELECT pnl FROM trades
    WHERE trade_type IN ${CRYPTO_TRADE_TYPES_SQL} AND status = 'closed' AND pnl IS NOT NULL
    ORDER BY closed_at ASC
  `).all();
  if (!rows.length) return { profitFactor: null, maxDrawdown: null };

  let grossWin = 0, grossLoss = 0, equity = CRYPTO_START_CAPITAL, peak = CRYPTO_START_CAPITAL, maxDd = 0;
  for (const { pnl } of rows) {
    const v = Number(pnl) || 0;
    if (v > 0) grossWin += v; else grossLoss += Math.abs(v);
    equity += v;
    peak = Math.max(peak, equity);
    if (peak > 0) maxDd = Math.max(maxDd, (peak - equity) / peak);
  }
  return {
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 3 : null,
    maxDrawdown: maxDd,
  };
}

export function computeCryptoEdgeScorecard() {
  const lastRun = getOptimizerRuns(1)[0];
  const live = getCryptoPnlSummary();

  // Prefer the validated out-of-sample metrics; else fall back to live results.
  let m = lastRun?.oosMetrics ?? null;
  let source = 'walk-forward (out-of-sample)';
  if (!m || (m.trades ?? 0) < CRYPTO_MIN_TRADES) {
    if (live.closed.total >= CRYPTO_MIN_TRADES) {
      const risk = getLiveRiskMetrics();
      m = {
        trades: live.closed.total, winRate: live.closed.winRate,
        netPnl: live.closed.totalPnl, expectancy: live.closed.avgPnl,
        roi: live.closed.roi, profitFactor: risk.profitFactor, maxDrawdown: risk.maxDrawdown,
      };
      source = 'live closed trades';
    }
  }

  if (!m) {
    return {
      engine: 'crypto', verdict: 'INSUFFICIENT_DATA', source: 'none',
      totalClosed: live.closed.total, winRate: live.closed.winRate, roi: live.closed.roi, totalPnl: live.closed.totalPnl,
      expectancy: null, profitFactor: null, maxDrawdown: null,
      checks: {}, failingChecks: [],
      nextMilestone: `Run the optimizer (npm run optimizer) — need a walk-forward result or ${CRYPTO_MIN_TRADES}+ live trades`,
    };
  }

  const n = m.trades ?? 0;
  const checks = {
    sufficientData:   { pass: n >= CRYPTO_MIN_TRADES, value: n, threshold: CRYPTO_MIN_TRADES, label: `${n} / ${CRYPTO_MIN_TRADES} validated trades` },
    positiveExpectancy:{ pass: (m.expectancy ?? 0) > 0, value: round3(m.expectancy), threshold: 0, label: 'Positive expectancy per trade ($)' },
    winRate:          { pass: (m.winRate ?? 0) >= 0.45, value: round3(m.winRate), threshold: 0.45, label: 'Win rate ≥ 45% (after costs)' },
    profitFactor:     { pass: m.profitFactor == null ? false : m.profitFactor > 1.1, value: m.profitFactor != null ? round3(m.profitFactor) : null, threshold: 1.1, label: 'Profit factor > 1.1' },
    lowDrawdown:      { pass: m.maxDrawdown == null ? true : m.maxDrawdown < 0.10, value: m.maxDrawdown != null ? round3(m.maxDrawdown) : null, threshold: 0.10, label: 'Max drawdown < 10%' },
  };

  let verdict;
  if (!checks.sufficientData.pass) verdict = 'INSUFFICIENT_DATA';
  else if (Object.values(checks).every(c => c.pass)) verdict = 'GO';
  else verdict = 'NO_GO';

  const failingChecks = Object.entries(checks)
    .filter(([, c]) => !c.pass)
    .map(([key, c]) => ({ key, label: c.label, value: c.value, threshold: c.threshold }));

  return {
    engine: 'crypto', verdict, source,
    totalClosed: live.closed.total,
    winRate: round3(m.winRate ?? 0),
    roi: m.roi != null ? Math.round(m.roi * 10000) / 100 : 0,
    totalPnl: round3(m.netPnl ?? 0),
    expectancy: round3(m.expectancy),
    profitFactor: m.profitFactor != null ? round3(m.profitFactor) : null,
    maxDrawdown: m.maxDrawdown != null ? round3(m.maxDrawdown) : null,
    checks, failingChecks,
    nextMilestone: verdict === 'INSUFFICIENT_DATA'
      ? `${Math.max(0, CRYPTO_MIN_TRADES - n)} more validated trades needed`
      : null,
  };
}

function round3(x) {
  return x == null ? null : Math.round(x * 1000) / 1000;
}

/** Today's closed/win/pnl + open count per live engine type (scalp_v2, swing_v1). */
export function getScalpV2TodayStats() {
  const result = {};
  for (const type of ['scalp_v2', 'swing_v1']) {
    const closed = db.prepare(`
      SELECT COUNT(*) AS n,
             SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) AS wins,
             COALESCE(SUM(pnl), 0) AS pnl
      FROM trades
      WHERE trade_type = ? AND status = 'closed'
        AND DATE(closed_at) = DATE('now')
    `).get(type);
    const open = db.prepare(`SELECT COUNT(*) AS n FROM trades WHERE trade_type = ? AND status = 'open'`).get(type)?.n ?? 0;
    result[type] = {
      closedToday:   closed?.n    ?? 0,
      winsToday:     closed?.wins ?? 0,
      pnlToday:      Math.round((closed?.pnl ?? 0) * 100) / 100,
      openPositions: open,
    };
  }
  return result;
}

/** Everything the Crypto Lab view needs in one shot. */
export function getCryptoOverview() {
  return {
    params: getParams(),
    paramsMeta: getParamsMeta(),
    pnl: getCryptoPnlSummary(),
    positions: getOpenCryptoPositions(),
    recent: getRecentCryptoTrades(),
    optimizerRuns: getOptimizerRuns(),
    optimizerHeartbeat: getOptimizerHeartbeat(),
    edgeScorecard: computeCryptoEdgeScorecard(),
  };
}
