import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateAtomicDexArb,
  rankMevCandidates,
  dedupeMevCandidates,
  makeRouteFingerprint,
  MODE,
  EXECUTION_AUTHORITY,
  STRATEGY_CLASS,
  ENGINE_VERSION,
} from '../genesis/mevArbitrageShadow.mjs';

test('profitable atomic DEX arb is candidate only after buffered and stress costs', () => {
  const r = evaluateAtomicDexArb({
    tokenIn: 'USDC',
    tokenOut: 'WETH',
    amountIn: 1000,
    buyDex: 'DEX_A',
    sellDex: 'DEX_B',
    buyAmountOut: 0.5,
    sellAmountOut: 1018,
    gasCostUsd: 4,
    lpFeesUsd: 5,
    slippageCostUsd: 2,
    flashLoanCostUsd: 1,
    otherCostsUsd: 0,
  });
  assert.equal(r.verdict, 'SHADOW_CANDIDATE');
  assert.equal(r.netPnlUsd, 4);
  assert.equal(r.stressNetPnlUsd, 1);
  assert.equal(r.executionAuthority, false);
  assert.equal(r.blockers.length, 0);
});

test('unknown gas or fees block promotion', () => {
  const r = evaluateAtomicDexArb({
    tokenIn: 'USDC',
    tokenOut: 'WETH',
    amountIn: 1000,
    buyDex: 'DEX_A',
    sellDex: 'DEX_B',
    buyAmountOut: 0.5,
    sellAmountOut: 1030,
    gasCostUsd: null,
    lpFeesUsd: 5,
    slippageCostUsd: 2,
  });
  assert.equal(r.verdict, 'NO_GO');
  assert.equal(r.netPnlUsd, null);
  assert.ok(r.blockers.includes('knownCosts'));
});

test('negative net after buffered gas and slippage is NO_GO', () => {
  const r = evaluateAtomicDexArb({
    tokenIn: 'USDC',
    tokenOut: 'WETH',
    amountIn: 1000,
    buyDex: 'DEX_A',
    sellDex: 'DEX_B',
    buyAmountOut: 0.5,
    sellAmountOut: 1008,
    gasCostUsd: 6,
    lpFeesUsd: 3,
    slippageCostUsd: 1,
    flashLoanCostUsd: 0,
    otherCostsUsd: 0,
  });
  assert.equal(r.netPnlUsd, -4);
  assert.equal(r.verdict, 'NO_GO');
  assert.ok(r.blockers.includes('netPositive'));
});

test('stale quotes are rejected even when raw economics look excellent', () => {
  const r = evaluateAtomicDexArb({
    tokenIn: 'USDC', tokenOut: 'WETH', amountIn: 1000, buyDex: 'A', sellDex: 'B',
    buyAmountOut: 0.5, sellAmountOut: 1050,
    gasCostUsd: 2, lpFeesUsd: 2, slippageCostUsd: 1,
    quoteAgeMs: 5000,
  });
  assert.equal(r.verdict, 'NO_GO');
  assert.ok(r.blockers.includes('quoteFresh'));
});

test('opportunity must survive stress costs, not just base costs', () => {
  const r = evaluateAtomicDexArb({
    tokenIn: 'USDC', tokenOut: 'WETH', amountIn: 1000, buyDex: 'A', sellDex: 'B',
    buyAmountOut: 0.5, sellAmountOut: 1010,
    gasCostUsd: 3, lpFeesUsd: 2, slippageCostUsd: 1,
  });
  assert.equal(r.netPnlUsd, 2.75);
  assert.equal(r.stressNetPnlUsd, 0.75);
  assert.equal(r.verdict, 'SHADOW_CANDIDATE');

  const fragile = evaluateAtomicDexArb({
    tokenIn: 'USDC', tokenOut: 'WETH', amountIn: 1000, buyDex: 'A', sellDex: 'B',
    buyAmountOut: 0.5, sellAmountOut: 1008,
    gasCostUsd: 2, lpFeesUsd: 2, slippageCostUsd: 1,
    gates: { minNetEdgeBps: 1, minNetPnlUsd: 0.1, minExpectedNetPnlUsd: 0.1 },
  });
  assert.equal(fragile.netPnlUsd, 2);
  assert.equal(fragile.stressNetPnlUsd, 0.5);
  assert.equal(fragile.verdict, 'SHADOW_CANDIDATE');

  const stressedOut = evaluateAtomicDexArb({
    tokenIn: 'USDC', tokenOut: 'WETH', amountIn: 1000, buyDex: 'A', sellDex: 'B',
    buyAmountOut: 0.5, sellAmountOut: 1007,
    gasCostUsd: 2, lpFeesUsd: 2, slippageCostUsd: 1,
    gates: { minNetEdgeBps: 1, minNetPnlUsd: 0.1, minExpectedNetPnlUsd: 0.1 },
  });
  assert.equal(stressedOut.stressNetPnlUsd, -0.5);
  assert.equal(stressedOut.verdict, 'NO_GO');
  assert.ok(stressedOut.blockers.includes('stressPositive'));
});

