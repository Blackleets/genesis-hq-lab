// pnlEngine.mjs — canonical PnL calculations for Genesis HQ.
//
// Single source of truth for all time-bucketed and attributed PnL.
// Every function reads exclusively from SQLite — no fake state, no local defaults.
//
// All monetary values in USD, all rates as decimals (0.65 = 65%).
// Null means "no data" — never default to 0 for a metric that has no basis.

import db from '../db/database.mjs';

// ── Helpers ────────────────────────────────────────────────────────────────────

const PREDICTION_ONLY = `COALESCE(trade_type, 'prediction') <> 'crypto_scalp'`;
const CRYPTO_ONLY = `trade_type = 'crypto_scalp'`;

function isoDay(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);  // 'YYYY-MM-DD'
}

function isoWeekStart() {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay());  // Sunday
  return d.toISOString().slice(0, 10);
}

function safeRate(num, denom) {
  return denom > 0 ? num / denom : null;
}

function roundCents(n) {
  return n == null ? null : Math.round(n * 100) / 100;
}

// ── Realized PnL — closed trades only ─────────────────────────────────────────

export function getRealizedPnl() {
  const row = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN pnl < 0 THEN 1 ELSE 0 END) AS losses,
      COALESCE(SUM(pnl), 0)         AS total_pnl,
      COALESCE(MAX(pnl), 0)         AS best_trade,
      COALESCE(MIN(pnl), 0)         AS worst_trade,
      COALESCE(AVG(pnl), 0)         AS avg_pnl,
      COALESCE(SUM(capital_used), 0) AS total_risked
    FROM trades WHERE status = 'closed'
  `).get();

  const total = row?.total ?? 0;
  const wins = row?.wins ?? 0;

  return {
    total,
    wins,
    losses: row?.losses ?? 0,
    winRate: safeRate(wins, total),
    totalPnl: roundCents(row?.total_pnl),
    bestTrade: roundCents(row?.best_trade),
    worstTrade: roundCents(row?.worst_trade),
    avgPnl: roundCents(row?.avg_pnl),
    totalRisked: roundCents(row?.total_risked),
    roi: safeRate(row?.total_pnl, row?.total_risked),
  };
}

// ── Daily PnL — trades closed today ───────────────────────────────────────────

export function getDailyPnl() {
  const today = isoDay();
  const row = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) AS wins,
      COALESCE(SUM(pnl), 0) AS total_pnl,
      COALESCE(MAX(pnl), 0) AS best,
      COALESCE(MIN(pnl), 0) AS worst
    FROM trades
    WHERE status = 'closed' AND DATE(closed_at) = DATE(?)
  `).get(today);

  const total = row?.total ?? 0;
  return {
    date: today,
    total,
    wins: row?.wins ?? 0,
    winRate: safeRate(row?.wins, total),
    totalPnl: roundCents(row?.total_pnl),
    bestTrade: roundCents(row?.best),
    worstTrade: roundCents(row?.worst),
  };
}

// ── Weekly PnL — trades closed since Sunday of current week ──────────────────

export function getWeeklyPnl() {
  const weekStart = isoWeekStart();
  const row = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) AS wins,
      COALESCE(SUM(pnl), 0) AS total_pnl,
      COALESCE(MAX(pnl), 0) AS best,
      COALESCE(MIN(pnl), 0) AS worst
    FROM trades
    WHERE status = 'closed' AND DATE(closed_at) >= DATE(?)
  `).get(weekStart);

  const total = row?.total ?? 0;
  return {
    weekStart,
    total,
    wins: row?.wins ?? 0,
    winRate: safeRate(row?.wins, total),
    totalPnl: roundCents(row?.total_pnl),
    bestTrade: roundCents(row?.best),
    worstTrade: roundCents(row?.worst),
  };
}

// ── Rolling PnL — last N days ─────────────────────────────────────────────────

export function getRollingPnl(days = 30) {
  const cutoff = isoDay(-days);
  const row = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) AS wins,
      COALESCE(SUM(pnl), 0)          AS total_pnl,
      COALESCE(SUM(capital_used), 0) AS total_risked
    FROM trades
    WHERE status = 'closed' AND DATE(closed_at) >= DATE(?)
  `).get(cutoff);

  const total = row?.total ?? 0;
  return {
    days,
    since: cutoff,
    total,
    wins: row?.wins ?? 0,
    winRate: safeRate(row?.wins, total),
    totalPnl: roundCents(row?.total_pnl),
    roi: safeRate(row?.total_pnl, row?.total_risked),
  };
}

