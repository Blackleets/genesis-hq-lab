// scalpingEngine.mjs — FAST_ALPHA engine. Crypto scalping on 5-second cadence.
//
// Markets: BTC, ETH, SOL (and any configured via CRYPTO_ASSETS)
// Timeframe: 1m candles (360 candles = 6h of data)
//
// Signal logic:
//   EMA9 / EMA21 crossover direction
//   RSI momentum (not overbought/oversold against direction)
//   Volume spike (current volume > avg * threshold)
//   Volatility filter (ATR-proxy: price change must be meaningful)
//
// Entry gates:
//   confidence >= 0.70
//   global risk NOT CRITICAL
//   safe mode = false
//   no open position for this asset
//
// Exit targets (configurable via SCALP_TP_PCT / SCALP_SL_PCT):
//   TP: 0.20%–0.80% from entry
//   SL: 0.15%–0.35% from entry

import { getAssetContexts, computeEma, computeRsi } from '../crypto/priceFeeder.mjs';
import { openCryptoPosition, hasOpenPosition } from '../trading/paperExecutionEngine.mjs';
import { isGlobalSafeMode, getGlobalRiskDiagnostics } from '../risk/globalRiskEngine.mjs';
import { isSafeMode } from '../memory/reconciliationEngine.mjs';
import { logEvent, CATEGORY, SEVERITY } from '../observability/eventTimeline.mjs';
import { isDeptActive } from '../command/orgState.mjs';

const AGENT_ID    = 'scalping-engine-1';
const TRADE_TYPE  = 'scalp_v2';

// TP/SL from env or defaults
const TP_PCT = parseFloat(process.env.SCALP_TP_PCT ?? '0.004');   // 0.4% default
const SL_PCT = parseFloat(process.env.SCALP_SL_PCT ?? '0.002');   // 0.2% default
const MIN_CONFIDENCE = parseFloat(process.env.SCALP_MIN_CONF ?? '0.70');
const MAX_CAPITAL_PER_TRADE = parseFloat(process.env.SCALP_MAX_CAPITAL ?? '200'); // $200 max per scalp
const TIMEOUT_HOURS = parseFloat(process.env.SCALP_TIMEOUT_H ?? '2');

const TRAINING_MODE = ['1', 'true', 'yes'].includes((process.env.TRAINING_MODE ?? '').toLowerCase());

// ── Signal scoring ────────────────────────────────────────────────────────────

/**
 * Evaluate a scalping signal from asset context (1m candles).
 * Returns { action: 'TRADE'|'WAIT', side: 'LONG'|'SHORT', confidence, signals }
 */
export function evaluateScalpSignal(ctx) {
  const { closes, ema9, ema21, rsi14, volume24h, change1h, symbol } = ctx;

  const signals = [];
  let longScore  = 0;
  let shortScore = 0;

  // ── Signal 1: EMA9 / EMA21 crossover ──
  const emaSeparation = Math.abs(ema9 - ema21) / ema21;
  if (ema9 > ema21 * 1.0005) {
    longScore += 30;
    signals.push('EMA_BULL_CROSS');
  } else if (ema9 < ema21 * 0.9995) {
    shortScore += 30;
    signals.push('EMA_BEAR_CROSS');
  }

  // ── Signal 2: RSI momentum (not extreme in wrong direction) ──
  if (rsi14 >= 45 && rsi14 <= 70) {
    longScore += 20;
    signals.push('RSI_BULL_MOMENTUM');
  } else if (rsi14 >= 30 && rsi14 <= 55) {
    shortScore += 20;
    signals.push('RSI_BEAR_MOMENTUM');
  }
  // Extreme RSI: reversal signal
  if (rsi14 > 75) {
    shortScore += 10;
    signals.push('RSI_OVERBOUGHT');
  } else if (rsi14 < 25) {
    longScore += 10;
    signals.push('RSI_OVERSOLD');
  }

  // ── Signal 3: Volume spike (recent volume > 3-period avg) ──
  if (closes.length >= 10) {
    const recentVols = closes.slice(-5).map((c, i, arr) => i > 0 ? Math.abs(c - arr[i-1]) : 0);
    const avgVol = recentVols.slice(0, -1).reduce((a, b) => a + b, 0) / (recentVols.length - 1);
    const lastVol = recentVols[recentVols.length - 1];
    if (avgVol > 0 && lastVol > avgVol * 1.5) {
      const dominant = longScore >= shortScore ? 'long' : 'short';
      if (dominant === 'long') { longScore += 15; signals.push('VOLUME_SPIKE_BULL'); }
      else { shortScore += 15; signals.push('VOLUME_SPIKE_BEAR'); }
    }
  }

  // ── Signal 4: Trend continuation (1h change aligns with EMA direction) ──
  if (change1h > 0.3 && ema9 > ema21) {
    longScore += 10;
    signals.push('TREND_CONTINUATION_BULL');
  } else if (change1h < -0.3 && ema9 < ema21) {
    shortScore += 10;
    signals.push('TREND_CONTINUATION_BEAR');
  }

  // ── Signal 5: Volatility filter (minimum price movement) ──
  const priceMove = Math.abs(change1h);
  if (priceMove < 0.05) {
    // Market too quiet for scalping
    return { action: 'WAIT', side: null, confidence: 0, signals: [...signals, 'LOW_VOLATILITY'], score: 0 };
  }
  if (priceMove > 3.0) {
    // Market too violent — gap risk
    return { action: 'WAIT', side: null, confidence: 0, signals: [...signals, 'HIGH_VOLATILITY_BLOCK'], score: 0 };
  }

  const bestScore = Math.max(longScore, shortScore);
  const side = longScore >= shortScore ? 'LONG' : 'SHORT';

  // Require minimum confluence: at least 2 signals + score > 45
  const signalCount = signals.filter(s => !s.includes('VOLUME') || s.includes('SPIKE')).length;
  if (bestScore < 45 || signalCount < 2) {
    return { action: 'WAIT', side: null, confidence: 0, signals, score: bestScore };
  }

  // Convert score to confidence (45-85 maps to 0.65-0.92)
  const confidence = Math.min(0.92, 0.65 + (bestScore - 45) / 100);

  if (TRAINING_MODE) {
    console.log(`[scalping][TRAINING] ${symbol}: ${side} score=${bestScore} conf=${(confidence*100).toFixed(0)}% signals=[${signals.join(',')}]`);
  }

  return { action: 'TRADE', side, confidence, signals, score: bestScore };
}

