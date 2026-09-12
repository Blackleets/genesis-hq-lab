// mevArbitrageShadow.mjs
// SHADOW-ONLY benign MEV / DEX arbitrage evaluator.
//
// Scope:
// - atomic DEX-to-DEX / pool-to-pool arbitrage research
// - backrun-style arbitrage that does NOT target a victim transaction
// - no sandwiching
// - no mempool front-running
// - no private-key usage
// - no transaction submission
//
// The evaluator is deliberately fail-closed. A visually attractive spread is
// NOT a candidate unless quotes are fresh, simulation is valid, every material
// cost is known, the buffered economics are positive, and the opportunity also
// survives a harsher stress-cost scenario.

import { createHash } from 'node:crypto';

export const MODE = 'SHADOW';
export const EXECUTION_AUTHORITY = false;
export const STRATEGY_CLASS = 'BENIGN_DEX_ARBITRAGE';
export const ENGINE_VERSION = 'mev_shadow_v2';

export const DEFAULT_GATES = Object.freeze({
  maxQuoteAgeMs: 1_500,
  maxBlockLag: 1,
  minNetEdgeBps: 5,
  minNetPnlUsd: 1,
  minExpectedNetPnlUsd: 0.5,
  minInclusionProbability: 0.70,
  gasSafetyMultiplier: 1.25,
  slippageSafetyMultiplier: 1.50,
  stressGasMultiplier: 1.75,
  stressSlippageMultiplier: 2.00,
});

const PROHIBITED_TACTICS = Object.freeze([
  'sandwich',
  'victim_targeting',
  'mempool_front_run',
]);

function finiteNonNegative(value) {
  return Number.isFinite(value) && value >= 0;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value)));
}

