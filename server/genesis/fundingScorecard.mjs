// fundingScorecard.mjs — honest separation of PAPER vs EDGE vs PRODUCTION.
// Never invents fills. Never flips LIVE_OFF. Never claims GO.

import { buildFundingTruthLedger } from './fundingTruthLedger.mjs';

export const LIVE_OFF = true;

export function buildFundingScorecard(state = {}) {
  const paper = state.paper === true;
  const liveOff = state.liveOff !== false;
  const settles = Number(state.settledCount) || 0;
  const ledger = buildFundingTruthLedger(state);

  const paperPerformance = {
    cobradoUsdt: ledger.realizedFundingUsdt,
    realizedPricePnlUsdt: ledger.realizedPricePnlUsdt,
    feesUsdt: ledger.feesUsdt,
    realizedNetPnlUsdt: ledger.realizedNetPnlUsdt,
    mtmUsdt: ledger.mtmUsdt,
    economicPnlUsdt: ledger.economicPnlUsdt,
    equityUsdt: ledger.equityUsdt,
    settledCount: settles,
    openHolds: ledger.openHolds,
    closedCount: ledger.closedCount,
    ledgerVersion: ledger.ledgerVersion,
    reconciliation: ledger.reconciliation,
    feeBreakdown: ledger.feeBreakdown,
    note: 'Economic PnL = realized price PnL + collected funding - fees + open MTM. MTM is never treated as collected.',
  };

  const feeCovered = ledger.feesUsdt > 0
    ? ledger.realizedFundingUsdt / ledger.feesUsdt
    : null;
  const realizedPositive = ledger.realizedNetPnlUsdt > 0;

  const edgeEvidence = {
    feeCoveredRatio: feeCovered,
    feesCoveredByFunding: ledger.realizedFundingUsdt - ledger.feesUsdt > 0,
    realizedEconomicPositive: realizedPositive,
    minSettlesOk: settles >= 10,
    sampleOk: settles >= 10 && realizedPositive,
    status: settles < 10
      ? 'INSUFFICIENT_SAMPLE'
      : !realizedPositive
        ? 'ECONOMIC_LOSS'
        : 'CANDIDATE_ONLY',
  };

  const productionReadiness = {
    liveOff: true,
    paper,
    go: false,
    realOrders: false,
    status: 'NOT_READY',
    reason: 'LIVE_OFF frozen. Paper funding is not production readiness.',
  };

  let verdict = 'NO_EDGE_EVIDENCE';
  if (!paper || !liveOff) verdict = 'INVALID_STATE';
  else if (edgeEvidence.status === 'INSUFFICIENT_SAMPLE') verdict = 'INSUFFICIENT_SAMPLE';
  else if (edgeEvidence.status === 'ECONOMIC_LOSS') verdict = 'ECONOMIC_LOSS';
  else verdict = 'PAPER_CANDIDATE_NOT_GO';

  return {
    paperPerformance,
    edgeEvidence,
    productionReadiness,
    verdict,
    liveOff: true,
    go: false,
  };
}
