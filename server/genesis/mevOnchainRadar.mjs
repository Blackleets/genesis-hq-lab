// mevOnchainRadar.mjs
// Real-block, read-only DEX quote radar for the benign MEV SHADOW lane.
//
// Safety contract:
// - reads public chain state only
// - no wallet, private key, signing, transaction submission or execution authority
// - quotes are anchored to one Ethereum block
// - observed routes are NOT called atomic until an executor eth_call proves that fact
// - liquidity confidence comes from same-block size stress, never a guessed volume label
// - all modeled assumptions are surfaced in metadata instead of being presented as measured data

import {
  createPublicClient,
  formatUnits,
  http,
  parseAbi,
  parseUnits,
} from 'viem';
import { mainnet } from 'viem/chains';
import { evaluateMevShadowBatch } from './mevShadowEngine.mjs';
import {
  applyAtomicSimulationEvidence,
  buildAtomicSimulationRequest,
  getAtomicSimulatorConfig,
  simulateAtomicArbitrage,
  VENUE_CODES,
} from './mevAtomicSimulator.mjs';
import {
  applyLiquidityProof,
  getLiquidityProofConfig,
  scaleRawAmount,
  scoreLiquidityCurve,
} from './mevLiquidityProof.mjs';

export const RADAR_MODE = 'SHADOW';
export const RADAR_EXECUTION_AUTHORITY = false;

const TOKENS = Object.freeze({
  USDC: {
    symbol: 'USDC',
    address: '0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    decimals: 6,
  },
  WETH: {
    symbol: 'WETH',
    address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    decimals: 18,
  },
});

const UNISWAP_V3_QUOTER_V2 = '0x61fFE014bA17989E743c5F6cB21bF9697530B21e';
const SUSHISWAP_V2_ROUTER = '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F';

const UNISWAP_QUOTER_ABI = parseAbi([
  'function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)',
]);

const SUSHI_ROUTER_ABI = parseAbi([
  'function getAmountsOut(uint256 amountIn,address[] path) view returns (uint256[] amounts)',
]);

function finitePositive(value) {
  return Number.isFinite(value) && value > 0;
}

export function getMevRadarConfig(env = process.env) {
  const rpcUrl = env.GENESIS_MEV_RPC_URL?.trim() || null;
  return {
    rpcUrl,
    providerConfigured: Boolean(rpcUrl),
    notionalUsd: Math.max(10, Number(env.GENESIS_MEV_NOTIONAL_USD || 1000)),
    routeGasUnits: Math.max(100_000, Number(env.GENESIS_MEV_ROUTE_GAS_UNITS || 450_000)),
    slippageReserveBps: Math.max(0, Number(env.GENESIS_MEV_SLIPPAGE_RESERVE_BPS || 10)),
    flashLoanBps: Math.max(0, Number(env.GENESIS_MEV_FLASH_LOAN_BPS || 0)),
    intervalMs: Math.max(3_000, Number(env.GENESIS_MEV_SCAN_INTERVAL_MS || 12_000)),
    gasUnitsSource: env.GENESIS_MEV_ROUTE_GAS_UNITS ? 'configured' : 'conservative_default',
    slippageSource: env.GENESIS_MEV_SLIPPAGE_RESERVE_BPS ? 'configured' : 'conservative_default',
    fundingModel: Number(env.GENESIS_MEV_FLASH_LOAN_BPS || 0) > 0 ? 'flash_loan_modeled' : 'prefunded_shadow',
  };
}

export function createRadarClient(rpcUrl) {
  if (!rpcUrl) throw new Error('provider_not_configured');
  return createPublicClient({
    chain: mainnet,
    transport: http(rpcUrl, { timeout: 10_000, retryCount: 1 }),
    batch: { multicall: true },
  });
}