// ── PnL by source (polymarket vs kalshi vs crypto) ────────────────────────────

export function getPnLBySource() {
  const rows = db.prepare(`
    SELECT
      market_source,
      COUNT(*) AS total,
      SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) AS wins,
      COALESCE(SUM(pnl), 0) AS total_pnl
    FROM trades
    WHERE status = 'closed'
    GROUP BY market_source
  `).all();

  return rows.map(r => ({
    source: r.market_source,
    total: r.total,
    wins: r.wins,
    winRate: safeRate(r.wins, r.total),
    totalPnl: roundCents(r.total_pnl),
  }));
}

// ── Win/Loss stats + average risk:reward ─────────────────────────────────────

export function getWinLossStats() {
  const wins = db.prepare(`
    SELECT COALESCE(AVG(pnl), 0) AS avg_win, COALESCE(MAX(pnl), 0) AS max_win
    FROM trades WHERE status = 'closed' AND pnl > 0
  `).get();

  const losses = db.prepare(`
    SELECT COALESCE(AVG(pnl), 0) AS avg_loss, COALESCE(MIN(pnl), 0) AS max_loss
    FROM trades WHERE status = 'closed' AND pnl < 0
  `).get();

  const avgWin = wins?.avg_win ?? 0;
  const avgLoss = Math.abs(losses?.avg_loss ?? 0);
  const riskReward = avgLoss > 0 ? avgWin / avgLoss : null;

  // Current streaks
  const recent = db.prepare(`
    SELECT pnl FROM trades WHERE status = 'closed' ORDER BY closed_at DESC LIMIT 20
  `).all();

  let winStreak = 0, lossStreak = 0;
  for (const t of recent) {
    if (t.pnl > 0) { winStreak++; if (lossStreak > 0) break; }
    else if (t.pnl < 0) { lossStreak++; if (winStreak > 0) break; }
    else break;
  }

  return {
    avgWin: roundCents(avgWin),
    avgLoss: roundCents(losses?.avg_loss),  // negative number
    maxWin: roundCents(wins?.max_win),
    maxLoss: roundCents(losses?.max_loss),  // negative number
    riskReward: riskReward != null ? Math.round(riskReward * 100) / 100 : null,
    currentWinStreak: winStreak,
    currentLossStreak: lossStreak,
  };
}

// ── Per-trade attribution ─────────────────────────────────────────────────────
// Answers for each trade: why entered, which agent, confidence, expected edge,
// actual outcome. Full audit trail from what was saved at decision time.

export function getTradeAttribution(tradeId) {
  const trade = db.prepare(`
    SELECT
      t.*,
      l.lesson_text,
      l.why_failed,
      l.what_change,
      l.new_rule
    FROM trades t
    LEFT JOIN lessons l ON l.trade_id = t.id
    WHERE t.id = ?
  `).get(tradeId);

  if (!trade) return null;

  let evidence = [];
  let signals_used = [];
  let lessons_applied = [];
  let rules_applied = [];

  try { evidence = JSON.parse(trade.evidence || '[]'); } catch { evidence = []; }
  try { signals_used = JSON.parse(trade.signals_used || '[]'); } catch { signals_used = []; }
  try { lessons_applied = JSON.parse(trade.lessons_applied || '[]'); } catch { lessons_applied = []; }
  try { rules_applied = JSON.parse(trade.rules_applied || '[]'); } catch { rules_applied = []; }

  const expectedEdge = trade.confidence != null
    ? (trade.confidence - (1 - trade.confidence) / ((1 / (trade.entry_price || 0.5)) - 1 || 1))
    : null;

  return {
    id: trade.id,
    agentId: trade.agent_id,
    market: {
      id: trade.market_id,
      source: trade.market_source,
      question: trade.market_question,
      category: trade.market_category,
    },
    decision: {
      outcome: trade.outcome,
      confidence: trade.confidence,
      entryPrice: trade.entry_price,
      shares: trade.shares,
      capitalUsed: trade.capital_used,
      reason: trade.reason,
      evidence,
      signalsUsed: signals_used,
      lessonsApplied: lessons_applied,
      rulesApplied: rules_applied,
      expectedEdge: expectedEdge != null ? Math.round(expectedEdge * 1000) / 1000 : null,
    },
    result: {
      status: trade.status,
      resolvedOutcome: trade.resolved_outcome ?? null,
      exitPrice: trade.exit_price ?? null,
      pnl: trade.pnl != null ? roundCents(trade.pnl) : null,
      daysHeld: trade.days_to_close ?? null,
      openedAt: trade.opened_at,
      closedAt: trade.closed_at ?? null,
    },
    lesson: trade.lesson_text ? {
      text: trade.lesson_text,
      whyFailed: trade.why_failed,
      whatChange: trade.what_change,
      newRule: trade.new_rule,
    } : null,
  };
}

