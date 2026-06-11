export const EXECUTION_MODES = Object.freeze({
  PAPER: 'paper',
  SANDBOX: 'sandbox',
  LIVE: 'live',
  ADVISORY: 'advisory',
});

export const BILLING_MODES = Object.freeze({
  FREE: 'free',
  SUBSCRIPTION: 'subscription',
  PER_TRADE: 'per_trade',
  PROFIT_SHARE: 'profit_share',
  CREDITS: 'credits',
});

export const FEE_POLICIES = Object.freeze({
  DISABLED: 'disabled',
  QUOTED: 'quoted',
  REQUIRED: 'required',
});

function envFlag(env, name, fallback = false) {
  const value = env[name];
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

export function productFeatureFlags(env = process.env) {
  return {
    feesEnabled: envFlag(env, 'ENABLE_FEES', false),
    liveTradingEnabled: envFlag(env, 'ENABLE_LIVE_TRADING', false),
    globalLearningEnabled: envFlag(env, 'ENABLE_GLOBAL_MEMORY_CONTRIBUTION', false),
    walletLoginEnabled: envFlag(env, 'ENABLE_WALLET_LOGIN', false),
  };
}

export function normalizeExecutionMode(mode) {
  const normalized = String(mode ?? EXECUTION_MODES.PAPER).trim().toLowerCase();
  return Object.values(EXECUTION_MODES).includes(normalized) ? normalized : EXECUTION_MODES.PAPER;
}

export function assertModeAllowed(mode, flags = productFeatureFlags()) {
  const normalized = normalizeExecutionMode(mode);
  if (normalized === EXECUTION_MODES.LIVE && !flags.liveTradingEnabled) {
    return { ok: false, mode: normalized, reason: 'live_trading_disabled' };
  }
  return { ok: true, mode: normalized, reason: null };
}

export function feePolicyForEntitlement(entitlement = {}, flags = productFeatureFlags()) {
  if (!flags.feesEnabled) return FEE_POLICIES.DISABLED;
  const policy = String(entitlement.fee_policy ?? entitlement.feePolicy ?? FEE_POLICIES.DISABLED);
  return Object.values(FEE_POLICIES).includes(policy) ? policy : FEE_POLICIES.DISABLED;
}