async function quoteUniswapV3(client, { tokenIn, tokenOut, amountIn, fee, blockNumber }) {
  const { result } = await client.simulateContract({
    address: UNISWAP_V3_QUOTER_V2,
    abi: UNISWAP_QUOTER_ABI,
    functionName: 'quoteExactInputSingle',
    args: [{
      tokenIn: tokenIn.address,
      tokenOut: tokenOut.address,
      amountIn,
      fee,
      sqrtPriceLimitX96: 0n,
    }],
    blockNumber,
  });
  const amountOut = Array.isArray(result) ? result[0] : result?.amountOut;
  if (typeof amountOut !== 'bigint' || amountOut <= 0n) throw new Error('uniswap_quote_invalid');
  return {
    venue: `uniswap_v3_${fee}`,
    venueCode: VENUE_CODES.UNISWAP_V3,
    fee,
    amountOut,
    poolFeeBps: fee / 100,
    quoteSource: 'onchain_quoter',
  };
}

async function quoteSushiV2(client, { tokenIn, tokenOut, amountIn, blockNumber }) {
  const amounts = await client.readContract({
    address: SUSHISWAP_V2_ROUTER,
    abi: SUSHI_ROUTER_ABI,
    functionName: 'getAmountsOut',
    args: [amountIn, [tokenIn.address, tokenOut.address]],
    blockNumber,
  });
  const amountOut = Array.isArray(amounts) ? amounts[amounts.length - 1] : null;
  if (typeof amountOut !== 'bigint' || amountOut <= 0n) throw new Error('sushi_quote_invalid');
  return {
    venue: 'sushiswap_v2',
    venueCode: VENUE_CODES.SUSHISWAP_V2,
    fee: 0,
    amountOut,
    poolFeeBps: null,
    quoteSource: 'onchain_router',
  };
}

export const DEFAULT_ROUTE_ADAPTERS = Object.freeze([
  {
    id: 'uniswap_v3_500',
    quote: (client, params) => quoteUniswapV3(client, { ...params, fee: 500 }),
  },
  {
    id: 'uniswap_v3_3000',
    quote: (client, params) => quoteUniswapV3(client, { ...params, fee: 3000 }),
  },
  {
    id: 'sushiswap_v2',
    quote: quoteSushiV2,
  },
]);

export function orderedVenuePairs(adapters = DEFAULT_ROUTE_ADAPTERS) {
  const pairs = [];
  for (const buy of adapters) {
    for (const sell of adapters) {
      if (buy.id === sell.id) continue;
      pairs.push([buy, sell]);
    }
  }
  return pairs;
}

export async function quoteAtomicCycleCandidate({
  client,
  buyAdapter,
  sellAdapter,
  amountInRaw,
  blockNumber,
  tokenIn = TOKENS.USDC,
  tokenMid = TOKENS.WETH,
}) {
  const first = await buyAdapter.quote(client, {
    tokenIn,
    tokenOut: tokenMid,
    amountIn: amountInRaw,
    blockNumber,
  });
  const second = await sellAdapter.quote(client, {
    tokenIn: tokenMid,
    tokenOut: tokenIn,
    amountIn: first.amountOut,
    blockNumber,
  });

  return {
    buyVenue: first.venue ?? buyAdapter.id,
    sellVenue: second.venue ?? sellAdapter.id,
    startRaw: amountInRaw,
    midRaw: first.amountOut,
    endRaw: second.amountOut,
    first,
    second,
  };
}

async function estimateEthUsd(client, blockNumber, adapters = DEFAULT_ROUTE_ADAPTERS) {
  const oneEth = parseUnits('1', TOKENS.WETH.decimals);
  const prices = [];
  for (const adapter of adapters) {
    try {
      const q = await adapter.quote(client, {
        tokenIn: TOKENS.WETH,
        tokenOut: TOKENS.USDC,
        amountIn: oneEth,
        blockNumber,
      });
      const usd = Number(formatUnits(q.amountOut, TOKENS.USDC.decimals));
      if (finitePositive(usd)) prices.push(usd);
    } catch {
      // One venue failing must not poison the entire radar.
    }
  }
  if (!prices.length) return null;
  prices.sort((a, b) => a - b);
  return prices[Math.floor(prices.length / 2)];
}

function toUsd(raw, token = TOKENS.USDC) {
  return Number(formatUnits(raw, token.decimals));
}

