import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUnits } from 'viem';

import {
  buildObservedOpportunity,
  getMevRadarConfig,
  orderedVenuePairs,
  quoteAtomicCycleCandidate,
  scanMevOnchainRadarOnce,
  RADAR_EXECUTION_AUTHORITY,
  RADAR_MODE,
} from '../genesis/mevOnchainRadar.mjs';

const USDC = { symbol: 'USDC', address: '0x0000000000000000000000000000000000000001', decimals: 6 };
const WETH = { symbol: 'WETH', address: '0x0000000000000000000000000000000000000002', decimals: 18 };

function fakeAdapter(id, { buyWeth = '0.5', ethUsd = '2000', cycleUsd = '1010' } = {}) {
  return {
    id,
    async quote(_client, { tokenIn, tokenOut }) {
      if (tokenIn.symbol === 'USDC' && tokenOut.symbol === 'WETH') {
        return { venue: id, amountOut: parseUnits(buyWeth, 18), quoteSource: 'test' };
      }
      if (tokenIn.symbol === 'WETH' && tokenOut.symbol === 'USDC') {
        const isReferenceEth = true;
        return {
          venue: id,
          amountOut: parseUnits(isReferenceEth ? ethUsd : cycleUsd, 6),
          quoteSource: 'test',
        };
      }
      throw new Error('unsupported_pair');
    },
  };
}

test('radar remains structurally SHADOW only', () => {
  assert.equal(RADAR_MODE, 'SHADOW');
  assert.equal(RADAR_EXECUTION_AUTHORITY, false);
});

test('provider config is explicit and never invents an RPC URL', () => {
  const cfg = getMevRadarConfig({});
  assert.equal(cfg.rpcUrl, null);
  assert.equal(cfg.providerConfigured, false);
  assert.equal(cfg.gasUnitsSource, 'conservative_default');
  assert.equal(cfg.slippageSource, 'conservative_default');
});

test('ordered venue pairs exclude self-arbitrage', () => {
  const adapters = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const pairs = orderedVenuePairs(adapters);
  assert.equal(pairs.length, 6);
  assert.ok(pairs.every(([a, b]) => a.id !== b.id));
});

test('cycle uses exact first-leg output as the second-leg input', async () => {
  let secondLegAmount = null;
  const buy = {
    id: 'buy',
    quote: async () => ({ venue: 'buy', amountOut: 500000000000000000n }),
  };
  const sell = {
    id: 'sell',
    quote: async (_client, { amountIn }) => {
      secondLegAmount = amountIn;
      return { venue: 'sell', amountOut: 1010000000n };
    },
  };

  const cycle = await quoteAtomicCycleCandidate({
    client: {},
    buyAdapter: buy,
    sellAdapter: sell,
    amountInRaw: 1000000000n,
    blockNumber: 123n,
    tokenIn: USDC,
    tokenMid: WETH,
  });

  assert.equal(secondLegAmount, 500000000000000000n);
  assert.equal(cycle.endRaw, 1010000000n);
});

test('observed same-block quote is not mislabeled as exact atomic simulation', () => {
  const opportunity = buildObservedOpportunity({
    cycle: {
      buyVenue: 'dex_a',
      sellVenue: 'dex_b',
      startRaw: 1000000000n,
      midRaw: 500000000000000000n,
      endRaw: 1010000000n,
    },
    blockNumber: 123n,
    capturedAt: '2026-09-12T00:00:00.000Z',
    quoteAgeMs: 20,
    gasPriceWei: 10000000000n,
    ethUsd: 2000,
    config: {
      routeGasUnits: 450000,
      slippageReserveBps: 10,
      flashLoanBps: 0,
      gasUnitsSource: 'conservative_default',
      slippageSource: 'conservative_default',
      fundingModel: 'prefunded_shadow',
    },
  });

  assert.equal(opportunity.atomic, false);
  assert.equal(opportunity.simulationSuccess, true);
  assert.equal(opportunity.evidence.exactAtomicSimulation, false);
  assert.equal(opportunity.chainId, 1);
  assert.equal(opportunity.blockNumber, '123');
});

test('missing provider fails closed without network access', async () => {
  const result = await scanMevOnchainRadarOnce({
    config: getMevRadarConfig({}),
    persist: false,
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'provider_not_configured');
  assert.equal(result.executionAuthority, false);
  assert.equal(result.routesScanned, 0);
});

test('injected real-block style scan evaluates observations but atomic gate keeps them filtered', async () => {
  const fakeClient = {
    getBlockNumber: async () => 123456n,
    getGasPrice: async () => 10000000000n,
  };

  const buy = {
    id: 'dex_a',
    async quote(_client, { tokenIn, amountIn }) {
      if (tokenIn.symbol === 'WETH') return { venue: 'dex_a', amountOut: 2000000000n };
      assert.equal(amountIn, 1000000000n);
      return { venue: 'dex_a', amountOut: 500000000000000000n };
    },
  };
  const sell = {
    id: 'dex_b',
    async quote(_client, { tokenIn }) {
      if (tokenIn.symbol === 'WETH') return { venue: 'dex_b', amountOut: 2015000000n };
      return { venue: 'dex_b', amountOut: 500000000000000000n };
    },
  };

  const result = await scanMevOnchainRadarOnce({
    client: fakeClient,
    config: {
      ...getMevRadarConfig({ GENESIS_MEV_RPC_URL: 'http://example.invalid' }),
      notionalUsd: 1000,
    },
    adapters: [buy, sell],
    persist: false,
  });

  assert.equal(result.ok, true);
  assert.equal(result.blockNumber, '123456');
  assert.equal(result.routesScanned, 2);
  assert.equal(result.routesQuoted, 2);
  assert.equal(result.evaluation.candidates.length, 0);
  assert.equal(result.evaluation.rejected.length, 2);
  assert.ok(result.evaluation.rejected.every((row) => row.blockers.includes('atomic')));
});
