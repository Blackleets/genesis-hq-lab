// allocationEngine.mjs — capital allocation for validated strategies.
//
// Rules:
//   REJECTED / DISABLED    → 0%
//   RESEARCH / BACKTESTING → 0%
//   PAPER                  → max 5% simulated (no real capital)
//   PROMOTED               → score-weighted, capped
//   Safe mode active       → 0% for ALL
//   Daily loss cap hit     → 0% for ALL
//   Portfolio notional cap → 0% if open futures notional > 2x capital
//
// Does NOT execute trades. Returns recommendations only.
// All amounts are in USD paper mode unless explicitly stated otherwise.

import db from '../../db/database.mjs';
import { isGlobalSafeMode } from '../../risk/globalRiskEngine.mjs';
import { isSafeMode } from '../../memory/reconciliationEngine.mjs';
import { getTreasury } from '../../trading/treasury.mjs';
import { dailyCryptoRealizedPnl } from '../../crypto/cryptoRisk.mjs';
import { validateStrategyProfile } from '../validation/validationGate.mjs';
import { getStrategyRegistry } from '../alpha/strategyRegistry.mjs';

// ── Allocation parameters ─────────────────────────────────────────────────────

const ALLOC = Object.freeze({
  paperMaxPct:          0.05,   // 5% of capital — max for PAPER strategies
  promotedMaxPct:       0.20,   // 20% of capital per promoted strategy (hard cap)
  portfolioMaxPct:      0.50,   // 50% total at risk across all strategies
  minCapitalBuffer:     500,    // keep at least $500 unallocated
  maxNotionalMultiple:  2.0,    // max aggregate futures notional = 2× capital
  maxOpenPerPair:       2,      // max open positions per asset pair (any direction)
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function round2(v) {
  return v == null ? null : Math.round(v * 100) / 100;
}

function computeStrategyScore(liveData) {
  if (!liveData) return 0;
  const { trades = 0, winRate = 0, profitFactor = 0, avgPnl = 0 } = liveData;
  const pf = Number.isFinite(profitFactor) ? profitFactor : 0;
  return round2(
    (winRate ?? 0) * 40
    + pf * 10
    + Math.min(Math.max(avgPnl ?? 0, -20), 20) * 0.5
    + Math.min(trades, 100) * 0.1,
  );
}

/**
 * Sum notional_usd across all currently open futures positions.
 * Returns 0 when no futures trades are open or the column is missing.
 */
function getOpenFuturesNotional() {
  try {
    const row = db.prepare(`
      SELECT COALESCE(SUM(notional_usd), 0) AS total
      FROM trades
      WHERE status = 'open'
        AND instrument_type = 'futures'
        AND notional_usd IS NOT NULL
    `).get();
    return row?.total ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Count open positions per asset pair to detect concentration.
 * Returns a Map<pair, count>.
 */
function getOpenPositionsByPair() {
  try {
    const rows = db.prepare(`
      SELECT asset_pair, COUNT(*) AS n
      FROM trades
      WHERE status = 'open' AND asset_pair IS NOT NULL
      GROUP BY asset_pair
    `).all();
    return new Map(rows.map(r => [r.asset_pair, r.n]));
  } catch {
    return new Map();
  }
}

// ── Main allocation function ──────────────────────────────────────────────────

/**
 * Compute capital allocation recommendations for all registered strategies.
 *
 * @param {{ availableCapital?: number }} opts
 * @returns {{ allocations, totalAllocatedPct, totalAllocatedUsd, blocked, reason, updatedAt }}
 */
export function computeAllocation({ availableCapital } = {}) {
  // ── 1. System-level blocks ────────────────────────────────────────────────
  const globalSafe = isGlobalSafeMode();
  const reconSafe  = isSafeMode();

  if (globalSafe || reconSafe) {
    return {
      allocations:       [],
      totalAllocatedPct: 0,
      totalAllocatedUsd: 0,
      blocked: true,
      reason:  globalSafe ? 'GLOBAL_SAFE_MODE' : 'RECONCILIATION_SAFE_MODE',
      note:    'All capital allocation blocked until safe mode clears.',
      updatedAt: new Date().toISOString(),
    };
  }

  // ── 2. Get capital ────────────────────────────────────────────────────────
  let treasury = null;
  let capital  = availableCapital;
  try {
    treasury = getTreasury();
    if (capital == null) capital = treasury?.available ?? treasury?.total ?? 0;
  } catch { capital = capital ?? 0; }

  // ── 3. Daily loss cap — reads actual closed-trade PnL, not a missing treasury field ──
  const dailyLossCap   = parseFloat(process.env.CRYPTO_DAILY_LOSS_CAP ?? '300');
  const rawDailyPnl    = dailyCryptoRealizedPnl();           // negative = loss, positive = gain
  const dailyLossToday = Math.abs(Math.min(0, rawDailyPnl)); // how much has been LOST today ($)

  if (dailyLossToday >= dailyLossCap) {
    return {
      allocations:       [],
      totalAllocatedPct: 0,
      totalAllocatedUsd: 0,
      blocked: true,
      reason:  'DAILY_LOSS_CAP',
      note:    `Daily realized loss $${dailyLossToday.toFixed(2)} has reached cap $${dailyLossCap}.`,
      dailyLossToday:    round2(dailyLossToday),
      dailyLossCap,
      updatedAt: new Date().toISOString(),
    };
  }

  // ── 4. Portfolio notional cap — prevent aggregate leverage blowup ─────────
  const openNotional      = getOpenFuturesNotional();
  const maxNotionalUsd    = capital * ALLOC.maxNotionalMultiple;

  if (openNotional > maxNotionalUsd && capital > 0) {
    return {
      allocations:       [],
      totalAllocatedPct: 0,
      totalAllocatedUsd: 0,
      blocked: true,
      reason:  'NOTIONAL_CAP',
      note:    `Open futures notional $${openNotional.toFixed(0)} exceeds ${ALLOC.maxNotionalMultiple}× capital cap $${maxNotionalUsd.toFixed(0)}. Wait for positions to close.`,
      openNotional:      round2(openNotional),
      maxNotionalUsd:    round2(maxNotionalUsd),
      updatedAt: new Date().toISOString(),
    };
  }

  const allocatableCapital = Math.max(0, capital - ALLOC.minCapitalBuffer);

  // ── 5. Per-pair concentration snapshot (used as advisory in allocation) ───
  const openByPair = getOpenPositionsByPair();

  // ── 6. Get strategies ─────────────────────────────────────────────────────
  const registry   = getStrategyRegistry();
  const strategies = registry.strategies;

  const allocations = [];
  let totalPct      = 0;

  for (const strategy of strategies) {
    const { status, live, strategyId, name } = strategy;

    // Strategies that get 0%
    if (['REJECTED', 'DISABLED', 'RESEARCH', 'BACKTESTING'].includes(status)) {
      allocations.push({
        strategyId,
        name,
        status,
        strategyScore:         0,
        recommendedCapitalPct: 0,
        maxPositionUsd:        0,
        riskBudgetUsd:         0,
        reason:                `${status} — no capital until status improves`,
        live,
      });
      continue;
    }

    // PAPER strategies: up to 5% simulated
    if (status === 'PAPER') {
      const pct = ALLOC.paperMaxPct;
      const usd = round2(allocatableCapital * pct);
      allocations.push({
        strategyId,
        name,
        status,
        strategyScore:         computeStrategyScore(live),
        recommendedCapitalPct: pct,
        maxPositionUsd:        usd,
        riskBudgetUsd:         round2(usd * 0.02), // 2% risk per trade
        reason:                'PAPER mode — simulated capital only, not real',
        paperMode:             true,
        live,
      });
      // PAPER doesn't consume real allocation budget
      continue;
    }

    // PROMOTED strategies: score-weighted, capped at promotedMaxPct
    if (status === 'PROMOTED') {
      // Re-validate with current gate rules
      const validation = live ? validateStrategyProfile({
        trades:       live.trades,
        profitFactor: live.profitFactor,
        avgPnl:       live.avgPnl,
        maxDrawdown:  null,
        winRate:      live.winRate,
        paused:       live.paused,
      }) : { approved: false };

      if (!validation.approved) {
        allocations.push({
          strategyId,
          name,
          status,
          strategyScore:         0,
          recommendedCapitalPct: 0,
          maxPositionUsd:        0,
          riskBudgetUsd:         0,
          reason:                `Validation gate failed: ${validation.reasons.join('; ')}`,
          live,
        });
        continue;
      }

      const score = computeStrategyScore(live);
      // Base 10% + up to 10% more based on score (score 0-100 → 0-10%)
      const rawPct = 0.10 + (score / 100) * 0.10;
      const pct    = Math.min(rawPct, ALLOC.promotedMaxPct);

      // Portfolio cap: don't exceed total portfolio limit
      const remainingBudget = ALLOC.portfolioMaxPct - totalPct;
      const effectivePct    = Math.min(pct, Math.max(0, remainingBudget));
      const usd             = round2(allocatableCapital * effectivePct);

      totalPct += effectivePct;

      // Advisory: flag if any pairs are at concentration limit
      const pairWarnings = [];
      for (const [pair, count] of openByPair) {
        if (count >= ALLOC.maxOpenPerPair) {
          pairWarnings.push(`${pair}:${count}open`);
        }
      }

      allocations.push({
        strategyId,
        name,
        status,
        strategyScore:         score,
        recommendedCapitalPct: round2(effectivePct),
        maxPositionUsd:        usd,
        riskBudgetUsd:         round2(usd * 0.01), // 1% risk per trade for promoted
        reason:                `PROMOTED — score ${score}, allocated ${(effectivePct * 100).toFixed(1)}%`,
        paperMode:             false,
        pairConcentration:     pairWarnings.length > 0 ? pairWarnings : null,
        live,
      });
    }
  }

  return {
    allocations,
    totalAllocatedPct:   round2(totalPct),
    totalAllocatedUsd:   round2(allocatableCapital * totalPct),
    availableCapital:    round2(capital),
    allocatableCapital:  round2(allocatableCapital),
    blocked:             false,
    reason:              null,
    portfolioCapPct:     ALLOC.portfolioMaxPct,
    dailyLossToday:      round2(dailyLossToday),
    dailyLossCap,
    openNotional:        round2(openNotional),
    maxNotionalUsd:      round2(maxNotionalUsd),
    updatedAt:           new Date().toISOString(),
  };
}
