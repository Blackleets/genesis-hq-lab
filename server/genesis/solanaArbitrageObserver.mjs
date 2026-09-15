import { pathToFileURL } from 'node:url';
import { createSolanaEvent } from './solanaEventModel.mjs';
import { getSolanaRiskPolicy, SolanaExecutionAdapter } from './solanaExecutionEngine.mjs';

export const SOLANA_ARBITRAGE_MODE = 'SHADOW';
export const SOLANA_EXECUTION_AUTHORITY = false;
export const SOLANA_LIVE_LOCKED = true;
export const SOLANA_INFRA_POLICY = Object.freeze({ tier: 'FREE_ONLY', monthlyBudgetUsd: 0, autoUpgrade: false });

export const SOL_MINT = 'So11111111111111111111111111111111111111112';
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

const LAMPORTS_PER_SOL = 1_000_000_000;
const USDC_SCALE = 1_000_000;

function numberFromEnv(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getSolanaArbitrageConfig(env = process.env) {
  const apiKey = env.JUPITER_API_KEY || env.GENESIS_JUPITER_API_KEY || null;
  const jupiterQuoteUrl = env.GENESIS_SOLANA_JUPITER_QUOTE_URL
    || (apiKey ? 'https://api.jup.ag/swap/v1/quote' : 'https://lite-api.jup.ag/swap/v1/quote');
  return {
    jupiterApiKey: apiKey,
    jupiterQuoteUrl,
    jupiterSwapInstructionsUrl: env.GENESIS_SOLANA_JUPITER_SWAP_INSTRUCTIONS_URL
      || jupiterQuoteUrl.replace(/\/quote(?:\?.*)?$/, '/swap-instructions'),
    observerPublicKey: normalizeWritableAccounts([env.GENESIS_SOLANA_OBSERVER_PUBLIC_KEY])[0] ?? null,
    solanaRpcUrl: env.GENESIS_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    jitoTipFloorUrl: env.GENESIS_JITO_TIP_FLOOR_URL || 'https://bundles.jito.wtf/api/v1/bundles/tip_floor',
    notionalUsdc: Math.max(1, numberFromEnv(env.GENESIS_SOLANA_ARB_NOTIONAL_USDC, 25)),
    slippageBpsPerLeg: Math.max(0, numberFromEnv(env.GENESIS_SOLANA_ARB_SLIPPAGE_BPS, 10)),
    latencyDegradationBps: Math.max(0, numberFromEnv(env.GENESIS_SOLANA_LATENCY_DEGRADATION_BPS, 5)),
    adverseSelectionReserveBps: Math.max(0, numberFromEnv(env.GENESIS_SOLANA_ADVERSE_SELECTION_BPS, 5)),
    failureProbabilityReserve: Math.min(1, Math.max(0, numberFromEnv(env.GENESIS_SOLANA_FAILURE_PROBABILITY_RESERVE, 0.10))),
    computeUnitLimit: Math.max(1, Math.round(numberFromEnv(env.GENESIS_SOLANA_ARB_CU_LIMIT, 1_000_000))),
    baseFeeLamports: Math.max(0, Math.round(numberFromEnv(env.GENESIS_SOLANA_BASE_FEE_LAMPORTS, 5_000))),
    priorityFeePercentile: Math.min(1, Math.max(0, numberFromEnv(env.GENESIS_SOLANA_PRIORITY_FEE_PERCENTILE, 0.75))),
    maxSlotDrift: Math.max(0, Math.round(numberFromEnv(env.GENESIS_SOLANA_MAX_SLOT_DRIFT, 4))),
    requestTimeoutMs: Math.max(500, Math.round(numberFromEnv(env.GENESIS_SOLANA_REQUEST_TIMEOUT_MS, 5_000))),
    executionMode: String(env.GENESIS_SOLANA_EXECUTION_MODE || 'SHADOW').toUpperCase() === 'PAPER' ? 'PAPER' : 'SHADOW',
    infraPolicy: SOLANA_INFRA_POLICY,
    riskPolicy: getSolanaRiskPolicy(env),
  };
}

export function normalizeWritableAccounts(accounts) {
  if (!Array.isArray(accounts)) return [];
  return [...new Set(accounts
    .map((account) => String(account?.toBase58?.() ?? account ?? '').trim())
    .filter((account) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(account)))]
    .slice(0, 128);
}

function quantile(values, p) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return null;
  const index = Math.min(clean.length - 1, Math.max(0, Math.ceil(p * clean.length) - 1));
  return clean[index];
}

