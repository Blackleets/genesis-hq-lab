// RESEARCH_ONLY maker microstructure evaluator.
// Inspired by public order-book market-making architecture, but deliberately
// more conservative: no "touch = fill" assumption, no execution authority,
// and no candidate unless queue, fill, costs, and adverse selection are known.

export const MAKER_SHADOW_MODE = 'RESEARCH_ONLY';
export const MAKER_EXECUTION_AUTHORITY = false;
export const MAKER_ENGINE_VERSION = 'maker_microstructure_shadow_v1';

export const DEFAULT_MAKER_GATES = Object.freeze({
  maxSourceAgeMs: 1_500,
  minQueueCoverage: 1.0,
  minEmpiricalFillProbability: 0.05,
  minExpectedNetPnlUsd: 0,
  minExpectedNetBps: 0,
});

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function nonNegative(value) {
  const n = finite(value);
  return n !== null && n >= 0 ? n : null;
}

function probability(value) {
  const n = finite(value);
  if (n === null || n < 0 || n > 1) return null;
  return n;
}

function round(value, digits = 8) {
  if (!Number.isFinite(value)) return value;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

// Conservative lower-bound queue coverage. We intentionally give zero credit
// to cancellations because a quote cannot assume cancelled liquidity was ahead
// of it. aggressiveFlowTowardQuoteUsd must be measured marketable flow that
// would have consumed liquidity on our side of the book.
export function estimateQueueCoverage({
  queueAheadUsd,
  orderSizeUsd,
  aggressiveFlowTowardQuoteUsd,
} = {}) {
  const ahead = nonNegative(queueAheadUsd);
  const size = nonNegative(orderSizeUsd);
  const flow = nonNegative(aggressiveFlowTowardQuoteUsd);
  if (ahead === null || size === null || size <= 0 || flow === null) return null;
  const required = ahead + size;
  return required > 0 ? flow / required : null;
}

export function evaluateMakerShadowCandidate(input = {}, gates = {}) {
  const policy = { ...DEFAULT_MAKER_GATES, ...gates };
  const side = String(input.side ?? '').toUpperCase();
  const notionalUsd = nonNegative(input.notionalUsd);
  const observedSpreadBps = nonNegative(input.observedSpreadBps);
  const empiricalSpreadCaptureBps = nonNegative(input.empiricalSpreadCaptureBps);
  const makerFeeBps = finite(input.makerFeeBps);
  const adverseSelectionBps = nonNegative(input.adverseSelectionBps);
  const inventoryRiskBps = nonNegative(input.inventoryRiskBps);
  const quoteAttemptCostUsd = nonNegative(input.quoteAttemptCostUsd);
  const failedAttemptCostUsd = nonNegative(input.failedAttemptCostUsd);
  const sourceAgeMs = nonNegative(input.sourceAgeMs);
  const empiricalFillProbability = probability(input.empiricalFillProbability);
  const queueCoverage = estimateQueueCoverage(input);

  const known = {
    side: side === 'BUY' || side === 'SELL',
    notional: notionalUsd !== null && notionalUsd > 0,
    observedSpread: observedSpreadBps !== null,
    empiricalSpreadCapture: empiricalSpreadCaptureBps !== null,
    makerFee: makerFeeBps !== null,
    adverseSelection: adverseSelectionBps !== null,
    inventoryRisk: inventoryRiskBps !== null,
    quoteAttemptCost: quoteAttemptCostUsd !== null,
    failedAttemptCost: failedAttemptCostUsd !== null,
    sourceAge: sourceAgeMs !== null,
    empiricalFillProbability: empiricalFillProbability !== null,
    queueCoverage: queueCoverage !== null,
  };

  const allInputsKnown = Object.values(known).every(Boolean);

  let perFillEdgeBps = null;
  let perFillPnlUsd = null;
  let expectedNetPnlUsd = null;
  let expectedNetBps = null;

  if (allInputsKnown) {
    perFillEdgeBps =
      empiricalSpreadCaptureBps
      - makerFeeBps
      - adverseSelectionBps
      - inventoryRiskBps;
    perFillPnlUsd = notionalUsd * (perFillEdgeBps / 10_000);
    expectedNetPnlUsd =
      empiricalFillProbability * perFillPnlUsd
      - quoteAttemptCostUsd
      - (1 - empiricalFillProbability) * failedAttemptCostUsd;
    expectedNetBps = (expectedNetPnlUsd / notionalUsd) * 10_000;
  }

  const gateResults = {
    inputsKnown: allInputsKnown,
    fresh: sourceAgeMs !== null && sourceAgeMs <= policy.maxSourceAgeMs,
    spreadObserved: observedSpreadBps !== null && observedSpreadBps > 0,
    queueCoverage:
      queueCoverage !== null && queueCoverage >= policy.minQueueCoverage,
    fillProbability:
      empiricalFillProbability !== null &&
      empiricalFillProbability >= policy.minEmpiricalFillProbability,
    perFillPositive: perFillEdgeBps !== null && perFillEdgeBps > 0,
    expectedNetPositive:
      expectedNetPnlUsd !== null &&
      expectedNetPnlUsd > policy.minExpectedNetPnlUsd,
    expectedNetBps:
      expectedNetBps !== null &&
      expectedNetBps > policy.minExpectedNetBps,
  };

  const blockers = Object.entries(gateResults)
    .filter(([, pass]) => !pass)
    .map(([name]) => name);

  return {
    mode: MAKER_SHADOW_MODE,
    executionAuthority: MAKER_EXECUTION_AUTHORITY,
    engineVersion: MAKER_ENGINE_VERSION,
    side: known.side ? side : null,
    symbol: input.symbol ?? null,
    venue: input.venue ?? null,
    capturedAt: input.capturedAt ?? null,
    notionalUsd,
    observedSpreadBps,
    empiricalSpreadCaptureBps,
    makerFeeBps,
    adverseSelectionBps,
    inventoryRiskBps,
    quoteAttemptCostUsd,
    failedAttemptCostUsd,
    sourceAgeMs,
    queueAheadUsd: nonNegative(input.queueAheadUsd),
    orderSizeUsd: nonNegative(input.orderSizeUsd),
    aggressiveFlowTowardQuoteUsd: nonNegative(input.aggressiveFlowTowardQuoteUsd),
    queueCoverage: queueCoverage === null ? null : round(queueCoverage),
    empiricalFillProbability,
    perFillEdgeBps: perFillEdgeBps === null ? null : round(perFillEdgeBps),
    perFillPnlUsd: perFillPnlUsd === null ? null : round(perFillPnlUsd),
    expectedNetPnlUsd: expectedNetPnlUsd === null ? null : round(expectedNetPnlUsd),
    expectedNetBps: expectedNetBps === null ? null : round(expectedNetBps),
    knownInputs: known,
    gateResults,
    blockers,
    verdict: blockers.length === 0 ? 'SHADOW_CANDIDATE' : 'NO_GO',
    notes: [
      'Queue coverage is conservative and gives zero credit to cancellations.',
      'Empirical fill probability and adverse selection must come from measured forward research, not a model guess.',
      'This module cannot place, sign, amend, or cancel orders.',
    ],
  };
}
