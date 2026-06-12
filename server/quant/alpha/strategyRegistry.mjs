// strategyRegistry.mjs — unified catalog of all Genesis trading strategies.
//
// This is the SINGLE source of status truth across all strategy types.
// It does NOT execute strategies — it describes them and exposes their live state
// by reading from existing engines (futuresGovernor, env flags, etc.).
//
// Strategy lifecycle states:
//   RESEARCH      — idea or backtest in progress, no live trades
//   BACKTESTING   — has backtest results, awaiting walk-forward / OOS validation
//   PAPER         — running paper trades, accumulating real-time samples
//   PROMOTED      — has enough validated samples + positive edge, eligible for capital
//   DISABLED      — exists but env flag is off
//   REJECTED      — explicitly failed validation gate
//
// All capital decisions must start here.

import { getFuturesGovernorSnapshot } from '../../crypto/futuresGovernor.mjs';
import { recordStatusIfChanged, getStatusOverride } from './promotionAudit.mjs';

// ── Promotion thresholds (aligned with alphaValidationEngine.MIN_TRADES_FOR_EDGE) ──
export const PROMOTION_CRITERIA = Object.freeze({
  minTrades:         30,    // absolute minimum to assess edge
  minProfitFactor:   1.3,   // PF < 1.3 = not enough edge to justify capital
  minExpectancy:     0,     // EV must be positive
  maxDrawdownPct:    0.15,  // max acceptable drawdown as fraction (15%)
  minWinRate:        null,  // no hard floor — covered by PF + EV
});

// ── Static registry — describes each known strategy ──────────────────────────