async function fetchJson(fetchImpl, url, options = {}, timeoutMs = 5_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`http_${response.status}${body ? `:${body.slice(0, 160)}` : ''}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJupiterQuote({
  inputMint,
  outputMint,
  amountRaw,
  config,
  fetchImpl = fetch,
}) {
  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount: String(amountRaw),
    slippageBps: String(config.slippageBpsPerLeg),
    restrictIntermediateTokens: 'true',
    instructionVersion: 'V2',
  });
  const headers = config.jupiterApiKey ? { 'x-api-key': config.jupiterApiKey } : {};
  const started = Date.now();
  const quote = await fetchJson(fetchImpl, `${config.jupiterQuoteUrl}?${params}`, { headers }, config.requestTimeoutMs);
  const latencyMs = Date.now() - started;

  if (!quote || !quote.outAmount || !quote.inAmount || !Array.isArray(quote.routePlan)) {
    throw new Error('invalid_jupiter_quote');
  }

  return { quote, latencyMs };
}

function instructionGroups(body) {
  return [
    ...(body?.computeBudgetInstructions ?? []),
    ...(body?.setupInstructions ?? []),
    body?.swapInstruction,
    body?.cleanupInstruction,
    ...(body?.otherInstructions ?? []),
  ].filter(Boolean);
}

export function extractWritableAccountsFromJupiterInstructions(body) {
  return normalizeWritableAccounts(instructionGroups(body)
    .flatMap((instruction) => instruction?.accounts ?? [])
    .filter((account) => account?.isWritable === true)
    .map((account) => account.pubkey));
}

export async function fetchJupiterSwapInstructions({ quote, config, fetchImpl = fetch }) {
  if (!config.observerPublicKey) throw new Error('observer_public_key_not_configured');
  const headers = { 'content-type': 'application/json' };
  if (config.jupiterApiKey) headers['x-api-key'] = config.jupiterApiKey;
  const body = await fetchJson(fetchImpl, config.jupiterSwapInstructionsUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      userPublicKey: config.observerPublicKey,
      quoteResponse: quote,
      wrapAndUnwrapSol: false,
      useSharedAccounts: true,
      dynamicComputeUnitLimit: false,
      skipUserAccountsRpcCalls: true,
    }),
  }, config.requestTimeoutMs);
  if (!body?.swapInstruction) throw new Error('invalid_jupiter_swap_instructions');
  return body;
}

export async function resolveJupiterWritableAccounts({ firstLeg, secondLeg, config, fetchImpl = fetch }) {
  const [first, second] = await Promise.all([
    fetchJupiterSwapInstructions({ quote: firstLeg.quote, config, fetchImpl }),
    fetchJupiterSwapInstructions({ quote: secondLeg.quote, config, fetchImpl }),
  ]);
  const writableAccounts = normalizeWritableAccounts([
    ...extractWritableAccountsFromJupiterInstructions(first),
    ...extractWritableAccountsFromJupiterInstructions(second),
  ]);
  if (!writableAccounts.length) throw new Error('jupiter_writable_accounts_missing');
  return { writableAccounts, source: 'jupiter_swap_instructions' };
}

export async function fetchPriorityFeeEvidence({ config, fetchImpl = fetch, writableAccounts = [] }) {
  const lockedWritableAccounts = normalizeWritableAccounts(writableAccounts);
  const payload = {
    jsonrpc: '2.0',
    id: 1,
    method: 'getRecentPrioritizationFees',
    params: [lockedWritableAccounts],
  };
  const body = await fetchJson(fetchImpl, config.solanaRpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  }, config.requestTimeoutMs);

  if (!Array.isArray(body?.result)) throw new Error('priority_fee_unavailable');
  const microLamportsPerCu = quantile(
    body.result.map((row) => Number(row?.prioritizationFee)),
    config.priorityFeePercentile,
  );
  if (!Number.isFinite(microLamportsPerCu)) throw new Error('priority_fee_unavailable');

  const priorityFeeLamports = Math.ceil((microLamportsPerCu * config.computeUnitLimit) / 1_000_000);
  return {
    source: 'solana_getRecentPrioritizationFees',
    localized: lockedWritableAccounts.length > 0,
    writableAccountCount: lockedWritableAccounts.length,
    percentile: config.priorityFeePercentile,
    microLamportsPerCu,
    computeUnitLimit: config.computeUnitLimit,
    priorityFeeLamports,
  };
}

export async function fetchJitoTipEvidence({ config, fetchImpl = fetch }) {
  const body = await fetchJson(fetchImpl, config.jitoTipFloorUrl, {}, config.requestTimeoutMs);
  const row = Array.isArray(body) ? body[0] : null;
  const tipSol = Number(row?.ema_landed_tips_50th_percentile ?? row?.landed_tips_50th_percentile);
  if (!Number.isFinite(tipSol) || tipSol < 0) throw new Error('jito_tip_unavailable');
  return {
    source: 'jito_tip_floor',
    tipSol,
    tipLamports: Math.ceil(tipSol * LAMPORTS_PER_SOL),
    observedAt: row?.time ?? null,
  };
}

export function extractVenueLabels(quote) {
  return [...new Set((quote?.routePlan ?? [])
    .map((step) => step?.swapInfo?.label)
    .filter(Boolean))];
}

export function extractDexFeeEvidence(quote) {
  return (quote?.routePlan ?? []).map((step) => ({
    label: step?.swapInfo?.label ?? 'unknown',
    feeAmount: step?.swapInfo?.feeAmount ?? null,
    feeMint: step?.swapInfo?.feeMint ?? null,
    bps: Number.isFinite(Number(step?.bps)) ? Number(step.bps) : null,
    percent: Number.isFinite(Number(step?.percent)) ? Number(step.percent) : null,
  }));
}

function feeEvidenceToUsd(entries, solUsd) {
  let usd = 0;
  const unknown = [];
  for (const fee of entries) {
    const raw = Number(fee.feeAmount);
    if (!Number.isFinite(raw) || raw < 0 || !fee.feeMint) {
      unknown.push(fee);
      continue;
    }
    if (fee.feeMint === USDC_MINT) usd += raw / USDC_SCALE;
    else if (fee.feeMint === SOL_MINT) usd += (raw / LAMPORTS_PER_SOL) * solUsd;
    else unknown.push(fee);
  }
  return { usd, fullyNormalized: unknown.length === 0, unknown };
}

function lamportsToUsd(lamports, solUsd) {
  if (!Number.isFinite(lamports) || !Number.isFinite(solUsd)) return null;
  return (lamports / LAMPORTS_PER_SOL) * solUsd;
}

export function buildSolanaArbitrageObservation({
  firstLeg,
  secondLeg,
  priorityFeeEvidence,
  jitoTipEvidence,
  config,
  observedAt = new Date().toISOString(),
}) {
  const startRaw = Number(firstLeg.quote.inAmount);
  const solOutRaw = Number(firstLeg.quote.outAmount);
  const endRaw = Number(secondLeg.quote.outAmount);
  if (![startRaw, solOutRaw, endRaw].every(Number.isFinite) || startRaw <= 0 || solOutRaw <= 0) {
    throw new Error('invalid_cycle_amounts');
  }

  const startUsdc = startRaw / USDC_SCALE;
  const solOut = solOutRaw / LAMPORTS_PER_SOL;
  const endUsdc = endRaw / USDC_SCALE;
  const solUsd = startUsdc / solOut;
  const quotedProfitUsd = endUsdc - startUsdc;
  const quotedEdgeBps = (quotedProfitUsd / startUsdc) * 10_000;
  const priceImpactBps = [firstLeg.quote.priceImpactPct, secondLeg.quote.priceImpactPct]
    .map(Number).filter(Number.isFinite).reduce((sum, value) => sum + (value * 100), 0);

  const feeEntries = [
    ...extractDexFeeEvidence(firstLeg.quote),
    ...extractDexFeeEvidence(secondLeg.quote),
  ];
  const feeNormalization = feeEvidenceToUsd(feeEntries, solUsd);
  const grossProfitBeforeDexFeesUsd = feeNormalization.fullyNormalized
    ? quotedProfitUsd + feeNormalization.usd
    : null;
  const grossEdgeBps = grossProfitBeforeDexFeesUsd == null
    ? null
    : (grossProfitBeforeDexFeesUsd / startUsdc) * 10_000;

  const slippageReserveBps = config.slippageBpsPerLeg * 2;
  const slippageReserveUsd = startUsdc * (slippageReserveBps / 10_000);
  const latencyDegradationUsd = startUsdc * (config.latencyDegradationBps / 10_000);
  const adverseSelectionReserveUsd = startUsdc * (config.adverseSelectionReserveBps / 10_000);
  const baseFeeUsd = lamportsToUsd(config.baseFeeLamports, solUsd);
  const priorityFeeUsd = lamportsToUsd(priorityFeeEvidence?.priorityFeeLamports, solUsd);
  const jitoTipUsd = lamportsToUsd(jitoTipEvidence?.tipLamports, solUsd);
  const failedAttemptReserveUsd = (baseFeeUsd != null && priorityFeeUsd != null && jitoTipUsd != null)
    ? (baseFeeUsd + priorityFeeUsd + jitoTipUsd) * config.failureProbabilityReserve
    : null;

  const criticalCostsKnown = [slippageReserveUsd, latencyDegradationUsd, adverseSelectionReserveUsd, baseFeeUsd, priorityFeeUsd, jitoTipUsd, failedAttemptReserveUsd]
    .every(Number.isFinite);
  const netPnlUsd = criticalCostsKnown
    ? quotedProfitUsd - slippageReserveUsd - latencyDegradationUsd - adverseSelectionReserveUsd - baseFeeUsd - priorityFeeUsd - jitoTipUsd - failedAttemptReserveUsd
    : null;
  const netEdgeBps = netPnlUsd == null ? null : (netPnlUsd / startUsdc) * 10_000;

  const firstSlot = Number(firstLeg.quote.contextSlot);
  const secondSlot = Number(secondLeg.quote.contextSlot);
  const slotDrift = Number.isFinite(firstSlot) && Number.isFinite(secondSlot)
    ? Math.abs(secondSlot - firstSlot)
    : null;

  const blockers = [];
  if (!criticalCostsKnown) blockers.push('critical_cost_unknown');
  if (priorityFeeEvidence?.localized !== true) blockers.push('priority_fee_not_localized');
  if (slotDrift == null) blockers.push('context_slot_unknown');
  else if (slotDrift > config.maxSlotDrift) blockers.push('slot_drift');
  if (netPnlUsd != null && netPnlUsd <= 0) blockers.push('net_not_positive');
  blockers.push('atomic_simulation_missing');
  blockers.push('capture_evidence_missing');

  return {
    chain: 'SOLANA',
    mode: config.executionMode ?? SOLANA_ARBITRAGE_MODE,
    executionAuthority: SOLANA_EXECUTION_AUTHORITY,
    liveLocked: SOLANA_LIVE_LOCKED,
    observedAt,
    route: `${USDC_MINT}->${SOL_MINT}->${USDC_MINT}`,
    inputMint: USDC_MINT,
    outputMint: USDC_MINT,
    inputUsdc: startUsdc,
    quotedEndUsdc: endUsdc,
    solOut,
    impliedSolUsd: solUsd,
    contextSlots: { first: Number.isFinite(firstSlot) ? firstSlot : null, second: Number.isFinite(secondSlot) ? secondSlot : null },
    slotDrift,
    quoteLatencyMs: firstLeg.latencyMs + secondLeg.latencyMs,
    venues: {
      firstLeg: extractVenueLabels(firstLeg.quote),
      secondLeg: extractVenueLabels(secondLeg.quote),
    },
    economics: {
      grossProfitBeforeDexFeesUsd,
      grossEdgeBps,
      dexFeesUsd: feeNormalization.fullyNormalized ? feeNormalization.usd : null,
      dexFeesEmbeddedInQuotedOutput: true,
      dexFeeEvidence: feeEntries,
      dexFeeFullyNormalized: feeNormalization.fullyNormalized,
      quotedRoundTripProfitUsd: quotedProfitUsd,
      quotedRoundTripEdgeBps: quotedEdgeBps,
      priceImpactBps,
      slippageReserveBps,
      slippageReserveUsd,
      latencyDegradationBps: config.latencyDegradationBps,
      latencyDegradationUsd,
      adverseSelectionReserveBps: config.adverseSelectionReserveBps,
      adverseSelectionReserveUsd,
      baseFeeUsd,
      priorityFeeUsd,
      jitoTipUsd,
      failedAttemptReserveUsd,
      netPnlUsd,
      netEdgeBps,
      criticalCostsKnown,
    },
    feeEvidence: {
      priority: priorityFeeEvidence ?? null,
      jito: jitoTipEvidence ?? null,
    },
    atomicSimulation: { attempted: false, success: false },
    captureEvidence: { measured: false },
    blockers,
    status: blockers.length ? 'BLOCKED' : 'QUALIFIED',
  };
}

export async function observeSolanaArbitrageOnce({
  config = getSolanaArbitrageConfig(),
  fetchImpl = fetch,
  now = () => new Date(),
  transactionBuilder = null,
  transactionSimulator = null,
  writableAccountResolver = null,
  executionAdapter = null,
  runtime = {},
} = {}) {
  const amountRaw = BigInt(Math.round(config.notionalUsdc * USDC_SCALE));
  const runId = now().toISOString();
  const events = [];
  const pushEvent = (type, payload = {}) => {
    const observedAt = now().toISOString();
    events.push(createSolanaEvent({ runId, type, sequence: events.length + 1, timestamp: observedAt, mode: config.executionMode, ...payload }));
  };

  pushEvent('SCAN_STARTED', {
    inputUsdc: config.notionalUsdc,
    route: 'USDC → SOL → USDC',
  });

  try {
    const firstLeg = await fetchJupiterQuote({
      inputMint: USDC_MINT,
      outputMint: SOL_MINT,
      amountRaw,
      config,
      fetchImpl,
    });

    pushEvent('QUOTE_RECEIVED', {
      leg: 'USDC_TO_SOL',
      inputUsdc: config.notionalUsdc,
      quoteLatencyMs: firstLeg.latencyMs,
      slot: Number(firstLeg.quote.contextSlot) || null,
      venues: extractVenueLabels(firstLeg.quote),
    });

    const secondLeg = await fetchJupiterQuote({
      inputMint: SOL_MINT,
      outputMint: USDC_MINT,
      amountRaw: BigInt(firstLeg.quote.outAmount),
      config,
      fetchImpl,
    });

    const firstVenues = extractVenueLabels(firstLeg.quote);
    const secondVenues = extractVenueLabels(secondLeg.quote);
    const route = `${firstVenues.join(' · ') || 'Jupiter'} → ${secondVenues.join(' · ') || 'Jupiter'}`;

    pushEvent('ROUTE_FOUND', {
      route,
      firstLegVenues: firstVenues,
      secondLegVenues: secondVenues,
      quoteLatencyMs: firstLeg.latencyMs + secondLeg.latencyMs,
      slot: Number(secondLeg.quote.contextSlot) || null,
    });

    const quotedStartUsdc = Number(firstLeg.quote.inAmount) / USDC_SCALE;
    const quotedEndUsdc = Number(secondLeg.quote.outAmount) / USDC_SCALE;
    const quotedProfitUsd = quotedEndUsdc - quotedStartUsdc;
    const quotedEdgeBps = quotedStartUsdc > 0 ? (quotedProfitUsd / quotedStartUsdc) * 10_000 : null;

    pushEvent('QUOTE_RECEIVED', {
      leg: 'SOL_TO_USDC',
      route,
      inputUsdc: quotedStartUsdc,
      quotedEndUsdc,
      quotedEdgeBps,
      quoteLatencyMs: secondLeg.latencyMs,
      slot: Number(secondLeg.quote.contextSlot) || null,
    });

    let writableAccounts = [];
    let writableAccountError = null;
    const accountResolver = typeof writableAccountResolver === 'function'
      ? writableAccountResolver
      : (config.observerPublicKey ? (input) => resolveJupiterWritableAccounts({ ...input, fetchImpl }) : null);
    if (accountResolver) {
      try {
        const resolved = await accountResolver({ firstLeg, secondLeg, config });
        writableAccounts = normalizeWritableAccounts(resolved?.writableAccounts ?? resolved);
      } catch (error) {
        writableAccountError = String(error?.message ?? error);
      }
    }

    const [priorityResult, jitoResult] = await Promise.allSettled([
      fetchPriorityFeeEvidence({ config, fetchImpl, writableAccounts }),
      fetchJitoTipEvidence({ config, fetchImpl }),
    ]);

    const observation = buildSolanaArbitrageObservation({
      firstLeg,
      secondLeg,
      priorityFeeEvidence: priorityResult.status === 'fulfilled' ? priorityResult.value : null,
      jitoTipEvidence: jitoResult.status === 'fulfilled' ? jitoResult.value : null,
      config,
      observedAt: now().toISOString(),
    });

    pushEvent('COSTS_CALCULATED', {
      route,
      inputUsdc: observation.inputUsdc,
      quotedOutputUsd: observation.quotedEndUsdc,
      grossEdgeBps: observation.economics.grossEdgeBps,
      quotedEdgeBps: observation.economics.quotedRoundTripEdgeBps,
      totalCostBps: observation.economics.grossEdgeBps == null || observation.economics.netEdgeBps == null
        ? null
        : observation.economics.grossEdgeBps - observation.economics.netEdgeBps,
      netEdgeBps: observation.economics.netEdgeBps,
      expectedNetPnlUsd: observation.economics.netPnlUsd,
      priorityFeeUsd: observation.economics.priorityFeeUsd,
      baseFeeUsd: observation.economics.baseFeeUsd,
      dexFeesUsd: observation.economics.dexFeesUsd,
      jitoTipUsd: observation.economics.jitoTipUsd,
      slippageReserveUsd: observation.economics.slippageReserveUsd,
      failureReserveUsd: observation.economics.failedAttemptReserveUsd,
      estimatedCosts: {
        totalUsd: observation.economics.grossProfitBeforeDexFeesUsd == null || observation.economics.netPnlUsd == null
          ? null
          : observation.economics.grossProfitBeforeDexFeesUsd - observation.economics.netPnlUsd,
        dexFeesUsd: observation.economics.dexFeesUsd,
        baseFeeUsd: observation.economics.baseFeeUsd,
        priorityFeeUsd: observation.economics.priorityFeeUsd,
        jitoTipUsd: observation.economics.jitoTipUsd,
        slippageReserveUsd: observation.economics.slippageReserveUsd,
        latencyDegradationUsd: observation.economics.latencyDegradationUsd,
        adverseSelectionReserveUsd: observation.economics.adverseSelectionReserveUsd,
        failureReserveUsd: observation.economics.failedAttemptReserveUsd,
      },
      priceImpactBps: observation.economics.priceImpactBps,
      quoteLatencyMs: observation.quoteLatencyMs,
      slot: observation.contextSlots.second,
      slotDrift: observation.slotDrift,
      criticalCostsKnown: observation.economics.criticalCostsKnown,
    });

    const preSimulationBlockers = observation.blockers.filter((blocker) => !['atomic_simulation_missing', 'capture_evidence_missing'].includes(blocker));
    const opportunityDetected = observation.economics.netPnlUsd > 0 && preSimulationBlockers.length === 0;
    if (!opportunityDetected) {
      pushEvent('REJECTED', {
        route,
        inputUsdc: observation.inputUsdc,
        grossEdgeBps: observation.economics.grossEdgeBps,
        quotedEdgeBps: observation.economics.quotedRoundTripEdgeBps,
        netEdgeBps: observation.economics.netEdgeBps,
        expectedNetPnlUsd: observation.economics.netPnlUsd,
        decision: 'REJECTED',
        reason: preSimulationBlockers[0] ?? 'net_not_positive',
        blockers: preSimulationBlockers,
        quoteLatencyMs: observation.quoteLatencyMs,
        slot: observation.contextSlots.second,
        venues: [...firstVenues, ...secondVenues],
        tokens: ['USDC', 'SOL', 'USDC'],
        mints: [USDC_MINT, SOL_MINT],
      });
      return {
        ok: true,
        status: 'BLOCKED',
        mode: config.executionMode,
        executionAuthority: SOLANA_EXECUTION_AUTHORITY,
        liveLocked: SOLANA_LIVE_LOCKED,
        runId,
        events,
        observation,
        evidenceErrors: {
          priorityFee: priorityResult.status === 'rejected' ? String(priorityResult.reason?.message ?? priorityResult.reason) : null,
          writableAccounts: writableAccountError,
          jitoTip: jitoResult.status === 'rejected' ? String(jitoResult.reason?.message ?? jitoResult.reason) : null,
        },
      };
    }

    pushEvent('OPPORTUNITY_DETECTED', {
      route,
      inputUsdc: observation.inputUsdc,
      quotedOutputUsd: observation.quotedEndUsdc,
      grossEdgeBps: observation.economics.grossEdgeBps,
      quotedEdgeBps: observation.economics.quotedRoundTripEdgeBps,
      netEdgeBps: observation.economics.netEdgeBps,
      expectedNetPnlUsd: observation.economics.netPnlUsd,
      estimatedCosts: {
        totalUsd: observation.economics.grossProfitBeforeDexFeesUsd - observation.economics.netPnlUsd,
        dexFeesUsd: observation.economics.dexFeesUsd,
        baseFeeUsd: observation.economics.baseFeeUsd,
        priorityFeeUsd: observation.economics.priorityFeeUsd,
        jitoTipUsd: observation.economics.jitoTipUsd,
        slippageReserveUsd: observation.economics.slippageReserveUsd,
        latencyDegradationUsd: observation.economics.latencyDegradationUsd,
        adverseSelectionReserveUsd: observation.economics.adverseSelectionReserveUsd,
        failureReserveUsd: observation.economics.failedAttemptReserveUsd,
      },
      decision: config.executionMode === 'PAPER' ? 'PAPER_PENDING' : 'SHADOW_PENDING',
      reason: 'positive_expected_net_pnl',
      quoteLatencyMs: observation.quoteLatencyMs,
      slot: observation.contextSlots.second,
      slotDrift: observation.slotDrift,
      priceImpactBps: observation.economics.priceImpactBps,
      venues: [...firstVenues, ...secondVenues],
      tokens: ['USDC', 'SOL', 'USDC'],
      mints: [USDC_MINT, SOL_MINT],
    });

    if (typeof transactionBuilder !== 'function' || typeof transactionSimulator !== 'function') {
      pushEvent('REJECTED', {
        route,
        inputUsdc: observation.inputUsdc,
        netEdgeBps: observation.economics.netEdgeBps,
        expectedNetPnlUsd: observation.economics.netPnlUsd,
        decision: 'REJECTED',
        reason: 'simulation_adapter_not_configured',
        blockers: ['simulation_adapter_not_configured'],
        quoteLatencyMs: observation.quoteLatencyMs,
        slot: observation.contextSlots.second,
      });
      return {
        ok: true,
        status: 'BLOCKED',
        mode: config.executionMode,
        executionAuthority: false,
        liveLocked: true,
        runId,
        events,
        observation,
        evidenceErrors: {
          priorityFee: priorityResult.status === 'rejected' ? String(priorityResult.reason?.message ?? priorityResult.reason) : null,
          writableAccounts: writableAccountError,
          jitoTip: jitoResult.status === 'rejected' ? String(jitoResult.reason?.message ?? jitoResult.reason) : null,
        },
      };
    }

    pushEvent('SIMULATION_STARTED', { route, inputUsdc: observation.inputUsdc, decision: 'PENDING' });
    const freshFirstLeg = await fetchJupiterQuote({ inputMint: USDC_MINT, outputMint: SOL_MINT, amountRaw, config, fetchImpl });
    const freshSecondLeg = await fetchJupiterQuote({ inputMint: SOL_MINT, outputMint: USDC_MINT, amountRaw: BigInt(freshFirstLeg.quote.outAmount), config, fetchImpl });
    const freshObservation = buildSolanaArbitrageObservation({
      firstLeg: freshFirstLeg,
      secondLeg: freshSecondLeg,
      priorityFeeEvidence: priorityResult.status === 'fulfilled' ? priorityResult.value : null,
      jitoTipEvidence: jitoResult.status === 'fulfilled' ? jitoResult.value : null,
      config,
      observedAt: now().toISOString(),
    });
    const built = await transactionBuilder({ firstLeg: freshFirstLeg, secondLeg: freshSecondLeg, observation: freshObservation, config });
    const simulation = await transactionSimulator({ transaction: built?.transaction, minOut: built?.minOut, observation: freshObservation, config });
    const simulationResult = {
      attempted: true,
      success: simulation?.success === true,
      balancesVerified: simulation?.balancesVerified === true,
      minOutVerified: simulation?.minOutVerified === true,
      unitsConsumed: Number.isFinite(Number(simulation?.unitsConsumed)) ? Number(simulation.unitsConsumed) : null,
      error: simulation?.error ? String(simulation.error).slice(0, 240) : null,
    };
    pushEvent(simulationResult.success ? 'SIMULATION_PASSED' : 'SIMULATION_FAILED', {
      route,
      inputUsdc: freshObservation.inputUsdc,
      expectedNetPnlUsd: freshObservation.economics.netPnlUsd,
      netEdgeBps: freshObservation.economics.netEdgeBps,
      simulationResult,
      decision: simulationResult.success ? 'PASSED' : 'REJECTED',
      reason: simulationResult.success ? 'atomic_simulation_passed' : (simulationResult.error ?? 'atomic_simulation_failed'),
      slot: freshObservation.contextSlots.second,
    });

    const adapter = executionAdapter ?? new SolanaExecutionAdapter({ mode: config.executionMode });
    const execution = await adapter.decide({
      opportunity: freshObservation,
      simulation: simulationResult,
      runtime: { ...runtime, quoteAt: freshObservation.observedAt, nowMs: now().getTime() },
      policy: config.riskPolicy,
    });
    if (execution.decision === 'PAPER_EXECUTED') {
      pushEvent('PAPER_EXECUTED', {
        route,
        inputUsdc: freshObservation.inputUsdc,
        expectedNetPnlUsd: freshObservation.economics.netPnlUsd,
        netEdgeBps: freshObservation.economics.netEdgeBps,
        simulationResult,
        decision: 'PAPER_EXECUTED',
        reason: execution.reason,
        venues: [...firstVenues, ...secondVenues],
        tokens: ['USDC', 'SOL', 'USDC'],
      });
      pushEvent('CAPTURE_MEASURED', {
        route,
        inputUsdc: freshObservation.inputUsdc,
        expectedNetPnlUsd: execution.capture.expectedNetPnlUsd,
        capturedNetPnlUsd: execution.capture.capturedNetPnlUsd,
        capturedEdgeBps: execution.capture.capturedEdgeBps,
        captureRatio: execution.capture.captureRatio,
        actualFeesUsd: execution.capture.actualFeesUsd,
        actualOutputUsd: execution.capture.capturedOutputUsd,
        actualSlippageBps: execution.capture.actualSlippageBps,
        priorityFeeUsd: freshObservation.economics.priorityFeeUsd,
        quoteLatencyMs: freshObservation.quoteLatencyMs,
        slot: freshObservation.contextSlots.second,
        decision: 'CAPTURED',
        reason: 'expected_vs_captured_measured',
        venues: [...firstVenues, ...secondVenues],
        tokens: ['USDC', 'SOL', 'USDC'],
      });
    } else if (execution.decision === 'REJECTED') {
      pushEvent('REJECTED', {
        route,
        inputUsdc: freshObservation.inputUsdc,
        expectedNetPnlUsd: freshObservation.economics.netPnlUsd,
        netEdgeBps: freshObservation.economics.netEdgeBps,
        decision: 'REJECTED',
        reason: execution.reason,
        blockers: execution.risk?.reasons ?? [execution.reason],
        simulationResult,
      });
    }

    return {
      ok: true,
      status: execution.decision,
      mode: config.executionMode,
      executionAuthority: SOLANA_EXECUTION_AUTHORITY,
      liveLocked: SOLANA_LIVE_LOCKED,
      runId,
      events,
      observation: {
        ...freshObservation,
        atomicSimulation: simulationResult,
        captureEvidence: execution.capture ?? { measured: false },
        status: execution.decision,
      },
      evidenceErrors: {
        priorityFee: priorityResult.status === 'rejected' ? String(priorityResult.reason?.message ?? priorityResult.reason) : null,
        writableAccounts: writableAccountError,
        jitoTip: jitoResult.status === 'rejected' ? String(jitoResult.reason?.message ?? jitoResult.reason) : null,
      },
    };
  } catch (error) {
    pushEvent('FAILED', {
      decision: 'REJECTED',
      reason: String(error?.message ?? error),
    });
    return {
      ok: false,
      status: 'BLOCKED',
      mode: config.executionMode,
      executionAuthority: SOLANA_EXECUTION_AUTHORITY,
      liveLocked: SOLANA_LIVE_LOCKED,
      runId,
      events,
      observation: null,
      error: String(error?.message ?? error),
    };
  }
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  const result = await observeSolanaArbitrageOnce();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}
