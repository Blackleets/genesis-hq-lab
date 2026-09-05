// fundingScorecard.mjs — honest separation of PAPER vs EDGE vs PRODUCTION.
// Never invents fills. Never flips LIVE_OFF. Never claims GO.

export const LIVE_OFF = true;

export function buildFundingScorecard(state = {}) {
  const paper = state.paper === true;
  const liveOff = state.liveOff !== false;
  const cobrado = Number(state.realizedFundingUsdt) || 0;
  const fees = Number(state.feesUsdt) || 0;
  const mtm = Number(state.mtmUsdt) || 0;
  const settles = Number(state.settledCount) || 0;
  const holds = Array.isArray(state.holds) ? state.holds.length : 0;
  const netAfterFees = cobrado - fees;
  const feeCovered = fees > 0 ? cobrado / fees : null;

  const paperPerformance = {
    cobradoUsdt: cobrado,
    feesUsdt: fees,
    netAfterFeesUsdt: netAfterFees,
    mtmUsdt: mtm,
    settledCount: settles,
    openHolds: holds,
    note: 'MTM is not cobrado. Only realizedFundingUsdt is collected.',
  };

  const edgeEvidence = {
    feeCoveredRatio: feeCovered,
    feesCovered: netAfterFees > 0,
    minSettlesOk: settles >= 10,
    sampleOk: settles >= 10 && netAfterFees > 0,
    status: settles < 10
      ? 'INSUFFICIENT_SAMPLE'
      : netAfterFees <= 0
        ? 'FEES_DOMINATE'
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
  else if (edgeEvidence.status === 'FEES_DOMINATE') verdict = 'FEES_DOMINATE';
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
