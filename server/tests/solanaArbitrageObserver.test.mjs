import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SOLANA_ARBITRAGE_MODE,
  SOLANA_EXECUTION_AUTHORITY,
  SOLANA_LIVE_LOCKED,
  SOL_MINT,
  USDC_MINT,
  buildSolanaArbitrageObservation,
  extractWritableAccountsFromJupiterInstructions,
  fetchJupiterSwapInstructions,
  getSolanaArbitrageConfig,
  normalizeWritableAccounts,
  observeSolanaArbitrageOnce,
} from '../genesis/solanaArbitrageObserver.mjs';
import { SolanaExecutionAdapter, measurePaperCapture } from '../genesis/solanaExecutionEngine.mjs';

function quote({ inputMint, outputMint, inAmount, outAmount, contextSlot = 100, label = 'Raydium', feeAmount = '0', feeMint = inputMint }) {
  return {
    inputMint,
    outputMint,
    inAmount: String(inAmount),
    outAmount: String(outAmount),
    otherAmountThreshold: String(outAmount),
    contextSlot,
    routePlan: [{
      percent: 100,
      swapInfo: {
        label,
        feeAmount: String(feeAmount),
        feeMint,
      },
    }],
  };
}

const config = {
  ...getSolanaArbitrageConfig({}),
  notionalUsdc: 25,
  slippageBpsPerLeg: 10,
  computeUnitLimit: 1_000_000,
  baseFeeLamports: 5_000,
  maxSlotDrift: 4,
};

test('Solana observer is structurally read-only and LIVE locked', () => {
  assert.equal(SOLANA_ARBITRAGE_MODE, 'SHADOW');
  assert.equal(SOLANA_EXECUTION_AUTHORITY, false);
  assert.equal(SOLANA_LIVE_LOCKED, true);
});

test('normalizes and deduplicates writable route accounts', () => {
  const account = '11111111111111111111111111111111';
  assert.deepEqual(normalizeWritableAccounts([account, account, '', 'not-base58']), [account]);
});

test('extracts only writable accounts from every Jupiter instruction group', () => {
  const writable = '11111111111111111111111111111111';
  const readonly = 'So11111111111111111111111111111111111111112';
  const body = {
    setupInstructions: [{ accounts: [{ pubkey: writable, isWritable: true }, { pubkey: readonly, isWritable: false }] }],
    swapInstruction: { accounts: [{ pubkey: writable, isWritable: true }] },
    cleanupInstruction: null,
  };
  assert.deepEqual(extractWritableAccountsFromJupiterInstructions(body), [writable]);
});

test('Jupiter instruction request uses a public observer identity and never asks for signing', async () => {
  const calls = [];
  const localConfig = {
    ...config,
    observerPublicKey: '11111111111111111111111111111111',
    jupiterSwapInstructionsUrl: 'https://example.test/swap/v1/swap-instructions',
  };
  const result = await fetchJupiterSwapInstructions({
    quote: quote({ inputMint: USDC_MINT, outputMint: SOL_MINT, inAmount: 25_000_000, outAmount: 125_000_000 }),
    config: localConfig,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ swapInstruction: { accounts: [] } }), { status: 200 });
    },
  });
  const payload = JSON.parse(calls[0].options.body);
  assert.ok(result.swapInstruction);
  assert.equal(payload.userPublicKey, localConfig.observerPublicKey);
  assert.equal(payload.wrapAndUnwrapSol, false);
  assert.equal(payload.skipUserAccountsRpcCalls, true);
  assert.equal(JSON.stringify(payload).includes('privateKey'), false);
});

