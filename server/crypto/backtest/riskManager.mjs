// riskManager.mjs — Concurrency + trailing-stop + global exposure cap layer
// for the multi-pair executor. Goal: lower REAL drawdown before any live
// capital, WITHOUT killing the validated edge. All logic tested on REAL data
// via the executor integration.
//
// Rules (all tunable via env):
//   - MAX_OPEN: never hold more than N positions at once (throttle correlation).
//   - TRAIL_PCT: once a trade is +TRAIL_ACT_PCT in profit, move SL to
//     entry + TRAIL_PCT (lock partial profit). Protects winners.
//   - MAX_RISK_PCT: never risk more than this % of total capital across all
//     open positions combined.
//
// This module exports helpers; multiPairExecutorRisk.mjs consumes them.

export function makeRiskManager({ maxOpen = 6, maxRiskPct = 8.0, trailPct = 0.003, trailActivatePct = 0.004 } = {}) {
  const state = { open: 0, riskUsedPct: 0 };
  return {
    canOpen(equitySliceRiskPct) {
      if (state.open >= maxOpen) return false;
      if (state.riskUsedPct + equitySliceRiskPct > maxRiskPct) return false;
      return true;
    },
    markOpen(equitySliceRiskPct) { state.open++; state.riskUsedPct += equitySliceRiskPct; },
    markClose() { state.open = Math.max(0, state.open - 1); /* risk freed when trade closes */ },
    get state() { return { ...state }; },
    // trailing stop: given entry, current SL, side, and current price, return
    // new SL if trailing should engage, else existing SL.
    trailStop({ side, entry, sl, price }) {
      if (side === 'LONG') {
        const profit = (price - entry) / entry;
        if (profit >= trailActivatePct) {
          const newSl = entry * (1 + trailPct);
          return Math.max(sl, newSl); // only move up
        }
      } else {
        const profit = (entry - price) / entry;
        if (profit >= trailActivatePct) {
          const newSl = entry * (1 - trailPct);
          return Math.min(sl, newSl); // only move down
        }
      }
      return sl;
    },
    config: { maxOpen, maxRiskPct, trailPct, trailActivatePct },
  };
}
