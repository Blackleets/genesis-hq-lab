// futuresBreakoutEngine.mjs — paper-futures breakout agents.
//
// Purpose:
//   - promote the validated narrow hypothesis (ETH+SOL short-only 4h) into a real worker
//   - keep a separate long-only probe agent for comparison without polluting the core
//
// Design:
//   - each profile is its own "agent" with its own trade_type
//   - short core is enabled by default
//   - long probe is opt-in, disabled by default

import { fetchKlines } from '../crypto/backtest/historicalData.mjs';
import db from '../db/database.mjs';
import {
  shortOnlyRegimeSwitchBreakoutSignal,
  longOnlyRegimeSwitchBreakoutSignal,
} from '../crypto/backtest/strategyLab.mjs';
import { getCurrentPrice } from '../crypto/priceFeeder.mjs';
import { openCryptoFuturesPosition, hasOpenPosition } from '../trading/paperExecutionEngine.mjs';
import { isGlobalSafeMode, getGlobalRiskDiagnostics } from '../risk/globalRiskEngine.mjs';
import { isSafeMode } from '../memory/reconciliationEngine.mjs';
import { logEvent, CATEGORY, SEVERITY } from '../observability/eventTimeline.mjs';
import { getFuturesGovernorSnapshot, syncFuturesGovernorJournal } from '../crypto/futuresGovernor.mjs';

const DAYS = parseInt(process.env.FUTURES_BREAKOUT_DAYS ?? '90', 10);
const BREAKOUT_PERIOD = parseInt(process.env.FUTURES_BREAKOUT_PERIOD ?? '55', 10);
const REGIME_SMA = parseInt(process.env.FUTURES_BREAKOUT_SMA ?? '200', 10);
const TP_PCT = parseFloat(process.env.FUTURES_BREAKOUT_TP_PCT ?? '0.08');
const SL_PCT = parseFloat(process.env.FUTURES_BREAKOUT_SL_PCT ?? '0.03');
const TIMEOUT_HOURS = parseInt(process.env.FUTURES_BREAKOUT_TIMEOUT_H ?? '240', 10);
const MAX_MARGIN = parseFloat(process.env.FUTURES_BREAKOUT_MAX_MARGIN ?? '250');
const DEFAULT_LEVERAGE = parseFloat(process.env.FUTURES_BREAKOUT_LEVERAGE ?? '3');

const SHORT_ENABLED = !['0', 'false', 'no', 'off'].includes((process.env.FUTURES_BREAKOUT_SHORT_ENABLED ?? 'true').toLowerCase());
const SHORT_ALT_ENABLED = !['0', 'false', 'no', 'off'].includes((process.env.FUTURES_BREAKOUT_SHORT_ALT_ENABLED ?? 'true').toLowerCase());
const LONG_ENABLED = !['0', 'false', 'no', 'off'].includes((process.env.FUTURES_BREAKOUT_LONG_ENABLED ?? 'true').toLowerCase());