function round(value, digits = 8) {
  if (!Number.isFinite(value)) return value;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

export function makeRouteFingerprint({ chainId = 'unknown', tokenIn, tokenOut, buyDex, sellDex, routeId = '' }) {
  return createHash('sha256')
    .update([chainId, tokenIn, tokenOut, buyDex, sellDex, routeId].map((v) => String(v ?? '')).join('|'))
    .digest('hex')
    .slice(0, 24);
}

export function evaluateAtomicDexArb({
  tokenIn,
  tokenOut,
  amountIn,
  buyDex,
  sellDex,
  buyAmountOut,
  sellAmountOut,
  gasCostUsd,
  lpFeesUsd,
  slippageCostUsd,
  flashLoanCostUsd = 0,
  otherCostsUsd = 0,
  failureCostUsd = null,
  capturedAt = new Date().toISOString(),
  chainId = 'unknown',
  blockNumber = null,
  quoteAgeMs = 0,
  blockLag = 0,
  inclusionProbability = 1,
  liquidityConfidence = 1,
  simulationSuccess = true,
  atomic = true,
  prohibitedTacticDetected = false,
  routeId = '',
  gates = {},
}) {
  const policy = { ...DEFAULT_GATES, ...gates };
  const numeric = [amountIn, buyAmountOut, sellAmountOut];
  if (numeric.some((v) => !Number.isFinite(v) || v <= 0)) {
    return {
      executable: false,
      reason: 'invalid_quote',
      mode: MODE,
      executionAuthority: EXECUTION_AUTHORITY,
      engineVersion: ENGINE_VERSION,
    };
  }

  const knownCosts = [gasCostUsd, lpFeesUsd, slippageCostUsd, flashLoanCostUsd, otherCostsUsd]
    .every(finiteNonNegative);
  const inclusionP = clamp01(inclusionProbability);
  const liquidityP = clamp01(liquidityConfidence);
  const grossPnlUsd = sellAmountOut - amountIn;
  const grossEdgeBps = (grossPnlUsd / amountIn) * 10_000;

  const bufferedGasUsd = finiteNonNegative(gasCostUsd)
    ? gasCostUsd * policy.gasSafetyMultiplier
    : null;
  const bufferedSlippageUsd = finiteNonNegative(slippageCostUsd)
    ? slippageCostUsd * policy.slippageSafetyMultiplier
    : null;

  const totalCostsUsd = knownCosts
    ? bufferedGasUsd + lpFeesUsd + bufferedSlippageUsd + flashLoanCostUsd + otherCostsUsd
    : null;
  const netPnlUsd = totalCostsUsd == null ? null : grossPnlUsd - totalCostsUsd;
  const netEdgeBps = netPnlUsd == null ? null : (netPnlUsd / amountIn) * 10_000;

  const stressCostsUsd = knownCosts
    ? gasCostUsd * policy.stressGasMultiplier
      + lpFeesUsd
      + slippageCostUsd * policy.stressSlippageMultiplier
      + flashLoanCostUsd
      + otherCostsUsd
    : null;
  const stressNetPnlUsd = stressCostsUsd == null ? null : grossPnlUsd - stressCostsUsd;
  const stressNetEdgeBps = stressNetPnlUsd == null ? null : (stressNetPnlUsd / amountIn) * 10_000;

  // A reverted/failed public transaction can still burn gas. When the caller
  // does not provide a measured failure-cost estimate, use raw gas as a
  // conservative default rather than pretending failed attempts are free.
  const failedAttemptCostUsd = finiteNonNegative(failureCostUsd)
    ? failureCostUsd
    : (finiteNonNegative(gasCostUsd) ? gasCostUsd : null);
  const expectedNetPnlUsd = netPnlUsd == null || failedAttemptCostUsd == null
    ? null
    : (netPnlUsd * inclusionP) - (failedAttemptCostUsd * (1 - inclusionP));

  const gateResults = {
    knownCosts,
    atomic: atomic === true,
    simulationSuccess: simulationSuccess === true,
    noProhibitedTactic: prohibitedTacticDetected !== true,
    quoteFresh: Number.isFinite(quoteAgeMs) && quoteAgeMs >= 0 && quoteAgeMs <= policy.maxQuoteAgeMs,
    blockFresh: Number.isFinite(blockLag) && blockLag >= 0 && blockLag <= policy.maxBlockLag,
    grossPositive: grossPnlUsd > 0,
    netPositive: netPnlUsd != null && netPnlUsd > 0,
    minNetEdge: netEdgeBps != null && netEdgeBps >= policy.minNetEdgeBps,
    minNetPnl: netPnlUsd != null && netPnlUsd >= policy.minNetPnlUsd,
    stressPositive: stressNetPnlUsd != null && stressNetPnlUsd > 0,
    inclusionProbability: inclusionP >= policy.minInclusionProbability,
    expectedNetPositive: expectedNetPnlUsd != null && expectedNetPnlUsd >= policy.minExpectedNetPnlUsd,
  };
  const blockers = Object.entries(gateResults)
    .filter(([, pass]) => !pass)
    .map(([name]) => name);

  // Internal research score only. It is NOT a probability of profit and must
  // never be presented as one. Higher means safer/more robust evidence.
  const freshnessScore = gateResults.quoteFresh
    ? Math.max(0, 1 - (quoteAgeMs / Math.max(1, policy.maxQuoteAgeMs)))
    : 0;
  const edgeCushion = netEdgeBps == null
    ? 0
    : Math.max(0, Math.min(1, netEdgeBps / Math.max(1, policy.minNetEdgeBps * 4)));
  const stressScore = stressNetPnlUsd == null
    ? 0
    : Math.max(0, Math.min(1, stressNetPnlUsd / Math.max(1, policy.minNetPnlUsd * 4)));
  const robustnessScore = Math.round(100 * (
    freshnessScore * 0.20
    + edgeCushion * 0.25
    + stressScore * 0.25
    + inclusionP * 0.20
    + liquidityP * 0.10
  ));

  const routeFingerprint = makeRouteFingerprint({
    chainId,
    tokenIn,
    tokenOut,
    buyDex,
    sellDex,
    routeId,
  });

  return {
    executable: true,
    mode: MODE,
    executionAuthority: EXECUTION_AUTHORITY,
    strategyClass: STRATEGY_CLASS,
    engineVersion: ENGINE_VERSION,
    routeFingerprint,
    chainId,
    blockNumber,
    tokenIn,
    tokenOut,
    buyDex,
    sellDex,
    routeId: routeId || null,
    capturedAt,
    quoteAgeMs,
    blockLag,
    amountIn,
    buyAmountOut,
    sellAmountOut,
    grossPnlUsd: round(grossPnlUsd),
    grossEdgeBps: round(grossEdgeBps),
    gasCostUsd: finiteNonNegative(gasCostUsd) ? gasCostUsd : null,
    lpFeesUsd: finiteNonNegative(lpFeesUsd) ? lpFeesUsd : null,
    slippageCostUsd: finiteNonNegative(slippageCostUsd) ? slippageCostUsd : null,
    flashLoanCostUsd: finiteNonNegative(flashLoanCostUsd) ? flashLoanCostUsd : null,
    otherCostsUsd: finiteNonNegative(otherCostsUsd) ? otherCostsUsd : null,
    bufferedGasUsd: bufferedGasUsd == null ? null : round(bufferedGasUsd),
    bufferedSlippageUsd: bufferedSlippageUsd == null ? null : round(bufferedSlippageUsd),
    totalCostsUsd: totalCostsUsd == null ? null : round(totalCostsUsd),
    netPnlUsd: netPnlUsd == null ? null : round(netPnlUsd),
    netEdgeBps: netEdgeBps == null ? null : round(netEdgeBps),
    stressCostsUsd: stressCostsUsd == null ? null : round(stressCostsUsd),
    stressNetPnlUsd: stressNetPnlUsd == null ? null : round(stressNetPnlUsd),
    stressNetEdgeBps: stressNetEdgeBps == null ? null : round(stressNetEdgeBps),
    inclusionProbability: inclusionP,
    liquidityConfidence: liquidityP,
    failedAttemptCostUsd,
    expectedNetPnlUsd: expectedNetPnlUsd == null ? null : round(expectedNetPnlUsd),
    robustnessScore,
    gateResults,
    blockers,
    verdict: blockers.length === 0 ? 'SHADOW_CANDIDATE' : 'NO_GO',
    prohibitedTactics: PROHIBITED_TACTICS,
  };
}

export function dedupeMevCandidates(rows = []) {
  const best = new Map();
  for (const row of rows) {
    if (!row?.executable || !row.routeFingerprint) continue;
    const previous = best.get(row.routeFingerprint);
    const rowScore = row.expectedNetPnlUsd ?? -Infinity;
    const previousScore = previous?.expectedNetPnlUsd ?? -Infinity;
    if (!previous || rowScore > previousScore) best.set(row.routeFingerprint, row);
  }
  return [...best.values()];
}

export function rankMevCandidates(rows = []) {
  return dedupeMevCandidates(rows)
    .sort((a, b) => {
      const expected = (b.expectedNetPnlUsd ?? -Infinity) - (a.expectedNetPnlUsd ?? -Infinity);
      if (expected !== 0) return expected;
      const stress = (b.stressNetPnlUsd ?? -Infinity) - (a.stressNetPnlUsd ?? -Infinity);
      if (stress !== 0) return stress;
      return (b.netEdgeBps ?? -Infinity) - (a.netEdgeBps ?? -Infinity);
    });
}

if (process.argv[1]?.endsWith('mevArbitrageShadow.mjs')) {
  console.log(JSON.stringify({
    mode: MODE,
    executionAuthority: EXECUTION_AUTHORITY,
    strategyClass: STRATEGY_CLASS,
    engineVersion: ENGINE_VERSION,
    gates: DEFAULT_GATES,
    note: 'Institutional evaluator only. It never signs or submits transactions.',
  }, null, 2));
}
