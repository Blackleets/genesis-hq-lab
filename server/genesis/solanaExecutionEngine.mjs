export const SOLANA_EXECUTION_MODES = Object.freeze({ SHADOW: 'SHADOW', PAPER: 'PAPER', LIVE: 'LIVE' });

export const SOLANA_RISK_POLICY = Object.freeze({
  version: 'solana-risk-v1',
  maxTradeUsd: 25,
  maxDailyLossUsd: 2,
  maxSlippageBps: 40,
  minNetEdgeBps: 8,
  maxPriorityFeeUsd: 0.05,
  maxJitoTipUsd: 0.05,
  maxQuoteAgeMs: 1_500,
  maxSlotDrift: 4,
  maxConsecutiveFailures: 3,
  dailyExecutionLimit: 50,
  emergencyStop: false,
});

function boundedEnvNumber(value, fallback, minimum = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, parsed) : fallback;
}

export function getSolanaRiskPolicy(env = process.env) {
  return Object.freeze({
    ...SOLANA_RISK_POLICY,
    version: env.GENESIS_SOLANA_RISK_POLICY_VERSION || SOLANA_RISK_POLICY.version,
    maxTradeUsd: boundedEnvNumber(env.GENESIS_SOLANA_MAX_TRADE_USD, SOLANA_RISK_POLICY.maxTradeUsd, 1),
    maxDailyLossUsd: boundedEnvNumber(env.GENESIS_SOLANA_MAX_DAILY_LOSS_USD, SOLANA_RISK_POLICY.maxDailyLossUsd),
    maxSlippageBps: boundedEnvNumber(env.GENESIS_SOLANA_MAX_SLIPPAGE_BPS, SOLANA_RISK_POLICY.maxSlippageBps),
    minNetEdgeBps: boundedEnvNumber(env.GENESIS_SOLANA_MIN_NET_EDGE_BPS, SOLANA_RISK_POLICY.minNetEdgeBps),
    maxPriorityFeeUsd: boundedEnvNumber(env.GENESIS_SOLANA_MAX_PRIORITY_FEE_USD, SOLANA_RISK_POLICY.maxPriorityFeeUsd),
    maxJitoTipUsd: boundedEnvNumber(env.GENESIS_SOLANA_MAX_JITO_TIP_USD, SOLANA_RISK_POLICY.maxJitoTipUsd),
    maxQuoteAgeMs: boundedEnvNumber(env.GENESIS_SOLANA_MAX_QUOTE_AGE_MS, SOLANA_RISK_POLICY.maxQuoteAgeMs, 100),
    maxSlotDrift: boundedEnvNumber(env.GENESIS_SOLANA_MAX_SLOT_DRIFT, SOLANA_RISK_POLICY.maxSlotDrift),
    maxConsecutiveFailures: boundedEnvNumber(env.GENESIS_SOLANA_MAX_CONSECUTIVE_FAILURES, SOLANA_RISK_POLICY.maxConsecutiveFailures, 1),
    dailyExecutionLimit: boundedEnvNumber(env.GENESIS_SOLANA_DAILY_EXECUTION_LIMIT, SOLANA_RISK_POLICY.dailyExecutionLimit, 1),
    emergencyStop: String(env.GENESIS_SOLANA_EMERGENCY_STOP || '').toLowerCase() === 'true',
  });
}

function finite(value) {
  return Number.isFinite(Number(value));
}

export function evaluateSolanaRisk({ opportunity, simulation, runtime = {}, policy = SOLANA_RISK_POLICY }) {
  const reasons = [];
  const economics = opportunity?.economics ?? {};
  const nowMs = Number(runtime.nowMs ?? Date.now());
  const quoteAtMs = new Date(runtime.quoteAt ?? opportunity?.observedAt ?? 0).getTime();
  const quoteAgeMs = Number.isFinite(quoteAtMs) ? Math.max(0, nowMs - quoteAtMs) : Number.POSITIVE_INFINITY;

  if (policy.emergencyStop || runtime.emergencyStop) reasons.push('emergency_stop');
  if (!finite(opportunity?.inputUsdc) || Number(opportunity.inputUsdc) <= 0) reasons.push('invalid_trade_size');
  else if (Number(opportunity.inputUsdc) > policy.maxTradeUsd) reasons.push('max_trade_usd');
  if (!finite(economics.netPnlUsd) || !finite(economics.netEdgeBps)) reasons.push('net_economics_unknown');
  else {
    if (Number(economics.netPnlUsd) <= 0) reasons.push('net_not_positive');
    if (Number(economics.netEdgeBps) < policy.minNetEdgeBps) reasons.push('min_net_edge_bps');
  }
  if (finite(economics.slippageReserveBps) && Number(economics.slippageReserveBps) > policy.maxSlippageBps) reasons.push('max_slippage_bps');
  if (!finite(economics.priorityFeeUsd) || Number(economics.priorityFeeUsd) > policy.maxPriorityFeeUsd) reasons.push('max_priority_fee_usd');
  if (!finite(economics.jitoTipUsd) || Number(economics.jitoTipUsd) > policy.maxJitoTipUsd) reasons.push('max_jito_tip_usd');
  if (quoteAgeMs > policy.maxQuoteAgeMs) reasons.push('quote_stale');
  if (!finite(opportunity?.slotDrift) || Number(opportunity.slotDrift) > policy.maxSlotDrift) reasons.push('max_slot_drift');
  if (Number(runtime.dailyLossUsd ?? 0) >= policy.maxDailyLossUsd) reasons.push('max_daily_loss_usd');
  if (Number(runtime.consecutiveFailures ?? 0) >= policy.maxConsecutiveFailures) reasons.push('max_consecutive_failures');
  if (Number(runtime.dailyExecutions ?? 0) >= policy.dailyExecutionLimit) reasons.push('daily_execution_limit');
  if (!simulation?.attempted || simulation?.success !== true) reasons.push('simulation_not_passed');
  if (simulation?.balancesVerified !== true) reasons.push('balances_not_verified');
  if (simulation?.minOutVerified !== true) reasons.push('min_out_not_verified');

  return Object.freeze({ allowed: reasons.length === 0, reasons, quoteAgeMs, policyVersion: policy.version });
}