export function buildObservedOpportunity({
  cycle,
  blockNumber,
  capturedAt,
  quoteAgeMs,
  gasPriceWei,
  ethUsd,
  config,
}) {
  const amountInUsd = toUsd(cycle.startRaw, TOKENS.USDC);
  const amountOutUsd = toUsd(cycle.endRaw, TOKENS.USDC);
  const routeGasUnits = config.routeGasUnits;
  const gasCostUsd = finitePositive(ethUsd)
    ? Number(formatUnits(BigInt(Math.round(routeGasUnits)) * gasPriceWei, 18)) * ethUsd
    : null;
  const slippageCostUsd = amountInUsd * (config.slippageReserveBps / 10_000);
  const flashLoanCostUsd = amountInUsd * (config.flashLoanBps / 10_000);

  return {
    tokenIn: TOKENS.USDC.symbol,
    tokenOut: TOKENS.WETH.symbol,
    amountIn: amountInUsd,
    buyDex: cycle.buyVenue,
    sellDex: cycle.sellVenue,
    buyAmountOut: Number(formatUnits(cycle.midRaw, TOKENS.WETH.decimals)),
    sellAmountOut: amountOutUsd,
    gasCostUsd,
    // Pool fees + current price impact are already embedded in the same-block router/quoter outputs.
    lpFeesUsd: 0,
    slippageCostUsd,
    flashLoanCostUsd,
    otherCostsUsd: 0,
    capturedAt,
    chainId: 1,
    blockNumber: blockNumber.toString(),
    quoteAgeMs,
    blockLag: 0,
    inclusionProbability: 0,
    liquidityConfidence: 0,
    simulationSuccess: false,
    atomic: false,
    routeId: `${cycle.buyVenue}->${cycle.sellVenue}:USDC-WETH-USDC`,
    prohibitedTacticDetected: false,
    evidence: {
      source: 'ethereum_mainnet_same_block_quotes',
      sameBlockQuoteSuccess: true,
      poolFeesEmbeddedInQuote: true,
      gasModel: config.gasUnitsSource,
      routeGasUnits,
      slippageModel: config.slippageSource,
      slippageReserveBps: config.slippageReserveBps,
      fundingModel: config.fundingModel,
      ethUsdReference: ethUsd,
      inclusionModel: 'unmeasured_fail_closed',
      liquidityConfidenceModel: 'unmeasured_fail_closed',
      exactAtomicSimulation: false,
    },
  };
}

