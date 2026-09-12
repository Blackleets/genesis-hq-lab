import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateMevShadowBatch } from '../genesis/mevShadowEngine.mjs';

function candidate(overrides = {}) {
  return {
    tokenIn: 'USDC', tokenOut: 'WETH', amountIn: 1000,
    buyDex: 'DEX_A', sellDex: 'DEX_B', routeId: 'route-1',
    buyAmountOut: 0.5, sellAmountOut: 1025,
    gasCostUsd: 3, lpFeesUsd: 3, slippageCostUsd: 1,
    flashLoanCostUsd: 0, otherCostsUsd: 0,
    chainId: 1, blockNumber: 22_000_001,
    quoteAgeMs: 100, blockLag: 0,
    inclusionProbability: 0.95, liquidityConfidence: 0.95,
    simulationSuccess: true, atomic: true,
    ...overrides,
  };
}

test('batch evaluation produces ranked shadow candidates without persistence by default', () => {
  const result = evaluateMevShadowBatch([
    candidate(),
    candidate({ routeId: 'bad', sellDex: 'DEX_C', sellAmountOut: 1003 }),
  ]);

  assert.equal(result.mode, 'SHADOW');
  assert.equal(result.executionAuthority, false);
  assert.equal(result.persistence.length, 0);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.summary.evaluated, 2);
});