const PROFILES = [
  {
    id: 'short_micro',
    enabled: !['0', 'false', 'no', 'off'].includes((process.env.FUTURES_BREAKOUT_SHORT_MICRO_ENABLED ?? 'true').toLowerCase()),
    agentId: 'futures-breakout-short-0',
    tradeType: 'crypto_futures_breakout_short_micro',
    pairs: (process.env.FUTURES_BREAKOUT_SHORT_MICRO_PAIRS ?? 'BTCUSDT,ETHUSDT').split(','),
    tier: 'micro',
    interval: '5m',
    signalFn: shortOnlyRegimeSwitchBreakoutSignal,
    sideLabel: 'SHORT',
    leverage: 2,
    maxMargin: 100,
    timeoutHours: 8,
  },
  {
    id: 'short_core',
    enabled: SHORT_ENABLED,
    agentId: 'futures-breakout-short-1',
    tradeType: 'crypto_futures_breakout_short',
    pairs: (process.env.FUTURES_BREAKOUT_SHORT_PAIRS ?? 'BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT').split(','),
    tier: 'core',
    interval: '1h',
    signalFn: shortOnlyRegimeSwitchBreakoutSignal,
    sideLabel: 'SHORT',
    leverage: DEFAULT_LEVERAGE,
    maxMargin: MAX_MARGIN,
    timeoutHours: 48,
  },
  {
    id: 'short_alt',
    enabled: SHORT_ALT_ENABLED,
    agentId: 'futures-breakout-short-2',
    tradeType: 'crypto_futures_breakout_short_alt',
    pairs: (process.env.FUTURES_BREAKOUT_SHORT_ALT_PAIRS ?? 'XRPUSDT,DOGEUSDT').split(','),
    tier: 'alt',
    interval: '15m',
    signalFn: shortOnlyRegimeSwitchBreakoutSignal,
    sideLabel: 'SHORT',
    leverage: 2.5,
    maxMargin: 150,
    timeoutHours: 16,
  },
  {
    id: 'long_probe',
    enabled: LONG_ENABLED,
    agentId: 'futures-breakout-long-1',
    tradeType: 'crypto_futures_breakout_long',
    pairs: (process.env.FUTURES_BREAKOUT_LONG_PAIRS ?? 'BTCUSDT,ETHUSDT').split(','),
    tier: 'probe',
    interval: '4h',
    signalFn: longOnlyRegimeSwitchBreakoutSignal,
    sideLabel: 'LONG',
    leverage: DEFAULT_LEVERAGE,
    maxMargin: 180,
    timeoutHours: TIMEOUT_HOURS,
  },
];
const CYCLE_HISTORY_KEY = 'futures_cycle_history';
const MAX_CYCLE_HISTORY = 80;

const _lastEntryBar = new Map();
let _lastCycle = null;

function key(profileId, pair) {
  return `${profileId}:${pair}`;
}

function quoteVolume24h(klines) {
  return klines.slice(-6).reduce((sum, kline) => sum + (parseFloat(kline[7]) || 0), 0);
}

export function futuresBreakoutEngineConfig() {
  const governor = getFuturesGovernorSnapshot();
  return {
    breakoutPeriod: BREAKOUT_PERIOD,
    regimeSmaPeriod: REGIME_SMA,
    tpPct: TP_PCT,
    slPct: SL_PCT,
    timeoutHours: TIMEOUT_HOURS,
    maxMargin: MAX_MARGIN,
    leverage: DEFAULT_LEVERAGE,
    governor,
    profiles: PROFILES.map((profile) => ({
      id: profile.id,
      enabled: profile.enabled,
      agentId: profile.agentId,
      tradeType: profile.tradeType,
      tier: profile.tier,
      interval: profile.interval,
      maxMargin: profile.maxMargin,
      timeoutHours: profile.timeoutHours,
      pairs: [...profile.pairs],
    })),
  };
}

export function getLastFuturesBreakoutCycle() {
  return _lastCycle;
}

