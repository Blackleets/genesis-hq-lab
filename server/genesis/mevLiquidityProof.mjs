// mevLiquidityProof.mjs
// Same-block size-stress liquidity evidence for the Arbitrage Radar.
//
// The goal is not to guess liquidity from volume labels. We re-quote the exact
// route at a larger notional on the SAME block and measure how much route
// efficiency degrades. The thresholds are fixed policy, not fit to outcomes.

export const LIQUIDITY_PROOF_VERSION = 'same_block_size_stress_v1';

function finitePositive(value) {
  return Number.isFinite(value) && value > 0;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

export function getLiquidityProofConfig(env = process.env) {
  const multiplierRaw = Number(env.GENESIS_MEV_LIQUIDITY_PROBE_MULTIPLIER || 2);
  const fullImpactRaw = Number(env.GENESIS_MEV_LIQUIDITY_FULL_BPS || 5);
  const zeroImpactRaw = Number(env.GENESIS_MEV_LIQUIDITY_ZERO_BPS || 50);
  const probeMultiplier = Number.isFinite(multiplierRaw)
    ? Math.max(1.25, Math.min(5, multiplierRaw))
    : 2;
  const fullConfidenceImpactBps = Number.isFinite(fullImpactRaw)
    ? Math.max(0, Math.min(100, fullImpactRaw))
    : 5;
  const zeroConfidenceImpactBps = Number.isFinite(zeroImpactRaw)
    ? Math.max(fullConfidenceImpactBps + 1, Math.min(500, zeroImpactRaw))
    : 50;
  return {
    probeMultiplier,
    fullConfidenceImpactBps,
    zeroConfidenceImpactBps,
  };
}

export function scaleRawAmount(rawAmount, multiplier) {
  const raw = typeof rawAmount === 'bigint' ? rawAmount : BigInt(rawAmount);
  const scale = BigInt(Math.round(Number(multiplier) * 10_000));
  return (raw * scale) / 10_000n;
}

export function scoreLiquidityCurve({
  baseAmountIn,
  baseAmountOut,
  probeAmountIn,
  probeAmountOut,
  config = getLiquidityProofConfig(),
} = {}) {
  const values = [baseAmountIn, baseAmountOut, probeAmountIn, probeAmountOut].map(Number);
  if (!values.every(finitePositive)) {
    return {
      known: false,
      confidence: 0,
      reason: 'liquidity_probe_missing',
      version: LIQUIDITY_PROOF_VERSION,
    };
  }

  const [baseIn, baseOut, probeIn, probeOut] = values;
  if (probeIn <= baseIn) {
    return {
      known: false,
      confidence: 0,
      reason: 'liquidity_probe_not_larger',
      version: LIQUIDITY_PROOF_VERSION,
    };
  }

  const baseEfficiency = baseOut / baseIn;
  const probeEfficiency = probeOut / probeIn;
  if (!finitePositive(baseEfficiency) || !finitePositive(probeEfficiency)) {
    return {
      known: false,
      confidence: 0,
      reason: 'liquidity_efficiency_invalid',
      version: LIQUIDITY_PROOF_VERSION,
    };
  }

  const adverseImpactBps = Math.max(0, ((baseEfficiency - probeEfficiency) / baseEfficiency) * 10_000);
  const full = config.fullConfidenceImpactBps;
  const zero = config.zeroConfidenceImpactBps;
  let confidence;
  if (adverseImpactBps <= full) confidence = 1;
  else if (adverseImpactBps >= zero) confidence = 0;
  else confidence = 1 - ((adverseImpactBps - full) / (zero - full));

  return {
    known: true,
    confidence: clamp01(confidence),
    adverseImpactBps,
    baseEfficiency,
    probeEfficiency,
    baseAmountIn: baseIn,
    baseAmountOut: baseOut,
    probeAmountIn: probeIn,
    probeAmountOut: probeOut,
    probeMultiplierObserved: probeIn / baseIn,
    policy: {
      fullConfidenceImpactBps: full,
      zeroConfidenceImpactBps: zero,
    },
    version: LIQUIDITY_PROOF_VERSION,
  };
}

export function applyLiquidityProof(opportunity, measurement) {
  if (!opportunity || typeof opportunity !== 'object') throw new TypeError('opportunity_required');
  const known = measurement?.known === true && Number.isFinite(measurement?.confidence);
  return {
    ...opportunity,
    liquidityConfidence: known ? clamp01(measurement.confidence) : 0,
    evidence: {
      ...(opportunity.evidence ?? {}),
      liquidityConfidenceModel: known ? LIQUIDITY_PROOF_VERSION : 'unmeasured_fail_closed',
      liquidityProof: known ? measurement : null,
      liquidityProofReason: known ? null : (measurement?.reason ?? 'liquidity_probe_unavailable'),
    },
  };
}
