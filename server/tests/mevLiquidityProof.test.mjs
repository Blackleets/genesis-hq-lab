import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUnits } from 'viem';

import {
  LIQUIDITY_PROOF_VERSION,
  applyLiquidityProof,
  getLiquidityProofConfig,
  scaleRawAmount,
  scoreLiquidityCurve,
} from '../genesis/mevLiquidityProof.mjs';
import { scanMevOnchainRadarOnce, getMevRadarConfig } from '../genesis/mevOnchainRadar.mjs';
import { VENUE_CODES } from '../genesis/mevAtomicSimulator.mjs';

test('liquidity proof policy is fixed and bounded', () => {
  const cfg = getLiquidityProofConfig({});
  assert.equal(cfg.probeMultiplier, 2);
  assert.equal(cfg.fullConfidenceImpactBps, 5);
  assert.equal(cfg.zeroConfidenceImpactBps, 50);
  assert.equal(scaleRawAmount(1_000_000_000n, 2), 2_000_000_000n);
});

test('flat same-block execution efficiency earns full liquidity confidence', () => {
  const m = scoreLiquidityCurve({
    baseAmountIn: 1000,
    baseAmountOut: 1010,
    probeAmountIn: 2000,
    probeAmountOut: 2020,
  });
  assert.equal(m.known, true);
  assert.equal(m.confidence, 1);
  assert.equal(m.adverseImpactBps, 0);
  assert.equal(m.version, LIQUIDITY_PROOF_VERSION);
});

test('confidence decays monotonically with adverse size impact', () => {
  const mild = scoreLiquidityCurve({
    baseAmountIn: 1000,
    baseAmountOut: 1010,
    probeAmountIn: 2000,
    probeAmountOut: 2016,
  });
  const severe = scoreLiquidityCurve({
    baseAmountIn: 1000,
    baseAmountOut: 1010,
    probeAmountIn: 2000,
    probeAmountOut: 1990,
  });
  assert.ok(mild.confidence > severe.confidence);
  assert.equal(severe.confidence, 0);
});

test('missing or non-larger probe fails closed', () => {
  const missing = scoreLiquidityCurve({ baseAmountIn: 1000, baseAmountOut: 1010 });
  const sameSize = scoreLiquidityCurve({
    baseAmountIn: 1000,
    baseAmountOut: 1010,
    probeAmountIn: 1000,
    probeAmountOut: 1010,
  });
  assert.equal(missing.known, false);
  assert.equal(missing.confidence, 0);
  assert.equal(sameSize.known, false);
});

test('applying proof records measured confidence without claiming capture', () => {
  const m = scoreLiquidityCurve({
    baseAmountIn: 1000,
    baseAmountOut: 1010,
    probeAmountIn: 2000,
    probeAmountOut: 2020,
  });
  const row = applyLiquidityProof({ evidence: {}, liquidityConfidence: 0 }, m);
  assert.equal(row.liquidityConfidence, 1);
  assert.equal(row.evidence.liquidityConfidenceModel, LIQUIDITY_PROOF_VERSION);
  assert.equal(row.evidence.liquidityProof.known, true);
});

function proportionalAdapter(id, venueCode, fee, rate) {
  return {
    id,
    async quote(_client, { tokenIn, amountIn }) {
      if (tokenIn.symbol === 'USDC') {
        // USDC raw has 6 decimals. Produce WETH raw at a proportional synthetic test rate.
        const usd = Number(amountIn) / 1e6;
        return {
          venue: id,
          venueCode,
          fee,
          amountOut: parseUnits(String((usd / 2000) * rate), 18),
        };
      }
      const weth = Number(amountIn) / 1e18;
      return {
        venue: id,
        venueCode,
        fee,
        amountOut: parseUnits(String(weth * 2020), 6),
      };
    },
  };
}

test('radar can close liquidity gate while inclusion remains independently closed', async () => {
  const fakeClient = {
    getBlockNumber: async () => 33_333_333n,
    getGasPrice: async () => 10_000_000_000n,
  };
  const adapters = [
    proportionalAdapter('uni500', VENUE_CODES.UNISWAP_V3, 500, 1),
    proportionalAdapter('sushi', VENUE_CODES.SUSHISWAP_V2, 0, 1),
  ];
  const atomicSimulator = async ({ request, blockNumber }) => ({
    ok: true,
    atomic: true,
    simulationSuccess: true,
    executorAddress: '0x1111111111111111111111111111111111111111',
    blockNumber: blockNumber.toString(),
    finalAmountOut: request.minFinalAmount + 5_000_000n,
    gasUnits: 300_000n,
    proof: 'liquidity-proof-test',
  });

  const result = await scanMevOnchainRadarOnce({
    client: fakeClient,
    config: {
      ...getMevRadarConfig({ GENESIS_MEV_RPC_URL: 'http://example.invalid' }),
      notionalUsd: 1000,
    },
    adapters,
    persist: false,
    atomicSimulatorConfig: {
      executorConfigured: true,
      executorAddress: '0x1111111111111111111111111111111111111111',
      simulationFrom: null,
      maxGasUnits: 1_200_000,
    },
    atomicSimulator,
    liquidityProofConfig: getLiquidityProofConfig({}),
  });

  assert.equal(result.liquidityProbesAttempted, 2);
  assert.equal(result.liquidityProbesPassed, 2);
  assert.ok(result.observations.every((row) => row.liquidityConfidence >= 0.7));
  assert.ok(result.evaluation.rejected.every((row) => !row.blockers.includes('liquidityConfidence')));
  assert.ok(result.evaluation.rejected.every((row) => row.blockers.includes('inclusionProbability')));
});