function readCycleHistory() {
  try {
    const row = db.prepare(`SELECT value FROM org_state WHERE key = ?`).get(CYCLE_HISTORY_KEY);
    if (!row?.value) return [];
    const parsed = JSON.parse(row.value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeCycleHistory(history) {
  try {
    db.prepare(`
      INSERT OR REPLACE INTO org_state (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
    `).run(CYCLE_HISTORY_KEY, JSON.stringify(history.slice(-MAX_CYCLE_HISTORY)));
  } catch {
    // Non-fatal
  }
}

function persistCycleSummary(cycle) {
  const history = readCycleHistory();
  history.push({
    startedAt: cycle.startedAt,
    completedAt: cycle.completedAt,
    scanned: cycle.scanned,
    qualified: cycle.qualified,
    executed: cycle.executed,
    skipped: cycle.skipped,
    blocked: cycle.blocked,
    profiles: cycle.profiles.map((profile) => ({
      profile: profile.profile,
      scanned: profile.scanned,
      qualified: profile.qualified,
      executed: profile.executed,
      skipped: profile.skipped,
      blocked: profile.blocked,
      blockReason: profile.blockReason,
    })),
  });
  writeCycleHistory(history);
}

async function runProfile(profile, governorProfile) {
  const result = {
    profile: profile.id,
    scanned: 0,
    qualified: 0,
    executed: 0,
    skipped: 0,
    blocked: false,
    blockReason: null,
    pairResults: [],
  };
  if (!profile.enabled) return result;
  if (governorProfile?.supervisor?.mode === 'cooldown') {
    result.blocked = true;
    result.blockReason = 'supervisor_cooldown';
    result.pairResults = profile.pairs.map((pair) => ({
      pair,
      status: 'blocked',
      reason: 'supervisor_cooldown',
      detail: governorProfile.supervisor.reason ?? 'profile cooling down',
    }));
    return result;
  }
  if (governorProfile?.mode === 'paused') {
    result.blocked = true;
    result.blockReason = 'governor_paused';
    result.pairResults = profile.pairs.map((pair) => ({
      pair,
      status: 'blocked',
      reason: 'governor_paused',
      detail: governorProfile.reason,
    }));
    return result;
  }
  if (isGlobalSafeMode() || isSafeMode()) {
    result.blocked = true;
    result.blockReason = 'safe_mode';
    result.pairResults = profile.pairs.map((pair) => ({
      pair,
      status: 'blocked',
      reason: 'safe_mode',
      detail: 'global or reconciliation safe mode active',
    }));
    return result;
  }

  const risk = getGlobalRiskDiagnostics();
  if (risk.band === 'CRITICAL' || risk.band === 'HIGH_RISK') {
    logEvent({
      category: CATEGORY.RISK,
      severity: SEVERITY.WARNING,
      subsystem: profile.agentId,
      reason: `FUTURES BREAKOUT PAUSED - risk band ${risk.band}`,
      metadata: { profile: profile.id, side: profile.sideLabel },
    });
    result.blocked = true;
    result.blockReason = `risk_band_${risk.band}`;
    result.pairResults = profile.pairs.map((pair) => ({
      pair,
      status: 'blocked',
      reason: 'risk_blocked',
      detail: `risk band ${risk.band}`,
    }));
    return result;
  }

  for (const pair of profile.pairs) {
    result.scanned++;
    let klines;
    try {
      klines = await fetchKlines(pair, { days: DAYS, interval: profile.interval ?? '4h' });
    } catch (err) {
      result.pairResults.push({
        pair,
        status: 'skipped',
        reason: 'data_fetch_failed',
        detail: err.message,
      });
      logEvent({
        category: CATEGORY.SCAN,
        severity: SEVERITY.INFO,
        subsystem: profile.agentId,
        reason: `FUTURES BREAKOUT data fetch failed ${pair}: ${err.message}`,
        metadata: { pair, profile: profile.id },
      });
      continue;
    }

    const closedKlines = klines.length > 1 ? klines.slice(0, -1) : klines;
    if (closedKlines.length < REGIME_SMA + 5) {
      result.skipped++;
      result.pairResults.push({
        pair,
        status: 'skipped',
        reason: 'insufficient_history',
        detail: `need ${REGIME_SMA + 5} closed bars, got ${closedKlines.length}`,
      });
      continue;
    }

    const closes = closedKlines.map((kline) => parseFloat(kline[4]));
    const barTime = closedKlines[closedKlines.length - 1][0];
    const signalParams = { breakoutPeriod: BREAKOUT_PERIOD, regimeSmaPeriod: REGIME_SMA };
    const signal = profile.signalFn({ closes }, signalParams);
    if (signal.action !== 'TRADE') {
      result.skipped++;
      result.pairResults.push({
        pair,
        status: 'skipped',
        reason: signal.reasons?.[0] ?? 'no_signal',
        detail: signal.reasons?.join(', ') ?? 'signal did not qualify',
      });
      continue;
    }

    const dedupeKey = key(profile.id, pair);
    if (_lastEntryBar.get(dedupeKey) === barTime) {
      result.skipped++;
      result.pairResults.push({
        pair,
        status: 'skipped',
        reason: 'duplicate_bar',
        detail: 'entry already attempted on this closed 4h bar',
      });
      continue;
    }
    if (hasOpenPosition(pair, profile.tradeType)) {
      result.skipped++;
      result.pairResults.push({
        pair,
        status: 'skipped',
        reason: 'position_open',
        detail: 'open position already exists for this profile',
      });
      continue;
    }

    const price = await getCurrentPrice(pair);
    if (price == null) {
      result.skipped++;
      result.pairResults.push({
        pair,
        status: 'skipped',
        reason: 'price_unavailable',
        detail: 'live mark price unavailable',
      });
      continue;
    }

    result.qualified++;
    const asset = { symbol: pair.replace('USDT', ''), pair, price, volume24h: quoteVolume24h(closedKlines) };
    const evidence = [...(signal.reasons ?? []), `SMA${REGIME_SMA}`, `DONCHIAN${BREAKOUT_PERIOD}`, `${profile.sideLabel}_ONLY`];
    const capitalMultiplier = governorProfile?.capitalMultiplier ?? 1;
    const leverageMultiplier = governorProfile?.leverageMultiplier ?? 1;
    const leverage = Math.max(1, Math.round((profile.leverage * leverageMultiplier) * 100) / 100);
    const capitalUsed = Math.round(((profile.maxMargin ?? MAX_MARGIN) * capitalMultiplier) * 100) / 100;
    const execution = await openCryptoFuturesPosition({
      asset,
      side: signal.side,
      confidence: signal.confidence ?? 0.75,
      capitalUsed,
      leverage,
      reason: `Futures regime-switch breakout ${signal.side}: ${evidence.join(', ')}${governorProfile?.mode === 'degraded' ? ` | governor:${governorProfile.reason}` : ''}`,
      evidence,
      agentId: profile.agentId,
      tradeType: profile.tradeType,
      targetPct: TP_PCT,
      stopPct: SL_PCT,
      timeoutHours: profile.timeoutHours ?? TIMEOUT_HOURS,
    });

    if (execution.executed) {
      _lastEntryBar.set(dedupeKey, barTime);
      result.executed++;
      result.pairResults.push({
        pair,
        status: 'executed',
        reason: 'trade_opened',
        detail: evidence.join(', '),
        side: signal.side,
        price,
        governorMode: governorProfile?.mode ?? 'active',
      });
      console.log(`[futuresBreakout] ${profile.id} ${signal.side} ${pair} @ $${price.toFixed(2)} | tf ${profile.interval} | lev ${leverage}x | cap $${capitalUsed.toFixed(2)} | TP ${(TP_PCT * 100).toFixed(0)}% / SL ${(SL_PCT * 100).toFixed(0)}%`);
    } else {
      result.skipped++;
      result.pairResults.push({
        pair,
        status: 'skipped',
        reason: 'execution_rejected',
        detail: 'paper execution engine rejected the setup',
        side: signal.side,
        price,
      });
    }
  }

  return result;
}

export async function runFuturesBreakoutCycle() {
  const startedAt = new Date().toISOString();
  const governor = getFuturesGovernorSnapshot();
  const governorJournal = syncFuturesGovernorJournal(governor);
  const governorMap = Object.fromEntries(governor.profiles.map((profile) => [profile.id, profile]));
  const perProfile = [];
  for (const profile of PROFILES) perProfile.push(await runProfile(profile, governorMap[profile.id]));
  const summary = perProfile.reduce((acc, item) => ({
    scanned: acc.scanned + item.scanned,
    qualified: acc.qualified + item.qualified,
    executed: acc.executed + item.executed,
    skipped: acc.skipped + item.skipped,
    blocked: acc.blocked || item.blocked,
    profiles: [...acc.profiles, item],
  }), { scanned: 0, qualified: 0, executed: 0, skipped: 0, blocked: false, profiles: [] });
  _lastCycle = {
    ...summary,
    governor,
    governorJournal,
    startedAt,
    completedAt: new Date().toISOString(),
  };
  persistCycleSummary(_lastCycle);
  return _lastCycle;
}
