// fundingTruthLedger.mjs — pure economic reconciliation for the PAPER funding desk.
// Truth rule: realized economics = price P&L + collected funding - ALL known fees.
// Open MTM is reported separately and only enters total/equity, never realized P&L.
// No execution code lives here. LIVE_OFF is unaffected.

function hasFiniteValue(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

function num(value, fallback = 0) {
  return hasFiniteValue(value) ? Number(value) : fallback;
}

function sum(rows, pick) {
  return rows.reduce((acc, row) => acc + num(pick(row)), 0);
}

export function pricePnlForClosedTrade(trade = {}) {
  if (hasFiniteValue(trade.realizedPricePnlUsdt)) {
    return Number(trade.realizedPricePnlUsdt);
  }

  const entry = num(trade.entryPx, NaN);
  const exit = num(trade.exitPx, NaN);
  const notional = num(trade.notional, NaN);
  const side = String(trade.side || '').toLowerCase();

  if (entry > 0 && exit > 0 && notional > 0 && (side === 'long' || side === 'short')) {
    const move = side === 'short' ? (entry - exit) / entry : (exit - entry) / entry;
    return move * notional;
  }

  // Legacy capture snapshots sometimes closed a paper hold without persisting
  // exitPx, but did persist the final mark. Use that final mark as the best
  // auditable historical evidence instead of silently treating the loss as 0.
  return num(trade.mtmUsdt, 0);
}

export function deriveClosedPricePnl(closed = []) {
  const rows = Array.isArray(closed) ? closed : [];
  return sum(rows, pricePnlForClosedTrade);
}

export function buildFundingTruthLedger(state = {}) {
  const capitalUsdt = num(state.capital, 10_000);
  const realizedFundingUsdt = num(state.realizedFundingUsdt);
  const feesUsdt = num(state.feesUsdt);
  const holds = Array.isArray(state.holds) ? state.holds : [];
  const closed = Array.isArray(state.closed) ? state.closed : [];
  const mtmUsdt = hasFiniteValue(state.mtmUsdt)
    ? Number(state.mtmUsdt)
    : sum(holds, (h) => h.mtmUsdt);

  // closed[] is the accounting source of truth. The top-level persisted total is
  // merely a reconciled cache and must never override a newly appended close.
  const closedPricePnlUsdt = deriveClosedPricePnl(closed);
  const realizedPricePnlUsdt = closedPricePnlUsdt;
  const hasExplicitPricePnl = hasFiniteValue(state.realizedPricePnlUsdt);
  const explicitPricePnl = hasExplicitPricePnl ? Number(state.realizedPricePnlUsdt) : null;

  const knownEntryFeesUsdt = sum(closed, (t) => t.entryFeeUsdt ?? t.feeUsdt)
    + sum(holds, (t) => t.entryFeeUsdt ?? t.feeUsdt);
  const knownExitFeesUsdt = sum(closed, (t) => t.exitFeeUsdt);
  const knownAllocatedFeesUsdt = knownEntryFeesUsdt + knownExitFeesUsdt;
  const unallocatedFeesUsdt = feesUsdt - knownAllocatedFeesUsdt;

  const realizedNetPnlUsdt = realizedFundingUsdt + realizedPricePnlUsdt - feesUsdt;
  const economicPnlUsdt = realizedNetPnlUsdt + mtmUsdt;
  const equityUsdt = capitalUsdt + economicPnlUsdt;
  const pricePnlReconciliationDeltaUsdt = hasExplicitPricePnl
    ? explicitPricePnl - closedPricePnlUsdt
    : 0;

  return {
    ledgerVersion: 2,
    capitalUsdt,
    realizedFundingUsdt,
    realizedPricePnlUsdt,
    feesUsdt,
    mtmUsdt,
    realizedNetPnlUsdt,
    economicPnlUsdt,
    equityUsdt,
    closedCount: closed.length,
    openHolds: holds.length,
    feeBreakdown: {
      knownEntryFeesUsdt,
      knownExitFeesUsdt,
      knownAllocatedFeesUsdt,
      unallocatedFeesUsdt,
    },
    reconciliation: {
      priceSource: 'DERIVED_FROM_CLOSED',
      closedPricePnlUsdt,
      persistedPricePnlUsdt: explicitPricePnl,
      pricePnlReconciliationDeltaUsdt,
      legacyFeeAllocationIncomplete: Math.abs(unallocatedFeesUsdt) > 1e-9,
    },
  };
}

export function reconcileFundingState(state = {}) {
  const ledger = buildFundingTruthLedger(state);
  return {
    ...state,
    ledgerVersion: 2,
    realizedPricePnlUsdt: ledger.realizedPricePnlUsdt,
    realizedNetPnlUsdt: ledger.realizedNetPnlUsdt,
    economicPnlUsdt: ledger.economicPnlUsdt,
    equityUsdt: ledger.equityUsdt,
    truthLedger: ledger,
  };
}
