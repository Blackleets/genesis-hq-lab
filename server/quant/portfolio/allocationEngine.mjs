// allocationEngine.mjs — capital allocation for validated strategies.
//
// Rules:
//   REJECTED / DISABLED    → 0%
//   RESEARCH / BACKTESTING → 0%
//   PAPER                  → max 5% simulated (no real capital)
//   PROMOTED               → score-weighted, capped
//   Safe mode active       → 0% for ALL
//   Daily loss cap hit     → 0% for ALL
//
// Does NOT execute trades. Returns recommendations only.
// All amounts are in USD paper mode unless explicitly stated otherwise.

import { isGlobalSafeMode, getGlobalRiskDiagnostics } from '../../risk/globalRiskEngine.mjs';
import { isSafeMode } from '../../memory/reconciliationEngine.mjs';
import { getTreasury } from '../../trading/treasury.mjs';
import { validateStrategyProfile } from '../validation/validationGate.mjs';
import { getStrategyRegistry } from '../alpha/strategyRegistry.mjs';

// ── Allocation parameters ─────────────────────────────────────────────────────

const ALLOC = Object.freeze({
  paperMaxPct:      0.05,   // 5% of capital — max for PAPER strategies
  promotedMaxPct:   0.20,   // 20% of capital per promoted strategy (hard cap)
  portfolioMaxPct:  0.50,   // 50% total at risk across all strategies
  minCapitalBuffer: 500,    // keep at least $500 unallocated
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function round2(v) {
  return v == null ? null : Math.round(v * 100) / 100;
}

function computeStrategyScore(liveData) {
  if (!liveData) return 0;
  const { trades = 0, winRate = 0, profitFactor = 0, avgPnl = 0 } = liveData;
  // Simple score: winRate% + pf*5 + avgPnl contribution
  const pf = Number.isFinite(profitFactor) ? profitFactor : 0;
  return round2(
    (winRate ?? 0) * 40
    + pf * 10
    + Math.min(Math.max(avgPnl ?? 0, -20), 20) * 0.5
    + Math.min(trades, 100) * 0.1,
  );
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
      allocations:     [],
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

  const dailyLossCap   = parseFloat(process.env.CRYPTO_DAILY_LOSS_CAP ?? '300');
  const dailyLossToday = treasury?.dailyLossToday ?? 0;

  if (dailyLossToday >= dailyLossCap) {
    return {
      allocations:     [],
      totalAllocatedPct: 0,
      totalAllocatedUsd: 0,
      blocked: true,
      reason:  'DAILY_LOSS_CAP',
      note:    `Daily loss $${dailyLossToday} has reached cap $${dailyLossCap}.`,
      updatedAt: new Date().toISOString(),
    };
  }

  const allocatableCapital = Math.max(0, capital - ALLOC.minCapitalBuffer);

  // ── 3. Get strategies ─────────────────────────────────────────────────────
  const registry    = getStrategyRegistry();
  const strategies  = registry.strategies;

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
        strategyScore:       0,
        recommendedCapitalPct: 0,
        maxPositionUsd:      0,
        riskBudgetUsd:       0,
        reason:              `${status} — no capital until status improves`,
        live,
      });
      continue;
    }

    // PAPER strategies: up to 5% simulated
    if (status === 'PAPER') {
      const pct  = ALLOC.paperMaxPct;
      const usd  = round2(allocatableCapital * pct);
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
        live,
      });
    }
  }

  return {
    allocations,
    totalAllocatedPct:    round2(totalPct),
    totalAllocatedUsd:    round2(allocatableCapital * totalPct),
    availableCapital:     round2(capital),
    allocatableCapital:   round2(allocatableCapital),
    blocked:              false,
    reason:               null,
    portfolioCapPct:      ALLOC.portfolioMaxPct,
    dailyLossToday:       round2(dailyLossToday),
    dailyLossCap,
    updatedAt:            new Date().toISOString(),
  };
}
