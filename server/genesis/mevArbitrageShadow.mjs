// mevArbitrageShadow.mjs
// SHADOW-ONLY benign MEV / DEX arbitrage evaluator.
//
// Scope:
// - backrun-style / atomic DEX-to-DEX arbitrage research
// - no sandwiching
// - no victim transaction targeting
// - no mempool front-running
// - no private-key usage
// - no transaction submission
//
// This module evaluates already-observed quotes and refuses to call an edge
// positive until gas + LP fees + slippage + flash-loan cost (if any) are known.

export const MODE = 'SHADOW';
export const EXECUTION_AUTHORITY = false;
export const STRATEGY_CLASS = 'BENIGN_DEX_ARBITRAGE';

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
  capturedAt = new Date().toISOString(),
}) {
  const numeric = [amountIn, buyAmountOut, sellAmountOut];
  if (numeric.some((v) => !Number.isFinite(v) || v <= 0)) {
    return { executable: false, reason: 'invalid_quote', mode: MODE, executionAuthority: EXECUTION_AUTHORITY };
  }

  const knownCosts = [gasCostUsd, lpFeesUsd, slippageCostUsd, flashLoanCostUsd, otherCostsUsd]
    .every((v) => Number.isFinite(v) && v >= 0);

  const grossPnlUsd = sellAmountOut - amountIn;
  const totalCostsUsd = knownCosts
    ? gasCostUsd + lpFeesUsd + slippageCostUsd + flashLoanCostUsd + otherCostsUsd
    : null;
  const netPnlUsd = totalCostsUsd == null ? null : grossPnlUsd - totalCostsUsd;
  const grossEdgeBps = (grossPnlUsd / amountIn) * 10_000;
  const netEdgeBps = netPnlUsd == null ? null : (netPnlUsd / amountIn) * 10_000;

  return {
    executable: true,
    mode: MODE,
    executionAuthority: EXECUTION_AUTHORITY,
    strategyClass: STRATEGY_CLASS,
    tokenIn,
    tokenOut,
    buyDex,
    sellDex,
    capturedAt,
    amountIn,
    buyAmountOut,
    sellAmountOut,
    grossPnlUsd,
    grossEdgeBps,
    gasCostUsd: Number.isFinite(gasCostUsd) ? gasCostUsd : null,
    lpFeesUsd: Number.isFinite(lpFeesUsd) ? lpFeesUsd : null,
    slippageCostUsd: Number.isFinite(slippageCostUsd) ? slippageCostUsd : null,
    flashLoanCostUsd: Number.isFinite(flashLoanCostUsd) ? flashLoanCostUsd : null,
    otherCostsUsd: Number.isFinite(otherCostsUsd) ? otherCostsUsd : null,
    totalCostsUsd,
    netPnlUsd,
    netEdgeBps,
    verdict: knownCosts && netPnlUsd > 0 ? 'SHADOW_CANDIDATE' : 'NO_GO',
    prohibitedTactics: ['sandwich', 'victim_targeting', 'mempool_front_run'],
  };
}

export function rankMevCandidates(rows = []) {
  return rows
    .filter((r) => r?.executable)
    .sort((a, b) => (b.netEdgeBps ?? -Infinity) - (a.netEdgeBps ?? -Infinity));
}

if (process.argv[1]?.endsWith('mevArbitrageShadow.mjs')) {
  console.log(JSON.stringify({
    mode: MODE,
    executionAuthority: EXECUTION_AUTHORITY,
    strategyClass: STRATEGY_CLASS,
    note: 'Evaluator only. Feed it DEX quote snapshots; it never submits transactions.',
  }, null, 2));
}