const STATIC_STRATEGIES = [
  // ── Futures breakout family (ACTIVE) ──────────────────────────────────────
  {
    strategyId:   'futures_breakout_short_micro',
    name:         'Futures Breakout Short (5m)',
    market:       'crypto_futures',
    timeframe:    '5m',
    tradeType:    'crypto_futures_breakout_short_micro',
    enabled:      () => envOn('FUTURES_BREAKOUT_SHORT_MICRO_ENABLED'),
    paperOnly:    false,
    sourceFile:   'server/strategies/futuresBreakoutEngine.mjs',
    governorId:   'short_micro',
  },
  {
    strategyId:   'futures_breakout_short_core',
    name:         'Futures Breakout Short (1h)',
    market:       'crypto_futures',
    timeframe:    '1h',
    tradeType:    'crypto_futures_breakout_short',
    enabled:      () => envOn('FUTURES_BREAKOUT_SHORT_ENABLED'),
    paperOnly:    false,
    sourceFile:   'server/strategies/futuresBreakoutEngine.mjs',
    governorId:   'short_core',
  },
  {
    strategyId:   'futures_breakout_short_alt',
    name:         'Futures Breakout Short Alt (15m)',
    market:       'crypto_futures',
    timeframe:    '15m',
    tradeType:    'crypto_futures_breakout_short_alt',
    enabled:      () => envOn('FUTURES_BREAKOUT_SHORT_ALT_ENABLED'),
    paperOnly:    false,
    sourceFile:   'server/strategies/futuresBreakoutEngine.mjs',
    governorId:   'short_alt',
  },
  {
    strategyId:   'futures_breakout_long_probe',
    name:         'Futures Breakout Long (4h)',
    market:       'crypto_futures',
    timeframe:    '4h',
    tradeType:    'crypto_futures_breakout_long',
    enabled:      () => envOn('FUTURES_BREAKOUT_LONG_ENABLED'),
    paperOnly:    false,
    sourceFile:   'server/strategies/futuresBreakoutEngine.mjs',
    governorId:   'long_probe',
  },

  // ── Scalp (DISABLED — known negative edge) ────────────────────────────────
  {
    strategyId:   'crypto_scalp_v1',
    name:         'Crypto Scalp EMA/RSI (1m)',
    market:       'crypto_spot',
    timeframe:    '1m',
    tradeType:    'crypto_scalp',
    enabled:      () => envOn('SCALP_ENGINE_ENABLED'),
    paperOnly:    true,
    sourceFile:   'server/strategies/scalpingEngine.mjs',
    governorId:   null,
    note:         'edgeSearch.mjs confirmed PF~0.47, WR~20% — negative edge across all regimes',
  },

  // ── Swing (ENABLED per env, no governor data yet) ─────────────────────────
  {
    strategyId:   'crypto_swing',
    name:         'Crypto Swing (4h)',
    market:       'crypto_spot',
    timeframe:    '4h',
    tradeType:    'crypto_swing',
    enabled:      () => envOn('SWING_ENGINE_ENABLED'),
    paperOnly:    true,
    sourceFile:   'server/strategies/swingEngine.mjs',
    governorId:   null,
  },

  // ── Breakout spot (ENABLED per env) ───────────────────────────────────────
  {
    strategyId:   'crypto_breakout_spot',
    name:         'Crypto Breakout Spot',
    market:       'crypto_spot',
    timeframe:    '1h',
    tradeType:    'crypto_breakout',
    enabled:      () => envOn('BREAKOUT_ENGINE_ENABLED'),
    paperOnly:    true,
    sourceFile:   'server/strategies/breakoutEngine.mjs',
    governorId:   null,
  },

  // ── Event alpha (ENABLED per env) ─────────────────────────────────────────
  {
    strategyId:   'event_alpha',
    name:         'Event Alpha',
    market:       'crypto_spot',
    timeframe:    'event',
    tradeType:    'event_alpha',
    enabled:      () => envOn('EVENT_ALPHA_ENABLED'),
    paperOnly:    true,
    sourceFile:   'server/strategies/eventAlphaEngine.mjs',
    governorId:   null,
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function envOn(key) {
  const v = (process.env[key] ?? 'true').toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(v);
}

/**
 * Derive the current lifecycle status for a strategy.
 * Uses governor data when available; falls back to env + heuristics.
 */
function deriveStatus(strategy, governorProfiles) {
  if (!strategy.enabled()) return 'DISABLED';

  if (strategy.governorId) {
    const profile = governorProfiles.find((p) => p.id === strategy.governorId);
    if (!profile) return 'RESEARCH';
    const trades = profile.trades ?? 0;

    if (profile.paused) return 'DISABLED';
    if (trades < PROMOTION_CRITERIA.minTrades) return trades > 0 ? 'PAPER' : 'RESEARCH';

    const pf = profile.profitFactor;
    const ev = profile.avgPnl ?? 0;

    if (pf != null && pf >= PROMOTION_CRITERIA.minProfitFactor && ev > PROMOTION_CRITERIA.minExpectancy) {
      return 'PROMOTED';
    }
    if (pf != null && pf < 1.0) return 'REJECTED';
    return 'PAPER';
  }

  // No governor data: classify by env + note
  if (strategy.note?.includes('negative edge')) return 'REJECTED';
  return strategy.paperOnly ? 'PAPER' : 'RESEARCH';
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Return the full strategy registry with live status.
 * Reads governor data once and annotates all entries.
 *
 * @returns {{ strategies: StrategyRecord[], summary: object, updatedAt: string }}
 */
export function getStrategyRegistry() {
  let governorProfiles = [];
  let governorError = null;

  try {
    const snap = getFuturesGovernorSnapshot();
    governorProfiles = snap?.profiles ?? [];
  } catch (err) {
    governorError = err.message;
  }

  const strategies = STATIC_STRATEGIES.map((s) => {
    const derived = deriveStatus(s, governorProfiles);
    const override = getStatusOverride(s.strategyId);
    const status = override ? override.status : derived;
    const gp = s.governorId ? governorProfiles.find((p) => p.id === s.governorId) : null;

    recordStatusIfChanged(s.strategyId, status, gp ?? {});

    return {
      strategyId:        s.strategyId,
      name:              s.name,
      market:            s.market,
      timeframe:         s.timeframe,
      tradeType:         s.tradeType,
      status,
      sourceFile:        s.sourceFile,
      enabled:           s.enabled(),
      paperOnly:         s.paperOnly,
      note:              s.note ?? null,
      overrideStatus:    override ? { status: override.status, reason: override.reason, setBy: override.set_by, setAt: override.set_at } : null,
      promotionCriteria: PROMOTION_CRITERIA,
      // Live data from governor (when available)
      live: gp ? {
        trades:       gp.trades     ?? 0,
        wins:         gp.wins       ?? 0,
        winRate:      gp.winRate    ?? null,
        avgPnl:       gp.avgPnl     ?? null,
        totalPnl:     gp.totalPnl   ?? null,
        profitFactor: gp.profitFactor ?? null,
        paused:       gp.paused     ?? false,
        rankScore:    gp.rankScore  ?? null,
      } : null,
    };
  });

  const byStatus = {};
  for (const s of strategies) {
    byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
  }

  return {
    strategies,
    summary: {
      total:      strategies.length,
      byStatus,
      promoted:   strategies.filter((s) => s.status === 'PROMOTED'),
      paperable:  strategies.filter((s) => s.status === 'PAPER'),
      rejected:   strategies.filter((s) => s.status === 'REJECTED'),
    },
    promotionCriteria: PROMOTION_CRITERIA,
    governorError,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Get a single strategy by ID.
 */
export function getStrategy(strategyId) {
  const reg = getStrategyRegistry();
  return reg.strategies.find((s) => s.strategyId === strategyId) ?? null;
}

/**
 * List strategy IDs that are currently PROMOTED (eligible for capital).
 */
export function getPromotedStrategies() {
  const reg = getStrategyRegistry();
  return reg.summary.promoted;
}

export { STATIC_STRATEGIES };