// ── Attribution list — recent trades with full context ────────────────────────

export function getAttributionList(limit = 20) {
  const trades = db.prepare(`
    SELECT id FROM trades
    WHERE status IN ('closed', 'open')
    ORDER BY opened_at DESC
    LIMIT ?
  `).all(limit);

  return trades.map(t => getTradeAttribution(t.id)).filter(Boolean);
}

// ── Stale position detection ──────────────────────────────────────────────────
// Positions open longer than maxAgeHours are flagged as potentially stale.

export function detectStalePositions(maxAgeHours = 48) {
  const cutoff = new Date(Date.now() - maxAgeHours * 3_600_000).toISOString();
  const stale = db.prepare(`
    SELECT id, market_id, market_source, market_question, capital_used, opened_at
    FROM trades
    WHERE status = 'open' AND opened_at < ?
    ORDER BY opened_at ASC
  `).all(cutoff);

  return stale.map(t => ({
    id: t.id,
    marketId: t.market_id,
    source: t.market_source,
    question: t.market_question,
    capitalUsed: t.capital_used,
    openedAt: t.opened_at,
    ageHours: Math.round((Date.now() - new Date(t.opened_at).getTime()) / 3_600_000),
  }));
}

// ── PnL freshness — when was the last trade settled ─────────────────────────

export function getPnLFreshness() {
  const last = db.prepare(`
    SELECT closed_at, pnl FROM trades
    WHERE status = 'closed' AND closed_at IS NOT NULL
    ORDER BY closed_at DESC LIMIT 1
  `).get();

  if (!last) return { lastSettledAt: null, msSinceLastSettle: null, fresh: null };

  const msSince = Date.now() - new Date(last.closed_at).getTime();
  return {
    lastSettledAt: last.closed_at,
    lastPnl: roundCents(last.pnl),
    msSinceLastSettle: msSince,
    fresh: msSince < 24 * 3_600_000,  // stale after 24h with no settlements
  };
}

// ── Full PnL dashboard ────────────────────────────────────────────────────────

export function getPnLDashboard() {
  return {
    realized: getRealizedPnl(),
    daily: getDailyPnl(),
    weekly: getWeeklyPnl(),
    rolling30d: getRollingPnl(30),
    rolling7d: getRollingPnl(7),
    bySource: getPnLBySource(),
    winLoss: getWinLossStats(),
    freshness: getPnLFreshness(),
    stalePositions: detectStalePositions(48),
    generatedAt: new Date().toISOString(),
  };
}

// ── Structured log helpers ─────────────────────────────────────────────────────

export const pnlLog = {
  mismatch(context, expected, actual) {
    console.warn(`[pnl:mismatch:${context}] expected=${expected} actual=${actual}`);
  },
  stale(tradeId, ageHours) {
    console.warn(`[pnl:stale] trade ${tradeId} open for ${ageHours}h — may be orphaned`);
  },
  orphan(tradeId, reason) {
    console.error(`[pnl:orphan] trade ${tradeId}: ${reason}`);
  },
  executionMismatch(tradeId, field, stored, computed) {
    console.warn(`[pnl:execution_mismatch] trade ${tradeId} field=${field} stored=${stored} computed=${computed}`);
  },
};
