export const SMART_EXECUTION_VERSION = 'institutional_smart_execution_v1';

const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

export function scoreMaker(input = {}) {
  const spreadCaptureBps = finite(input.spreadCaptureBps);
  const fillProbability = finite(input.fillProbability);
  const makerFeeBps = finite(input.makerFeeBps);
  const adverseSelectionBps = finite(input.adverseSelectionBps);
  const inventoryRiskBps = finite(input.inventoryRiskBps);
  const evidenceQuality = finite(input.evidenceQuality);
  if ([spreadCaptureBps, fillProbability, makerFeeBps, adverseSelectionBps, inventoryRiskBps, evidenceQuality].some((x) => x == null)) {
    return { mode: 'MAKE', eligible: false, expectedNetBps: null, reason: 'MAKER_EVIDENCE_INCOMPLETE' };
  }
  const pFill = clamp01(fillProbability);
  const filledNetBps = spreadCaptureBps - makerFeeBps - adverseSelectionBps - inventoryRiskBps;
  const expectedNetBps = pFill * filledNetBps;
  return {
    mode: 'MAKE', eligible: evidenceQuality >= 0.60 && pFill > 0,
    expectedNetBps, filledNetBps, fillProbability: pFill, evidenceQuality,
    reason: evidenceQuality >= 0.60 && pFill > 0 ? 'MAKER_EVIDENCE_AVAILABLE' : 'MAKER_EVIDENCE_WEAK',
  };
}

export function scoreTaker(input = {}) {
  const alphaBps = finite(input.alphaBps);
  const takerFeeBps = finite(input.takerFeeBps);
  const slippageBps = finite(input.slippageBps);
  const latencyBps = finite(input.latencyBps);
  const adverseSelectionBps = finite(input.adverseSelectionBps ?? 0);
  const evidenceQuality = finite(input.evidenceQuality);
  if ([alphaBps, takerFeeBps, slippageBps, latencyBps, adverseSelectionBps, evidenceQuality].some((x) => x == null)) {
    return { mode: 'TAKE', eligible: false, expectedNetBps: null, reason: 'TAKER_EVIDENCE_INCOMPLETE' };
  }
  const expectedNetBps = alphaBps - takerFeeBps - slippageBps - latencyBps - adverseSelectionBps;
  return {
    mode: 'TAKE', eligible: evidenceQuality >= 0.60,
    expectedNetBps, evidenceQuality,
    reason: evidenceQuality >= 0.60 ? 'TAKER_EVIDENCE_AVAILABLE' : 'TAKER_EVIDENCE_WEAK',
  };
}

export function chooseExecutionMode(input = {}, options = {}) {
  const minExpectedNetBps = finite(options.minExpectedNetBps) ?? 0;
  const maker = scoreMaker(input.maker ?? {});
  const taker = scoreTaker(input.taker ?? {});
  const candidates = [maker, taker]
    .filter((row) => row.eligible && Number.isFinite(row.expectedNetBps))
    .sort((a, b) => b.expectedNetBps - a.expectedNetBps);
  const best = candidates[0] ?? null;
  const action = best && best.expectedNetBps > minExpectedNetBps ? best.mode : 'WAIT';
  return {
    version: SMART_EXECUTION_VERSION,
    action,
    expectedNetBps: action === 'WAIT' ? 0 : best.expectedNetBps,
    thresholdBps: minExpectedNetBps,
    maker,
    taker,
    reason: action === 'WAIT' ? 'NO_EXECUTION_MODE_CLEARS_NET_EDGE_AND_EVIDENCE_GATES' : `${action}_HAS_HIGHEST_QUALIFIED_EXPECTED_NET_EDGE`,
    mode: 'PAPER_ONLY',
    executionAuthority: false,
    liveLocked: true,
    signsTransactions: false,
    broadcastsTransactions: false,
  };
}