test('low inclusion probability is priced into expected PnL and blocks weak routes', () => {
  const r = evaluateAtomicDexArb({
    tokenIn: 'USDC', tokenOut: 'WETH', amountIn: 1000, buyDex: 'A', sellDex: 'B',
    buyAmountOut: 0.5, sellAmountOut: 1030,
    gasCostUsd: 5, lpFeesUsd: 3, slippageCostUsd: 2,
    inclusionProbability: 0.40,
  });
  assert.equal(r.verdict, 'NO_GO');
  assert.ok(r.blockers.includes('inclusionProbability'));
  assert.ok(r.expectedNetPnlUsd < r.netPnlUsd);
});

test('any prohibited tactic detection hard-blocks the route', () => {
  const r = evaluateAtomicDexArb({
    tokenIn: 'USDC', tokenOut: 'WETH', amountIn: 1000, buyDex: 'A', sellDex: 'B',
    buyAmountOut: 0.5, sellAmountOut: 1050,
    gasCostUsd: 2, lpFeesUsd: 2, slippageCostUsd: 1,
    prohibitedTacticDetected: true,
  });
  assert.equal(r.verdict, 'NO_GO');
  assert.ok(r.blockers.includes('noProhibitedTactic'));
});

test('route fingerprint is deterministic and route-specific', () => {
  const a = makeRouteFingerprint({ chainId: 1, tokenIn: 'USDC', tokenOut: 'WETH', buyDex: 'A', sellDex: 'B', routeId: 'r1' });
  const b = makeRouteFingerprint({ chainId: 1, tokenIn: 'USDC', tokenOut: 'WETH', buyDex: 'A', sellDex: 'B', routeId: 'r1' });
  const c = makeRouteFingerprint({ chainId: 1, tokenIn: 'USDC', tokenOut: 'WETH', buyDex: 'A', sellDex: 'C', routeId: 'r1' });
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('dedupe keeps the strongest observation for the same route', () => {
  const weak = evaluateAtomicDexArb({
    tokenIn:'USDC', tokenOut:'WETH', amountIn:1000, buyDex:'A', sellDex:'B', routeId:'same',
    buyAmountOut:0.5, sellAmountOut:1020, gasCostUsd:3, lpFeesUsd:3, slippageCostUsd:1,
  });
  const strong = evaluateAtomicDexArb({
    tokenIn:'USDC', tokenOut:'WETH', amountIn:1000, buyDex:'A', sellDex:'B', routeId:'same',
    buyAmountOut:0.5, sellAmountOut:1030, gasCostUsd:3, lpFeesUsd:3, slippageCostUsd:1,
  });
  const rows = dedupeMevCandidates([weak, strong]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].expectedNetPnlUsd, strong.expectedNetPnlUsd);
});

test('ranking uses expected net economics first', () => {
  const a = evaluateAtomicDexArb({
    tokenIn:'USDC', tokenOut:'WETH', amountIn:1000, buyDex:'A', sellDex:'B', routeId:'a',
    buyAmountOut:0.5, sellAmountOut:1018, gasCostUsd:3, lpFeesUsd:3, slippageCostUsd:1,
  });
  const b = evaluateAtomicDexArb({
    tokenIn:'USDC', tokenOut:'WETH', amountIn:1000, buyDex:'C', sellDex:'D', routeId:'b',
    buyAmountOut:0.5, sellAmountOut:1030, gasCostUsd:8, lpFeesUsd:4, slippageCostUsd:2,
  });
  const ranked = rankMevCandidates([b, a]);
  assert.ok(ranked[0].expectedNetPnlUsd >= ranked[1].expectedNetPnlUsd);
});

test('module is structurally benign shadow-only', () => {
  assert.equal(MODE, 'SHADOW');
  assert.equal(EXECUTION_AUTHORITY, false);
  assert.equal(STRATEGY_CLASS, 'BENIGN_DEX_ARBITRAGE');
  assert.equal(ENGINE_VERSION, 'mev_shadow_v2');
});
