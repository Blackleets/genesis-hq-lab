// trainingPlan.mjs — 30-day paper trading training plan.
//
// PHASE 1 (Days 1-10):  Calibration — trade small, observe everything, build signal accuracy
// PHASE 2 (Days 11-20): Optimization — tighten rules, apply lessons, target >55% win rate
// PHASE 3 (Days 21-30): Readiness — stress test, prove consistency, gate for real money
//
// REAL MONEY GATE CONDITIONS (all must be met):
//   - 30 complete paper trading days
//   - Win rate ≥ 55% on closed trades
//   - Drawdown never exceeded 12%
//   - Minimum 15 closed trades (enough sample)
//   - No loss streak > 3 in Phase 3
//   - Total PnL > 0

import db from '../db/database.mjs';
import { getTreasury } from './treasury.mjs';

const STARTING_CAPITAL = 10_000;
const PLAN_START_KEY   = 'training_plan_start';

// ─── Get training start date ───────────────────────────────────────────────────

function getStartDate() {
  // Use the first trade's opened_at as the start, or today if no trades yet
  const firstTrade = db.prepare(
    `SELECT opened_at FROM trades WHERE status != 'vetoed' ORDER BY opened_at ASC LIMIT 1`
  ).get();

  return firstTrade?.opened_at
    ? new Date(firstTrade.opened_at)
    : new Date();
}

// ─── Get current training status ─────────────────────────────────────────────

export function getTrainingStatus() {
  const startDate   = getStartDate();
  const now         = new Date();
  const dayElapsed  = Math.floor((now - startDate) / 86_400_000);
  const dayNumber   = Math.min(30, Math.max(1, dayElapsed + 1));

  const phase = dayNumber <= 10 ? 1
              : dayNumber <= 20 ? 2
              : 3;

  const treasury = getTreasury();

  // Aggregate stats on closed trades
  const stats = db.prepare(`
    SELECT
      COUNT(*)                                     AS total,
      SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END)   AS wins,
      SUM(CASE WHEN pnl < 0 THEN 1 ELSE 0 END)   AS losses,
      SUM(pnl)                                     AS total_pnl,
      MAX(pnl)                                     AS best_trade,
      MIN(pnl)                                     AS worst_trade
    FROM trades WHERE status = 'closed'
  `).get();

  // Max drawdown — walk history in time order, comparing each value to the
  // running peak seen so far (peak-then-trough, not global max vs global min)
  const maxDrawdownEver = computeMaxDrawdown();

  // Phase 3 loss streak
  const phase3Start = new Date(startDate.getTime() + 20 * 86_400_000).toISOString();
  const phase3LossStreak = getMaxLossStreak(phase3Start);

  // Gate evaluation
  const gate = evaluateGate({
    dayNumber,
    totalClosed:      stats?.total    ?? 0,
    winRate:          stats?.total > 0 ? (stats.wins / stats.total) : 0,
    totalPnl:         stats?.total_pnl ?? 0,
    maxDrawdownEver,
    phase3LossStreak,
  });

  return {
    startDate:      startDate.toISOString(),
    dayNumber,
    daysRemaining:  Math.max(0, 30 - dayNumber),
    phase,
    phaseLabel:     ['', 'Calibration', 'Optimization', 'Readiness'][phase],
    phaseGoal:      PHASE_GOALS[phase],

    stats: {
      totalClosed:   stats?.total     ?? 0,
      wins:          stats?.wins      ?? 0,
      losses:        stats?.losses    ?? 0,
      winRate:       stats?.total > 0 ? stats.wins / stats.total : 0,
      totalPnl:      stats?.total_pnl ?? 0,
      bestTrade:     stats?.best_trade ?? 0,
      worstTrade:    stats?.worst_trade ?? 0,
    },

    capital: {
      current:       treasury.total,
      starting:      STARTING_CAPITAL,
      totalReturn:   treasury.totalReturn,
      drawdownNow:   treasury.drawdownPct,
      maxDrawdown:   maxDrawdownEver,
    },

    gate,
    realMoneyReady: gate.passed,
  };
}

// ─── Phase goals ──────────────────────────────────────────────────────────────

