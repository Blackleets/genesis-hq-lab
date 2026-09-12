// mevAtomicSimulator.mjs
// Read-only atomic-route simulator for the Arbitrage Radar.
//
// This module NEVER signs or submits a transaction. It only performs eth_call
// style contract simulation against a separately configured executor address.
// The executor interface is deliberately narrow: routes are expressed as
// allowlisted venue codes + fee tiers, never arbitrary target/calldata pairs.
// If the executor is absent, malformed, reverts, or returns inconsistent data,
// the opportunity remains filtered.

import { createHash } from 'node:crypto';
import { formatUnits, isAddress, parseAbi } from 'viem';

export const ATOMIC_SIMULATION_VERSION = 'atomic_sim_v1';
export const SIMULATION_EXECUTION_AUTHORITY = false;

export const VENUE_CODES = Object.freeze({
  UNISWAP_V3: 1,
  SUSHISWAP_V2: 2,
});

export const EXECUTOR_ABI = parseAbi([
  'function simulateArbitrage((address tokenIn,address tokenMid,uint256 amountIn,uint8 buyVenue,uint24 buyFee,uint8 sellVenue,uint24 sellFee,uint256 minFinalAmount,uint256 deadline) request) returns (uint256 finalAmountOut)',
]);

function validAddress(value) {
  return typeof value === 'string' && isAddress(value, { strict: false });
}

function toBigInt(value, fallback = null) {
  try {
    if (value === null || value === undefined || value === '') return fallback;
    const out = BigInt(value);
    return out >= 0n ? out : fallback;
  } catch {
    return fallback;
  }
}

function validVenueCode(value) {
  return Number.isInteger(value) && Object.values(VENUE_CODES).includes(value);
}

function validFee(value, venueCode) {
  if (!Number.isInteger(value) || value < 0 || value > 1_000_000) return false;
  if (venueCode === VENUE_CODES.UNISWAP_V3) return value === 100 || value === 500 || value === 3000 || value === 10000;
  if (venueCode === VENUE_CODES.SUSHISWAP_V2) return value === 0;
  return false;
}

export function getAtomicSimulatorConfig(env = process.env) {
  const executorAddress = validAddress(env.GENESIS_MEV_EXECUTOR_ADDRESS)
    ? env.GENESIS_MEV_EXECUTOR_ADDRESS
    : null;
  const simulationFrom = validAddress(env.GENESIS_MEV_SIMULATION_FROM)
    ? env.GENESIS_MEV_SIMULATION_FROM
    : null;
  const maxGasUnitsRaw = Number(env.GENESIS_MEV_MAX_SIM_GAS_UNITS || 1_200_000);
  return {
    executorAddress,
    simulationFrom,
    executorConfigured: Boolean(executorAddress),
    maxGasUnits: Number.isFinite(maxGasUnitsRaw) && maxGasUnitsRaw > 0
      ? Math.floor(maxGasUnitsRaw)
      : 1_200_000,
  };
}

export function validateAtomicSimulationRequest(request) {
  const errors = [];
  if (!request || typeof request !== 'object') return { ok: false, errors: ['request_missing'] };
  if (!validAddress(request.tokenIn)) errors.push('tokenIn');
  if (!validAddress(request.tokenMid)) errors.push('tokenMid');
  if (!validVenueCode(request.buyVenue)) errors.push('buyVenue');
  if (!validVenueCode(request.sellVenue)) errors.push('sellVenue');
  if (!validFee(request.buyFee, request.buyVenue)) errors.push('buyFee');
  if (!validFee(request.sellFee, request.sellVenue)) errors.push('sellFee');
  if (!(toBigInt(request.amountIn, -1n) > 0n)) errors.push('amountIn');
  if (!(toBigInt(request.minFinalAmount, -1n) > 0n)) errors.push('minFinalAmount');
  if (!(toBigInt(request.deadline, -1n) > 0n)) errors.push('deadline');
  return { ok: errors.length === 0, errors };
}

export function buildAtomicSimulationRequest({
  tokenIn,
  tokenMid,
  amountIn,
  buyVenue,
  buyFee = 0,
  sellVenue,
  sellFee = 0,
  quotedFinalAmount,
  slippageReserveBps = 10,
  nowSeconds = Math.floor(Date.now() / 1000),
  ttlSeconds = 60,
}) {
  const finalRaw = toBigInt(quotedFinalAmount, null);
  const reserve = Math.max(0, Math.min(5_000, Number(slippageReserveBps) || 0));
  const minFinalAmount = finalRaw == null
    ? null
    : (finalRaw * BigInt(Math.floor(10_000 - reserve))) / 10_000n;
  return {
    tokenIn,
    tokenMid,
    amountIn: toBigInt(amountIn, 0n),
    buyVenue,
    buyFee,
    sellVenue,
    sellFee,
    minFinalAmount,
    deadline: BigInt(Math.floor(nowSeconds + Math.max(10, ttlSeconds))),
  };
}

export function atomicSimulationProof({
  executorAddress,
  blockNumber,
  routeId,
  request,
  finalAmountOut,
  gasUnits,
}) {
  return createHash('sha256')
    .update(JSON.stringify({
      version: ATOMIC_SIMULATION_VERSION,
      executorAddress: String(executorAddress).toLowerCase(),
      blockNumber: String(blockNumber),
      routeId: String(routeId ?? ''),
      request: {
        ...request,
        amountIn: String(request.amountIn),
        minFinalAmount: String(request.minFinalAmount),
        deadline: String(request.deadline),
      },
      finalAmountOut: String(finalAmountOut),
      gasUnits: String(gasUnits),
    }))
    .digest('hex');
}