export function measurePaperCapture({ opportunity, capturedOutputUsd, actualFeesUsd = 0, actualSlippageBps = 0, measuredAt = new Date().toISOString() }) {
  const inputUsd = Number(opportunity?.inputUsdc);
  const expectedNetPnlUsd = Number(opportunity?.economics?.netPnlUsd);
  const outputUsd = Number(capturedOutputUsd);
  const feesUsd = Number(actualFeesUsd);
  const slippageBps = Number(actualSlippageBps);
  if (![inputUsd, expectedNetPnlUsd, outputUsd, feesUsd, slippageBps].every(Number.isFinite) || inputUsd <= 0 || feesUsd < 0 || slippageBps < 0) {
    throw new Error('invalid_paper_capture');
  }
  const capturedNetPnlUsd = outputUsd - inputUsd - feesUsd;
  const capturedEdgeBps = (capturedNetPnlUsd / inputUsd) * 10_000;
  const captureRatio = expectedNetPnlUsd === 0 ? null : capturedNetPnlUsd / expectedNetPnlUsd;
  return Object.freeze({
    measured: true,
    measuredAt,
    expectedNetPnlUsd,
    capturedNetPnlUsd,
    capturedEdgeBps,
    captureRatio,
    actualFeesUsd: feesUsd,
    actualSlippageBps: slippageBps,
    capturedOutputUsd: outputUsd,
  });
}

export const LIVE_EXECUTION_CAPABILITIES = Object.freeze([
  'wallet', 'signing', 'transactionBuilding', 'broadcast', 'confirmation',
  'balanceReconciliation', 'actualFees', 'actualOutput', 'realizedPnl',
]);

export class SolanaExecutionAdapter {
  constructor({ mode = 'SHADOW', liveLocked = true, paperCapture, liveServices = {} } = {}) {
    if (!Object.values(SOLANA_EXECUTION_MODES).includes(mode)) throw new Error('invalid_execution_mode');
    if (mode === 'LIVE' && liveLocked !== true) throw new Error('live_activation_not_authorized');
    this.mode = mode;
    this.liveLocked = true;
    this.paperCapture = paperCapture;
    this.liveServices = Object.freeze({ ...liveServices });
  }

  liveReadiness() {
    const missing = LIVE_EXECUTION_CAPABILITIES.filter((capability) => typeof this.liveServices[capability] !== 'function');
    return Object.freeze({ ready: false, liveLocked: true, configuredCapabilities: LIVE_EXECUTION_CAPABILITIES.filter((capability) => !missing.includes(capability)), missingCapabilities: missing });
  }

  async decide({ opportunity, simulation, runtime, policy }) {
    const risk = evaluateSolanaRisk({ opportunity, simulation, runtime, policy });
    if (!risk.allowed) return { decision: 'REJECTED', reason: risk.reasons[0], risk, capture: null };
    if (this.mode === 'SHADOW') return { decision: 'SHADOW_ACCEPTED', reason: 'shadow_observation_only', risk, capture: null };
    if (this.mode === 'LIVE') return { decision: 'REJECTED', reason: 'live_locked', risk, capture: null };
    if (typeof this.paperCapture !== 'function') return { decision: 'REJECTED', reason: 'paper_capture_adapter_missing', risk, capture: null };
    const capture = await this.paperCapture({ opportunity, simulation });
    return { decision: 'PAPER_EXECUTED', reason: 'paper_capture_measured', risk, capture };
  }
}
