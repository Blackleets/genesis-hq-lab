import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUnits } from 'viem';

import { scanMevOnchainRadarOnce, getMevRadarConfig } from '../genesis/mevOnchainRadar.mjs';
import { VENUE_CODES } from '../genesis/mevAtomicSimulator.mjs';

function adapter(id, venueCode, fee, usdOut) {
  return {
    id,
    async quote(_client, { tokenIn }) {
      if (tokenIn.symbol === 'USDC') {
        return {
          venue: id,
          venueCode,
          fee,
          amountOut: parseUnits('0.5', 18),
          quoteSource: 'test',
        };
      }
      return {
        venue: id,
        venueCode,
        fee,
        amountOut: parseUnits(String(usdOut), 6),
        quoteSource: 'test',
      };
    },
  };
}

test('successful atomic eth_call still cannot qualify without measured inclusion/liquidity evidence', async () => {
  const fakeClient = {
    getBlockNumber: async () => 22_222_222n,
    getGasPrice: async () => 10_000_000_000n,
  };

  const adapters = [
    adapter('uni500', VENUE_CODES.UNISWAP_V3, 500, 2010),
    adapter('sushi', VENUE_CODES.SUSHISWAP_V2, 0, 2020),
  ];

  const atomicSimulator = async ({ request, blockNumber }) => ({
    ok: true,
    atomic: true,
    simulationSuccess: true,
    executorAddress: '0x1111111111111111111111111111111111111111',
    blockNumber: blockNumber.toString(),
    finalAmountOut: request.sellVenue === VENUE_CODES.SUSHISWAP_V2
      ? 1_012_000_000n
      : 1_008_000_000n,
    gasUnits: 300_000n,
    proof: 'proof-test',
  });

  const result = await scanMevOnchainRadarOnce({
    client: fakeClient,
    config: {
      ...getMevRadarConfig({ GENESIS_MEV_RPC_URL: 'http://example.invalid' }),
      notionalUsd: 1000,
      slippageReserveBps: 10,
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
  });

  assert.equal(result.ok, true);
  assert.equal(result.atomicSimulatorConfigured, true);
  assert.equal(result.atomicSimulationsAttempted, 2);
  assert.equal(result.atomicSimulationsPassed, 2);
  assert.ok(result.observations.every((row) => row.atomic === true));
  assert.ok(result.observations.every((row) => row.simulationSuccess === true));
  assert.ok(result.observations.every((row) => row.evidence.exactAtomicSimulation === true));

  // Atomicity alone is not enough: competition/capture evidence is still unmeasured.
  assert.equal(result.evaluation.candidates.length, 0);
  assert.equal(result.evaluation.rejected.length, 2);
  assert.ok(result.evaluation.rejected.every((row) => row.blockers.includes('inclusionProbability')));
  assert.ok(result.evaluation.rejected.every((row) => row.blockers.includes('liquidityConfidence')));
});