const PHASE_GOALS = {
  1: 'Execute 5+ trades. Focus on signal accuracy and veto patterns. Target: learn what NOT to trade.',
  2: 'Apply lessons. Tighten scalping rules. Target: >50% win rate with ≤10% drawdown.',
  3: 'Prove consistency. No emotional trades. Target: ≥55% win rate, 15+ trades, PnL > 0.',
};

// ─── Gate check — all conditions for real money ───────────────────────────────

function evaluateGate({ dayNumber, totalClosed, winRate, totalPnl, maxDrawdownEver, phase3LossStreak }) {
  const conditions = [
    {
      id:      'days',
      label:   '30 paper trading days completed',
      passed:  dayNumber >= 30,
      value:   `Day ${dayNumber}/30`,
    },
    {
      id:      'trades',
      label:   'Minimum 15 closed trades',
      passed:  totalClosed >= 15,
      value:   `${totalClosed} trades`,
    },
    {
      id:      'winRate',
      label:   'Win rate ≥ 55%',
      passed:  winRate >= 0.55,
      value:   `${(winRate * 100).toFixed(1)}%`,
    },
    {
      id:      'pnl',
      label:   'Total PnL > 0',
      passed:  totalPnl > 0,
      value:   `$${totalPnl.toFixed(2)}`,
    },
    {
      id:      'drawdown',
      label:   'Max drawdown never exceeded 12%',
      passed:  maxDrawdownEver <= 0.12,
      value:   `${(maxDrawdownEver * 100).toFixed(1)}% peak drawdown`,
    },
    {
      id:      'phase3Streak',
      label:   'No loss streak > 3 in Phase 3',
      passed:  phase3LossStreak <= 3,
      value:   `Max streak: ${phase3LossStreak}`,
    },
  ];

  const passedAll  = conditions.every(c => c.passed);
  const passedCount = conditions.filter(c => c.passed).length;

  return {
    passed:       passedAll,
    passedCount,
    totalChecks:  conditions.length,
    conditions,
    summary: passedAll
      ? '✅ ALL CONDITIONS MET — System is ready for real capital deployment.'
      : `⏳ ${passedCount}/${conditions.length} conditions met. Complete training before real money.`,
  };
}

// ─── Max drawdown (time-ordered: peak then trough) ───────────────────────────
// Walks capital_history in chronological order, tracking the running high-water
// mark. At each point, drawdown = (peak_so_far - current) / peak_so_far.
// This correctly ignores earlier lows that occurred BEFORE later peaks.

function computeMaxDrawdown() {
  const rows = db.prepare(
    `SELECT total FROM capital_history ORDER BY recorded_at ASC`
  ).all();

  if (rows.length === 0) return 0;

  let peak = rows[0].total;
  let maxDD = 0;

  for (const { total } of rows) {
    if (total > peak) peak = total;
    const dd = peak > 0 ? (peak - total) / peak : 0;
    if (dd > maxDD) maxDD = dd;
  }

  return maxDD;
}

// ─── Max loss streak from a given date ───────────────────────────────────────

function getMaxLossStreak(fromDate) {
  const trades = db.prepare(`
    SELECT pnl FROM trades
    WHERE status = 'closed' AND opened_at >= ?
    ORDER BY closed_at ASC
  `).all(fromDate);

  let maxStreak = 0;
  let current   = 0;
  for (const t of trades) {
    if ((t.pnl ?? 0) < 0) {
      current++;
      if (current > maxStreak) maxStreak = current;
    } else {
      current = 0;
    }
  }
  return maxStreak;
}

// ─── Daily performance snapshot ───────────────────────────────────────────────

export function getDailyPerformance() {
  return db.prepare(`
    SELECT
      date(opened_at)                              AS day,
      COUNT(*)                                     AS trades,
      SUM(CASE WHEN status='closed' AND pnl > 0 THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN status='closed' AND pnl < 0 THEN 1 ELSE 0 END) AS losses,
      SUM(CASE WHEN status='closed' THEN pnl ELSE 0 END)           AS daily_pnl
    FROM trades
    WHERE status != 'vetoed'
    GROUP BY date(opened_at)
    ORDER BY day ASC
    LIMIT 30
  `).all();
}
