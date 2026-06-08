// breakoutEngine.mjs — LIVE PAPER engine for the regime-switch breakout strategy.
//
// This is the first strategy with a validated edge: regimeSwitchBreakoutSignal passed
// multi-window walk-forward (positive EV & PF>1 in 6/6 windows; see breakoutWalkForward.mjs)
// and a live shadow (breakoutShadow.mjs). This engine promotes it from observation to LIVE
// PAPER execution, opening positions through the EXISTING paperExecutionEngine — exactly like
// swingEngine. It NEVER touches the execution engine, risk engine, Kelly sizing, safe mode, or
// the close path; it only calls the public openCryptoPosition() API.
//
// Cadence: driven by the scheduler SLOW loop (5 min). It acts on the latest CLOSED 4h bar and
// opens at most one position per pair per bar; exits are handled by positionMonitor via the
// position's TP/SL/timeout (breakout_v1 is exempt from the 1m momentum-collapse check, which
// would otherwise close a 4h trade on intrabar noise and break the validated edge).

import { fetchKlines } from '../crypto/backtest/historicalData.mjs';
import { regimeSwitchBreakoutSignal } from '../crypto/backtest/strategyLab.mjs';
import { getCurrentPrice } from '../crypto/priceFeeder.mjs';
import { openCryptoPosition, hasOpenPosition } from '../trading/paperExecutionEngine.mjs';
import { isGlobalSafeMode, getGlobalRiskDiagnostics } from '../risk/globalRiskEngine.mjs';
import { isSafeMode } from '../memory/reconciliationEngine.mjs';
import { logEvent, CATEGORY, SEVERITY } from '../observability/eventTimeline.mjs';

const AGENT_ID   = 'breakout-engine-1';
const TRADE_TYPE = 'breakout_v1';

// Validated config (matches breakoutShadow / the walk-forward winner).
const PAIRS           = (process.env.BREAKOUT_PAIRS ?? 'BTCUSDT,ETHUSDT,SOLUSDT').split(',');
const BREAKOUT_PERIOD = parseInt(process.env.BREAKOUT_PERIOD ?? '55', 10);
const REGIME_SMA      = parseInt(process.env.BREAKOUT_SMA ?? '200', 10);
const TP_PCT          = parseFloat(process.env.BREAKOUT_TP_PCT ?? '0.08');
const SL_PCT          = parseFloat(process.env.BREAKOUT_SL_PCT ?? '0.03');
const TIMEOUT_HOURS   = parseInt(process.env.BREAKOUT_TIMEOUT_H ?? '240', 10);
const MAX_CAPITAL     = parseFloat(process.env.BREAKOUT_MAX_CAPITAL ?? '300');
const DAYS            = parseInt(process.env.BREAKOUT_DAYS ?? '90', 10); // enough for SMA200 + breakout window
const ENABLED         = !['0', 'false', 'no', 'off'].includes((process.env.BREAKOUT_ENGINE_ENABLED ?? 'true').toLowerCase());

// In-memory dedup: the latest CLOSED bar we've already acted on, per pair. Avoids re-entering
// on the same stale signalling bar after a position closes.
const _lastEntryBar = new Map();

/** Effective config (for diagnostics/tests). */
export function breakoutEngineConfig() {
  return { enabled: ENABLED, pairs: [...PAIRS], breakoutPeriod: BREAKOUT_PERIOD, regimeSmaPeriod: REGIME_SMA,
    tpPct: TP_PCT, slPct: SL_PCT, timeoutHours: TIMEOUT_HOURS, maxCapital: MAX_CAPITAL, tradeType: TRADE_TYPE };
}

function quoteVolume24h(klines) {
  // Sum quote-asset volume over the last 6 4h bars ≈ 24h.
  const last = klines.slice(-6);
  return last.reduce((s, k) => s + (parseFloat(k[7]) || 0), 0);
}

/**
 * Run one breakout cycle. Called by executionScheduler on the SLOW (5 min) loop.
 * Returns { scanned, qualified, executed, skipped, blocked }.
 */
export async function runBreakoutCycle() {
  const result = { scanned: 0, qualified: 0, executed: 0, skipped: 0, blocked: false };

  if (!ENABLED) return result;
  if (isGlobalSafeMode() || isSafeMode()) { result.blocked = true; return result; }

  const risk = getGlobalRiskDiagnostics();
  if (risk.band === 'CRITICAL' || risk.band === 'HIGH_RISK') {
    logEvent({ category: CATEGORY.RISK, severity: SEVERITY.WARNING, subsystem: AGENT_ID, reason: `BREAKOUT PAUSED — risk band ${risk.band}` });
    return result;
  }

  for (const pair of PAIRS) {
    result.scanned++;
    let klines;
    try {
      klines = await fetchKlines(pair, { days: DAYS, interval: '4h' });
    } catch (err) {
      logEvent({ category: CATEGORY.SCAN, severity: SEVERITY.INFO, subsystem: AGENT_ID, reason: `BREAKOUT data fetch failed ${pair}: ${err.message}` });
      continue;
    }
    // Only evaluate CLOSED candles.
    const closedKlines = klines.length > 1 ? klines.slice(0, -1) : klines;
    if (closedKlines.length < REGIME_SMA + 5) { result.skipped++; continue; }

    const closes = closedKlines.map(c => parseFloat(c[4]));
    const barTime = closedKlines[closedKlines.length - 1][0];

    const sig = regimeSwitchBreakoutSignal({ closes }, { breakoutPeriod: BREAKOUT_PERIOD, regimeSmaPeriod: REGIME_SMA });
    if (sig.action !== 'TRADE') { result.skipped++; continue; }

    // One entry per pair per bar; never duplicate an open breakout position.
    if (_lastEntryBar.get(pair) === barTime) { result.skipped++; continue; }
    if (hasOpenPosition(pair, TRADE_TYPE))    { result.skipped++; continue; }

    const price = await getCurrentPrice(pair);
    if (price == null) { result.skipped++; continue; }

    result.qualified++;
    const asset = { symbol: pair.replace('USDT', ''), pair, price, volume24h: quoteVolume24h(closedKlines) };
    const evidence = [...(sig.reasons ?? []), `SMA${REGIME_SMA}`, `DONCHIAN${BREAKOUT_PERIOD}`];

    const execution = await openCryptoPosition({
      asset,
      side: sig.side,
      confidence: sig.confidence ?? 0.75,
      capitalUsed: MAX_CAPITAL,
      reason: `Regime-switch breakout ${sig.side}: ${evidence.join(', ')}`,
      evidence,
      agentId: AGENT_ID,
      tradeType: TRADE_TYPE,
      targetPct: TP_PCT,
      stopPct: SL_PCT,
      timeoutHours: TIMEOUT_HOURS,
    });

    if (execution.executed) {
      _lastEntryBar.set(pair, barTime);
      result.executed++;
      console.log(`[breakoutEngine] ✓ ${sig.side} ${pair} @ $${price.toFixed(2)} | TP ${(TP_PCT*100).toFixed(0)}% / SL ${(SL_PCT*100).toFixed(0)}% | ${sig.reasons?.join(',')}`);
    } else {
      result.skipped++;
    }
  }

  return result;
}
