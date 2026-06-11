// portfolioReader.mjs — read-only portfolio snapshot.
// Returns paper portfolio from paperExecutor. Real portfolio requires API keys.

import { getPaperOrders, getPaperStats } from './paperExecutor.mjs';
import { getSafetyConfig, getDailyLoss } from './polymarketSafety.mjs';

/**
 * Get a full portfolio snapshot including paper positions and safety status.
 */
export function getPortfolioSnapshot() {
  const paperOrders = getPaperOrders({ limit: 20 });
  const paperStats = getPaperStats();
  const safetyConfig = getSafetyConfig();
  const dailyLoss = getDailyLoss();

  return {
    mode: safetyConfig.liveEnabled ? 'live_ready' : 'paper_only',
    paper: {
      ...paperStats,
      recentOrders: paperOrders,
    },
    live: {
      enabled: safetyConfig.liveEnabled,
      reason: safetyConfig.liveEnabled ? null : 'LIVE_TRADING_DISABLED',
      positions: [],  // BLOCKED_BY_SECRET_OR_API: requires POLYMARKET_PRIVATE_KEY
      portfolioValue: null,
    },
    risk: {
      dailyLoss: Math.round(dailyLoss * 100) / 100,
      dailyLossCap: safetyConfig.maxDailyLoss,
      dailyLossRemaining: Math.max(0, safetyConfig.maxDailyLoss - dailyLoss),
      maxPositionSize: safetyConfig.maxPositionSize,
      capReached: dailyLoss >= safetyConfig.maxDailyLoss,
    },
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Get the execution layer status (for status endpoint).
 */
export function getExecutionStatus() {
  const cfg = getSafetyConfig();
  return {
    paperMode: {
      enabled: true,
      status: 'operational',
    },
    liveMode: {
      enabled: cfg.liveEnabled,
      tokenConfigured: cfg.manualTokenConfigured,
      status: cfg.liveEnabled ? 'armed_but_clob_not_implemented' : 'blocked',
      blockedBy: !cfg.liveEnabled ? 'ENABLE_LIVE_PREDICTION_TRADING=false' : null,
    },
    safetyLimits: {
      maxPositionSize: cfg.maxPositionSize,
      maxDailyLoss: cfg.maxDailyLoss,
      dryRunDefault: cfg.dryRunDefault,
    },
    dailyLoss: getDailyLoss(),
  };
}