export async function scanMevOnchainRadarOnce({
  client = null,
  config = getMevRadarConfig(),
  adapters = DEFAULT_ROUTE_ADAPTERS,
  persist = true,
  atomicSimulatorConfig = getAtomicSimulatorConfig(),
  atomicSimulator = simulateAtomicArbitrage,
  liquidityProofConfig = getLiquidityProofConfig(),
} = {}) {
  if (!config.providerConfigured && !client) {
    return {
      ok: false,
      status: 'provider_not_configured',
      providerConfigured: false,
      mode: RADAR_MODE,
      executionAuthority: RADAR_EXECUTION_AUTHORITY,
      routesScanned: 0,
      observations: [],
      evaluation: null,
    };
  }

  const liveClient = client ?? createRadarClient(config.rpcUrl);
  const blockNumber = await liveClient.getBlockNumber();
  const capturedMs = Date.now();
  const capturedAt = new Date(capturedMs).toISOString();
  const [gasPriceWei, ethUsd] = await Promise.all([
    liveClient.getGasPrice(),
    estimateEthUsd(liveClient, blockNumber, adapters),
  ]);

  const amountInRaw = parseUnits(String(config.notionalUsd), TOKENS.USDC.decimals);
  const observations = [];
  const failures = [];
  let atomicSimulationsAttempted = 0;
  let atomicSimulationsPassed = 0;
  let liquidityProbesAttempted = 0;
  let liquidityProbesPassed = 0;

  for (const [buyAdapter, sellAdapter] of orderedVenuePairs(adapters)) {
    try {
      const cycle = await quoteAtomicCycleCandidate({
        client: liveClient,
        buyAdapter,
        sellAdapter,
        amountInRaw,
        blockNumber,
      });
      const quoteAgeMs = Math.max(0, Date.now() - capturedMs);
      let opportunity = buildObservedOpportunity({
        cycle,
        blockNumber,
        capturedAt,
        quoteAgeMs,
        gasPriceWei,
        ethUsd,
        config,
      });

      liquidityProbesAttempted += 1;
      try {
        const probeAmountRaw = scaleRawAmount(amountInRaw, liquidityProofConfig.probeMultiplier);
        const probeCycle = await quoteAtomicCycleCandidate({
          client: liveClient,
          buyAdapter,
          sellAdapter,
          amountInRaw: probeAmountRaw,
          blockNumber,
        });
        const measurement = scoreLiquidityCurve({
          baseAmountIn: toUsd(cycle.startRaw),
          baseAmountOut: toUsd(cycle.endRaw),
          probeAmountIn: toUsd(probeCycle.startRaw),
          probeAmountOut: toUsd(probeCycle.endRaw),
          config: liquidityProofConfig,
        });
        if (measurement.known) liquidityProbesPassed += 1;
        opportunity = applyLiquidityProof(opportunity, measurement);
      } catch (error) {
        opportunity = applyLiquidityProof(opportunity, {
          known: false,
          confidence: 0,
          reason: 'liquidity_probe_failed',
          error: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200),
        });
      }

      if (atomicSimulatorConfig?.executorConfigured) {
        const request = buildAtomicSimulationRequest({
          tokenIn: TOKENS.USDC.address,
          tokenMid: TOKENS.WETH.address,
          amountIn: cycle.startRaw,
          buyVenue: cycle.first.venueCode,
          buyFee: cycle.first.fee ?? 0,
          sellVenue: cycle.second.venueCode,
          sellFee: cycle.second.fee ?? 0,
          quotedFinalAmount: cycle.endRaw,
          slippageReserveBps: config.slippageReserveBps,
        });
        atomicSimulationsAttempted += 1;
        const simulation = await atomicSimulator({
          client: liveClient,
          blockNumber,
          routeId: opportunity.routeId,
          request,
          config: atomicSimulatorConfig,
        });
        if (simulation?.ok) atomicSimulationsPassed += 1;
        opportunity = applyAtomicSimulationEvidence({
          opportunity,
          simulation,
          gasPriceWei,
          ethUsd,
          outputTokenDecimals: TOKENS.USDC.decimals,
        });
      } else {
        opportunity = applyAtomicSimulationEvidence({
          opportunity,
          simulation: { ok: false, reason: 'executor_not_configured' },
          gasPriceWei,
          ethUsd,
          outputTokenDecimals: TOKENS.USDC.decimals,
        });
      }

      observations.push(opportunity);
    } catch (error) {
      failures.push({
        route: `${buyAdapter.id}->${sellAdapter.id}`,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const evaluation = evaluateMevShadowBatch(observations, { persist });
  return {
    ok: true,
    status: 'observing',
    providerConfigured: true,
    mode: RADAR_MODE,
    executionAuthority: RADAR_EXECUTION_AUTHORITY,
    chainId: 1,
    blockNumber: blockNumber.toString(),
    capturedAt,
    gasPriceWei: gasPriceWei.toString(),
    ethUsdReference: ethUsd,
    routesScanned: orderedVenuePairs(adapters).length,
    routesQuoted: observations.length,
    liquidityProbesAttempted,
    liquidityProbesPassed,
    atomicSimulatorConfigured: atomicSimulatorConfig?.executorConfigured === true,
    atomicSimulationsAttempted,
    atomicSimulationsPassed,
    failures,
    observations,
    evaluation,
  };
}

if (process.argv[1]?.endsWith('mevOnchainRadar.mjs')) {
  const result = await scanMevOnchainRadarOnce({ persist: true });
  console.log(JSON.stringify({
    ok: result.ok,
    status: result.status,
    mode: result.mode,
    executionAuthority: result.executionAuthority,
    blockNumber: result.blockNumber ?? null,
    routesScanned: result.routesScanned,
    routesQuoted: result.routesQuoted ?? 0,
    liquidityProbesAttempted: result.liquidityProbesAttempted ?? 0,
    liquidityProbesPassed: result.liquidityProbesPassed ?? 0,
    atomicSimulatorConfigured: result.atomicSimulatorConfigured ?? false,
    atomicSimulationsAttempted: result.atomicSimulationsAttempted ?? 0,
    atomicSimulationsPassed: result.atomicSimulationsPassed ?? 0,
    candidates: result.evaluation?.candidates?.length ?? 0,
    filtered: result.evaluation?.rejected?.length ?? 0,
    error: result.error ?? null,
  }, null, 2));
}
