import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateAtomicDexArb,
  rankMevCandidates,
  MODE,
  EXECUTION_AUTHORITY,
  STRATEGY_CLASS,
} from '../genesis/mevArbitrageShadow.mjs';

test('profitable atomic DEX arb is candidate only after all costs', () => {
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
  assert.equal(r.netPnlUsd, 6);
  assert.equal(r.executionAuthority, false);
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
});

test('negative net after gas is NO_GO', () => {
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
  assert.equal(r.netPnlUsd, -2);
  assert.equal(r.verdict, 'NO_GO');
});

test('ranking uses net edge only', () => {
  const a = evaluateAtomicDexArb({
    tokenIn:'USDC', tokenOut:'WETH', amountIn:1000, buyDex:'A', sellDex:'B',
    buyAmountOut:0.5, sellAmountOut:1015, gasCostUsd:3, lpFeesUsd:3, slippageCostUsd:1, flashLoanCostUsd:0, otherCostsUsd:0,
  });
  const b = evaluateAtomicDexArb({
    tokenIn:'USDC', tokenOut:'WETH', amountIn:1000, buyDex:'C', sellDex:'D',
    buyAmountOut:0.5, sellAmountOut:1020, gasCostUsd:8, lpFeesUsd:4, slippageCostUsd:2, flashLoanCostUsd:0, otherCostsUsd:0,
  });
  const ranked = rankMevCandidates([b, a]);
  assert.ok(ranked[0].netEdgeBps >= ranked[1].netEdgeBps);
});

test('module is structurally benign shadow-only', () => {
  assert.equal(MODE, 'SHADOW');
  assert.equal(EXECUTION_AUTHORITY, false);
  assert.equal(STRATEGY_CLASS, 'BENIGN_DEX_ARBITRAGE');
});