// ── Main cycle ────────────────────────────────────────────────────────────────

/**
 * Run one scalping cycle. Called by executionScheduler on the FAST (5s) loop.
 * Returns { scanned, qualified, executed, skipped }
 */
export async function runScalpingCycle() {
  const result = { scanned: 0, qualified: 0, executed: 0, skipped: 0, blocked: false };

  // Safety gates
  if (isGlobalSafeMode() || isSafeMode()) {
    logEvent({ category: CATEGORY.EXECUTION, severity: SEVERITY.WARNING, subsystem: AGENT_ID, reason: 'SCALPING BLOCKED — safe mode' });
    result.blocked = true;
    return result;
  }

  if (!isDeptActive('crypto_scalping')) {
    return result;
  }

  // Risk gate: skip if system risk is CRITICAL
  const risk = getGlobalRiskDiagnostics();
  if (risk.band === 'CRITICAL') {
    logEvent({ category: CATEGORY.RISK, severity: SEVERITY.WARNING, subsystem: AGENT_ID, reason: `SCALPING PAUSED — risk band CRITICAL (${risk.score}/100)` });
    return result;
  }

  // Fetch live price contexts
  let assets;
  try {
    assets = await getAssetContexts();
  } catch {
    return result;
  }

  result.scanned = assets.length;

  for (const asset of assets) {
    // Operator visibility: log what we're scanning
    if (result.scanned > 0) {
      logEvent({ category: CATEGORY.SCAN, severity: SEVERITY.INFO, subsystem: AGENT_ID,
        reason: `SCANNING ${asset.symbol} @ $${asset.price.toFixed(2)} | RSI ${asset.rsi14} | trend ${asset.trend}`,
        metadata: { symbol: asset.symbol, price: asset.price, rsi: asset.rsi14 } });
    }

    const signal = evaluateScalpSignal(asset);

    if (signal.action !== 'TRADE') {
      result.skipped++;
      continue;
    }

    if (signal.confidence < MIN_CONFIDENCE) {
      logEvent({ category: CATEGORY.SCAN, severity: SEVERITY.INFO, subsystem: AGENT_ID,
        reason: `${asset.symbol}: signal ${signal.side} but conf ${(signal.confidence*100).toFixed(0)}% < ${(MIN_CONFIDENCE*100).toFixed(0)}% gate` });
      result.skipped++;
      continue;
    }

    // Duplicate check
    if (hasOpenPosition(asset.pair, TRADE_TYPE)) {
      logEvent({ category: CATEGORY.SCAN, severity: SEVERITY.INFO, subsystem: AGENT_ID,
        reason: `${asset.symbol}: SKIP — position already open` });
      result.skipped++;
      continue;
    }

    result.qualified++;

    // Risk gate: HIGH_RISK → reduce size; don't trade if CRITICAL (already checked above)
    const capitalMultiplier = risk.band === 'HIGH_RISK' ? 0.5 : 1.0;
    const capitalUsed = Math.min(MAX_CAPITAL_PER_TRADE * capitalMultiplier, 200);

    const execution = await openCryptoPosition({
      asset,
      side: signal.side,
      confidence: signal.confidence,
      capitalUsed,
      reason: `Scalp ${signal.side} on ${signal.signals.join('+')} | RSI ${asset.rsi14} | EMA sep ${((Math.abs(asset.ema9 - asset.ema21) / asset.ema21) * 100).toFixed(2)}%`,
      evidence: signal.signals,
      agentId: AGENT_ID,
      tradeType: TRADE_TYPE,
      targetPct: TP_PCT,
      stopPct: SL_PCT,
      timeoutHours: TIMEOUT_HOURS,
    });

    if (execution.executed) {
      result.executed++;
      console.log(`[scalpingEngine] ✓ ${signal.side} ${asset.symbol} @ $${asset.price.toFixed(2)} | conf ${(signal.confidence*100).toFixed(0)}%`);
    }
  }

  return result;
}