export async function simulateAtomicArbitrage({
  client,
  blockNumber,
  routeId = '',
  request,
  config = getAtomicSimulatorConfig(),
} = {}) {
  if (!client) {
    return { ok: false, atomic: false, simulationSuccess: false, reason: 'client_missing' };
  }
  if (!config.executorConfigured || !config.executorAddress) {
    return { ok: false, atomic: false, simulationSuccess: false, reason: 'executor_not_configured' };
  }
  if (blockNumber === null || blockNumber === undefined) {
    return { ok: false, atomic: false, simulationSuccess: false, reason: 'block_missing' };
  }

  const validation = validateAtomicSimulationRequest(request);
  if (!validation.ok) {
    return {
      ok: false,
      atomic: false,
      simulationSuccess: false,
      reason: 'invalid_simulation_request',
      requestErrors: validation.errors,
    };
  }

  const account = config.simulationFrom || undefined;
  try {
    const simulation = await client.simulateContract({
      address: config.executorAddress,
      abi: EXECUTOR_ABI,
      functionName: 'simulateArbitrage',
      args: [request],
      blockNumber,
      account,
    });

    const rawResult = simulation?.result;
    const finalAmountOut = Array.isArray(rawResult) ? rawResult[0] : rawResult;
    if (typeof finalAmountOut !== 'bigint' || finalAmountOut <= 0n) {
      return {
        ok: false,
        atomic: false,
        simulationSuccess: false,
        reason: 'invalid_simulation_output',
      };
    }

    const gasUnits = await client.estimateContractGas({
      address: config.executorAddress,
      abi: EXECUTOR_ABI,
      functionName: 'simulateArbitrage',
      args: [request],
      blockNumber,
      account,
    });

    if (typeof gasUnits !== 'bigint' || gasUnits <= 0n) {
      return {
        ok: false,
        atomic: false,
        simulationSuccess: false,
        reason: 'invalid_gas_estimate',
      };
    }
    if (gasUnits > BigInt(config.maxGasUnits)) {
      return {
        ok: false,
        atomic: false,
        simulationSuccess: false,
        reason: 'gas_limit_exceeded',
        gasUnits: gasUnits.toString(),
        maxGasUnits: config.maxGasUnits,
      };
    }

    return {
      ok: true,
      atomic: true,
      simulationSuccess: true,
      version: ATOMIC_SIMULATION_VERSION,
      executorAddress: config.executorAddress,
      simulationFrom: config.simulationFrom,
      blockNumber: blockNumber.toString(),
      finalAmountOut,
      gasUnits,
      proof: atomicSimulationProof({
        executorAddress: config.executorAddress,
        blockNumber,
        routeId,
        request,
        finalAmountOut,
        gasUnits,
      }),
    };
  } catch (error) {
    return {
      ok: false,
      atomic: false,
      simulationSuccess: false,
      reason: 'atomic_simulation_reverted',
      error: error instanceof Error ? error.message.slice(0, 400) : String(error).slice(0, 400),
    };
  }
}

export function applyAtomicSimulationEvidence({
  opportunity,
  simulation,
  gasPriceWei,
  ethUsd,
  outputTokenDecimals = 6,
} = {}) {
  if (!opportunity || typeof opportunity !== 'object') throw new TypeError('opportunity_required');
  if (!simulation?.ok || simulation.atomic !== true || simulation.simulationSuccess !== true) {
    return {
      ...opportunity,
      atomic: false,
      simulationSuccess: false,
      evidence: {
        ...(opportunity.evidence ?? {}),
        exactAtomicSimulation: false,
        atomicSimulationVersion: ATOMIC_SIMULATION_VERSION,
        atomicSimulationReason: simulation?.reason ?? 'simulation_unavailable',
      },
    };
  }

  const finalAmountOutUsd = Number(formatUnits(simulation.finalAmountOut, outputTokenDecimals));
  const gasPrice = toBigInt(gasPriceWei, null);
  const gasCostUsd = gasPrice !== null && Number.isFinite(ethUsd) && ethUsd > 0
    ? Number(formatUnits(simulation.gasUnits * gasPrice, 18)) * ethUsd
    : null;

  return {
    ...opportunity,
    sellAmountOut: Number.isFinite(finalAmountOutUsd) ? finalAmountOutUsd : opportunity.sellAmountOut,
    gasCostUsd: Number.isFinite(gasCostUsd) ? gasCostUsd : opportunity.gasCostUsd,
    atomic: true,
    simulationSuccess: true,
    evidence: {
      ...(opportunity.evidence ?? {}),
      exactAtomicSimulation: true,
      atomicSimulationVersion: ATOMIC_SIMULATION_VERSION,
      executorAddress: simulation.executorAddress,
      simulationBlockNumber: simulation.blockNumber,
      simulationGasUnits: simulation.gasUnits.toString(),
      simulationProof: simulation.proof,
      simulatedFinalAmountOutRaw: simulation.finalAmountOut.toString(),
      simulatedFinalAmountOutUsd: Number.isFinite(finalAmountOutUsd) ? finalAmountOutUsd : null,
    },
  };
}
