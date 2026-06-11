// polymarketSafety.mjs — safety configuration and daily loss tracking.
// All limits are read from environment variables with conservative defaults.
// This module is the single source of truth for risk parameters.

// ── Safety config (from env with defaults) ───────────────────────────────────

export function getSafetyConfig() {
  return {
    maxPositionSize:      Number(process.env.MAX_PREDICTION_POSITION_SIZE ?? 10),
    maxDailyLoss:         Number(process.env.MAX_PREDICTION_DAILY_LOSS ?? 25),
    dryRunDefault:        (process.env.PREDICTION_DRY_RUN_DEFAULT ?? 'true') !== 'false',
    liveEnabled:          process.env.ENABLE_LIVE_PREDICTION_TRADING === 'true',
    requireManualToken:   true, // always required for live
    manualTokenConfigured: !!process.env.MANUAL_CONFIRMATION_TOKEN,
  };
}

// ── Daily loss tracker (in-memory, resets at midnight UTC) ───────────────────

let _dayKey = _todayKey();
let _dailyLoss = 0;

function _todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function _resetIfNewDay() {
  const today = _todayKey();
  if (today !== _dayKey) {
    _dayKey = today;
    _dailyLoss = 0;
  }
}

export function recordLoss(amount) {
  _resetIfNewDay();
  if (amount > 0) _dailyLoss += amount;
}

export function getDailyLoss() {
  _resetIfNewDay();
  return _dailyLoss;
}

export function resetDailyLoss() {
  _dailyLoss = 0;
  _dayKey = _todayKey();
}

// ── Safety checks ─────────────────────────────────────────────────────────────

/**
 * Check whether a proposed order is within safety limits.
 *
 * @param {{ amount: number, marketId: string, outcome: string }} order
 * @returns {{ ok: boolean, reason?: string, config: object }}
 */
export function checkSafetyLimits(order) {
  _resetIfNewDay();
  const cfg = getSafetyConfig();

  if (!order.amount || order.amount <= 0) {
    return { ok: false, reason: 'INVALID_AMOUNT', config: cfg };
  }

  if (order.amount > cfg.maxPositionSize) {
    return {
      ok: false,
      reason: 'POSITION_SIZE_EXCEEDED',
      detail: `Order amount $${order.amount} exceeds max $${cfg.maxPositionSize}`,
      config: cfg,
    };
  }

  if (_dailyLoss >= cfg.maxDailyLoss) {
    return {
      ok: false,
      reason: 'DAILY_LOSS_CAP_HIT',
      detail: `Daily loss $${_dailyLoss.toFixed(2)} has reached cap $${cfg.maxDailyLoss}`,
      config: cfg,
    };
  }

  if (!order.marketId) {
    return { ok: false, reason: 'MISSING_MARKET_ID', config: cfg };
  }

  if (!['YES', 'NO'].includes(order.outcome)) {
    return { ok: false, reason: 'INVALID_OUTCOME', detail: 'outcome must be YES or NO', config: cfg };
  }

  return { ok: true, config: cfg };
}

/**
 * Check whether live trading is permitted.
 *
 * @param {string} [confirmationToken] - token from request
 * @returns {{ ok: boolean, reason?: string }}
 */
export function checkLivePermission(confirmationToken) {
  const cfg = getSafetyConfig();

  if (!cfg.liveEnabled) {
    return { ok: false, reason: 'LIVE_TRADING_DISABLED', detail: 'Set ENABLE_LIVE_PREDICTION_TRADING=true to enable' };
  }

  if (!cfg.manualTokenConfigured) {
    return { ok: false, reason: 'MISSING_CONFIRMATION_TOKEN', detail: 'Set MANUAL_CONFIRMATION_TOKEN in environment' };
  }

  if (!confirmationToken || confirmationToken !== process.env.MANUAL_CONFIRMATION_TOKEN) {
    return { ok: false, reason: 'INVALID_CONFIRMATION_TOKEN', detail: 'Provided token does not match MANUAL_CONFIRMATION_TOKEN' };
  }

  return { ok: true };
}