test('builds net economics after slippage, network fees, Jito tip and failure reserve', () => {
  const firstLeg = {
    latencyMs: 20,
    quote: quote({
      inputMint: USDC_MINT,
      outputMint: SOL_MINT,
      inAmount: 25_000_000,
      outAmount: 125_000_000,
      contextSlot: 100,
      label: 'Raydium CLMM',
      feeAmount: 5_000,
      feeMint: USDC_MINT,
    }),
  };
  const secondLeg = {
    latencyMs: 25,
    quote: quote({
      inputMint: SOL_MINT,
      outputMint: USDC_MINT,
      inAmount: 125_000_000,
      outAmount: 25_250_000,
      contextSlot: 102,
      label: 'Orca Whirlpool',
      feeAmount: 20_000,
      feeMint: SOL_MINT,
    }),
  };

  const observation = buildSolanaArbitrageObservation({
    firstLeg,
    secondLeg,
    priorityFeeEvidence: { priorityFeeLamports: 20_000, localized: true },
    jitoTipEvidence: { tipLamports: 10_000 },
    config,
    observedAt: '2026-09-14T07:00:00.000Z',
  });

  assert.equal(observation.chain, 'SOLANA');
  assert.deepEqual(observation.venues.firstLeg, ['Raydium CLMM']);
  assert.deepEqual(observation.venues.secondLeg, ['Orca Whirlpool']);
  assert.equal(observation.slotDrift, 2);
  assert.equal(observation.economics.criticalCostsKnown, true);
  assert.ok(observation.economics.quotedRoundTripProfitUsd > 0);
  assert.ok(Number.isFinite(observation.economics.netPnlUsd));
  assert.ok(observation.economics.netPnlUsd < observation.economics.quotedRoundTripProfitUsd);
  assert.ok(observation.blockers.includes('atomic_simulation_missing'));
  assert.ok(observation.blockers.includes('capture_evidence_missing'));
  assert.equal(observation.status, 'BLOCKED');
});

test('missing critical cost evidence leaves net PnL unknown and blocked', () => {
  const firstLeg = {
    latencyMs: 1,
    quote: quote({ inputMint: USDC_MINT, outputMint: SOL_MINT, inAmount: 25_000_000, outAmount: 125_000_000 }),
  };
  const secondLeg = {
    latencyMs: 1,
    quote: quote({ inputMint: SOL_MINT, outputMint: USDC_MINT, inAmount: 125_000_000, outAmount: 25_500_000 }),
  };

  const observation = buildSolanaArbitrageObservation({
    firstLeg,
    secondLeg,
    priorityFeeEvidence: { priorityFeeLamports: 10_000, localized: true },
    jitoTipEvidence: null,
    config,
  });

  assert.equal(observation.economics.netPnlUsd, null);
  assert.equal(observation.economics.netEdgeBps, null);
  assert.equal(observation.economics.criticalCostsKnown, false);
  assert.ok(observation.blockers.includes('critical_cost_unknown'));
});

test('live observer uses exact first-leg output as second-leg input and never submits transactions', async () => {
  const seen = [];
  const fakeFetch = async (url, options = {}) => {
    const value = String(url);
    seen.push({ url: value, options });

    if (value.includes('/swap/v1/quote')) {
      const parsed = new URL(value);
      const inputMint = parsed.searchParams.get('inputMint');
      const amount = parsed.searchParams.get('amount');
      if (inputMint === USDC_MINT) {
        return new Response(JSON.stringify(quote({
          inputMint: USDC_MINT,
          outputMint: SOL_MINT,
          inAmount: amount,
          outAmount: 125_000_000,
          contextSlot: 500,
          label: 'Meteora DLMM',
          feeAmount: 5_000,
          feeMint: USDC_MINT,
        })), { status: 200 });
      }
      assert.equal(inputMint, SOL_MINT);
      assert.equal(amount, '125000000');
      return new Response(JSON.stringify(quote({
        inputMint: SOL_MINT,
        outputMint: USDC_MINT,
        inAmount: amount,
        outAmount: 25_300_000,
        contextSlot: 501,
        label: 'Orca Whirlpool',
        feeAmount: 10_000,
        feeMint: SOL_MINT,
      })), { status: 200 });
    }

    if (options.method === 'POST' && options.body) {
      const body = JSON.parse(options.body);
      assert.equal(body.method, 'getRecentPrioritizationFees');
      assert.deepEqual(body.params, [['11111111111111111111111111111111']]);
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        result: [
          { slot: 1, prioritizationFee: 10 },
          { slot: 2, prioritizationFee: 20 },
          { slot: 3, prioritizationFee: 30 },
          { slot: 4, prioritizationFee: 40 },
        ],
        id: 1,
      }), { status: 200 });
    }

    if (value.includes('tip_floor')) {
      return new Response(JSON.stringify([{
        time: '2026-09-14T07:00:00Z',
        landed_tips_50th_percentile: 0.00001,
        ema_landed_tips_50th_percentile: 0.000012,
      }]), { status: 200 });
    }

    throw new Error(`unexpected_url:${value}`);
  };

  const result = await observeSolanaArbitrageOnce({
    config: {
      ...config,
      jupiterQuoteUrl: 'https://example.test/swap/v1/quote',
      solanaRpcUrl: 'https://rpc.example.test',
      jitoTipFloorUrl: 'https://example.test/tip_floor',
    },
    fetchImpl: fakeFetch,
    now: () => new Date('2026-09-14T07:00:00Z'),
    writableAccountResolver: async () => ['11111111111111111111111111111111'],
  });

  assert.equal(result.ok, true);
  assert.equal(result.executionAuthority, false);
  assert.equal(result.liveLocked, true);
  assert.equal(result.observation.chain, 'SOLANA');
  assert.deepEqual(result.observation.venues.firstLeg, ['Meteora DLMM']);
  assert.deepEqual(result.observation.venues.secondLeg, ['Orca Whirlpool']);
  assert.ok(result.observation.economics.netPnlUsd !== null);
  assert.equal(seen.some((request) => new URL(String(request.url)).pathname === '/swap/v1/swap'), false);
  assert.equal(seen.some((request) => String(request.url).includes('sendTransaction')), false);
  assert.equal(seen.some((request) => String(request.url).includes('sendBundle')), false);
  assert.ok(result.events.some((event) => event.type === 'OPPORTUNITY_DETECTED'));
  assert.ok(result.events.some((event) => event.type === 'REJECTED' && event.reason === 'simulation_adapter_not_configured'));
  assert.equal(new Set(result.events.map((event) => event.eventId)).size, result.events.length);

  const paperResult = await observeSolanaArbitrageOnce({
    config: { ...config, executionMode: 'PAPER', riskPolicy: { ...config.riskPolicy, minNetEdgeBps: 1 } },
    fetchImpl: fakeFetch,
    now: () => new Date('2026-09-14T07:00:00Z'),
    writableAccountResolver: async () => ['11111111111111111111111111111111'],
    transactionBuilder: async ({ observation }) => ({ transaction: { route: observation.route }, minOut: observation.quotedEndUsdc }),
    transactionSimulator: async () => ({ success: true, balancesVerified: true, minOutVerified: true, unitsConsumed: 500_000 }),
    executionAdapter: new SolanaExecutionAdapter({ mode: 'PAPER', paperCapture: async ({ opportunity }) => measurePaperCapture({ opportunity, capturedOutputUsd: 25.2, actualFeesUsd: 0.01, measuredAt: '2026-09-14T07:00:01Z' }) }),
  });
  assert.equal(paperResult.status, 'PAPER_EXECUTED');
  assert.ok(paperResult.events.some((event) => event.type === 'SIMULATION_PASSED'));
  assert.ok(paperResult.events.some((event) => event.type === 'PAPER_EXECUTED'));
  const captureEvent = paperResult.events.find((event) => event.type === 'CAPTURE_MEASURED');
  assert.ok(captureEvent); assert.ok(captureEvent.expectedNetPnlUsd > 0); assert.ok(captureEvent.capturedNetPnlUsd > 0);
});

test('global priority fee remains visible but blocks promotion when route accounts are unavailable', async () => {
  const firstLeg = { latencyMs: 1, quote: quote({ inputMint: USDC_MINT, outputMint: SOL_MINT, inAmount: 25_000_000, outAmount: 125_000_000 }) };
  const secondLeg = { latencyMs: 1, quote: quote({ inputMint: SOL_MINT, outputMint: USDC_MINT, inAmount: 125_000_000, outAmount: 25_500_000 }) };
  const observation = buildSolanaArbitrageObservation({
    firstLeg,
    secondLeg,
    priorityFeeEvidence: { priorityFeeLamports: 10_000, localized: false },
    jitoTipEvidence: { tipLamports: 1_000 },
    config,
  });
  assert.ok(observation.blockers.includes('priority_fee_not_localized'));
});

test('provider failures terminate in a normalized FAILED event', async () => {
  const result = await observeSolanaArbitrageOnce({
    config: { ...config, jupiterQuoteUrl: 'https://example.test/swap/v1/quote' },
    fetchImpl: async () => new Response('offline', { status: 503 }),
    now: () => new Date('2026-09-14T08:00:00Z'),
  });
  assert.equal(result.ok, false);
  assert.equal(result.events.at(-1)?.type, 'FAILED');
  assert.equal(result.events.at(-1)?.decision, 'REJECTED');
});
