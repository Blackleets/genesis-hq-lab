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
import { classifyRegime, applyRegimeBias } from '../crypto/regime.mjs';
import {
  isSetupVetoed,
  confidenceCap,
  isHourBlocked,
  isConfidenceBandBlocked,
  isPairBlocked,
  hourBucket,
  confidenceBand,
  shouldPauseScalpEntriesForNegativeEdge,
} from '../crypto/autoVeto.mjs';
import { getFatigueState, applyFatigueToConfidence } from '../intelligence/setupFatigue.mjs';

const AGENT_ID    = 'scalping-engine-1';
const TRADE_TYPE  = 'scalp_v2';

// TP/SL from env or defaults
const TP_PCT = parseFloat(process.env.SCALP_TP_PCT ?? '0.004');   // 0.4% default
const SL_PCT = parseFloat(process.env.SCALP_SL_PCT ?? '0.002');   // 0.2% default
// Training-mode gate: 0.65 matches the engine's confidence FLOOR (evaluateScalpSignal
// returns 0.65 at the minimum qualifying score). A higher gate would reject every
// borderline-but-valid signal and starve training. See trainingTuning.test.mjs.
const MIN_CONFIDENCE = parseFloat(process.env.SCALP_MIN_CONF ?? '0.65');
const MAX_CAPITAL_PER_TRADE = parseFloat(process.env.SCALP_MAX_CAPITAL ?? '200'); // $200 max per scalp
const TIMEOUT_HOURS = parseFloat(process.env.SCALP_TIMEOUT_H ?? '2');
const EDGE_PAUSE_ENFORCED = !['0', 'false', 'no', 'off'].includes((process.env.SCALP_ENFORCE_EDGE_PAUSE ?? 'true').toLowerCase());

/** Effective scalp engine config (used by diagnostics + tuning tests). */
export function scalpConfig() {
  return {
    minConfidence: MIN_CONFIDENCE,
    tpPct: TP_PCT,
    slPct: SL_PCT,
    maxCapital: MAX_CAPITAL_PER_TRADE,
    timeoutHours: TIMEOUT_HOURS,
    edgePauseEnforced: EDGE_PAUSE_ENFORCED,
  };
}

// ── Live scan snapshot (operator "why no trade" — reuses the 5s loop's work) ───
// Populated every runScalpingCycle so the diagnostics endpoint can expose per-asset
// status WITHOUT any extra Binance fetch or polling.
let _lastScanSnapshot = { at: null, assets: [] };

/** The four scalp confluences, in human terms, and the signal codes that satisfy each. */
const CONFLUENCES = [
  { label: 'EMA trend',              codes: ['EMA_BULL_CROSS', 'EMA_BEAR_CROSS'] },
  { label: 'RSI momentum',           codes: ['RSI_BULL_MOMENTUM', 'RSI_BEAR_MOMENTUM', 'RSI_OVERBOUGHT', 'RSI_OVERSOLD'] },
  { label: 'volume confirmation',    codes: ['VOLUME_SPIKE_BULL', 'VOLUME_SPIKE_BEAR'] },
  { label: 'momentum continuation',  codes: ['TREND_CONTINUATION_BULL', 'TREND_CONTINUATION_BEAR'] },
];

/** Confluences that did NOT fire for this signal — what the operator is "waiting on". */
function missingConfluences(signals) {
  const fired = new Set(signals);
  return CONFLUENCES.filter(c => !c.codes.some(code => fired.has(code))).map(c => c.label);
}

/** Coarse rejection reason from a signal evaluation + gate outcome. */
function rejectReasonFor(signal, gate, gatePass, positionOpen) {
  if (positionOpen) return 'POSITION_OPEN';
  if (signal.action === 'TRADE') {
    if (gatePass) return 'ACCEPTED';
    if (signal.blockedByHour) return 'HOUR_VETOED';
    if (signal.blockedByPair) return 'PAIR_VETOED';
    if (signal.blockedByConfidenceBand) return 'CONFIDENCE_BAND_VETOED';
    if (signal.vetoed) return 'SETUP_VETOED';
    // Did the regime bias push a would-be-valid signal below the gate?
    if ((signal.bias ?? 0) < 0 && (signal.rawConfidence ?? 0) >= gate) return 'REGIME_MISMATCH';
    return 'LOW_CONFIDENCE';
  }
  if (signal.signals.includes('LOW_VOLATILITY'))         return 'LOW_VOLATILITY';
  if (signal.signals.includes('HIGH_VOLATILITY_BLOCK'))  return 'HIGH_VOLATILITY';
  return 'NO_EDGE';
}

export function getLastScanSnapshot() {
  return _lastScanSnapshot;
}

export function applyManualContextBlocks(signal, asset, openedAt = new Date().toISOString()) {
  if (signal.action !== 'TRADE') return signal;
  const preBlockConfidence = signal.confidence;
  const blockedByHour = isHourBlocked(openedAt);
  const blockedByPair = isPairBlocked(asset?.pair);
  const blockedByConfidenceBand = isConfidenceBandBlocked(preBlockConfidence);
  if (!blockedByHour && !blockedByPair && !blockedByConfidenceBand) {
    return {
      ...signal,
      blockedByHour,
      blockedByPair,
      blockedByConfidenceBand,
      hour: hourBucket(openedAt),
      confidenceBand: confidenceBand(preBlockConfidence),
    };
  }
  return {
    ...signal,
    confidence: Math.min(preBlockConfidence, 0.40),
    vetoed: true,
    blockedByHour,
    blockedByPair,
    blockedByConfidenceBand,
    hour: hourBucket(openedAt),
    confidenceBand: confidenceBand(preBlockConfidence),
  };
}

const TRAINING_MODE = ['1', 'true', 'yes'].includes((process.env.TRAINING_MODE ?? '').toLowerCase());

// ── Signal scoring ────────────────────────────────────────────────────────────

/**
 * Evaluate a scalping signal from asset context (1m candles).
 * Returns { action: 'TRADE'|'WAIT', side: 'LONG'|'SHORT', confidence, signals }
 */
export function evaluateScalpSignal(ctx) {
  const { closes, ema9, ema21, rsi14, volume24h, change1h, symbol } = ctx;

  // Phase 6B.1: regime is derived from the same ctx and attached to every return
  // so the operator/snapshot always sees it (even on WAIT).
  const regime = classifyRegime(ctx);

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
    return { action: 'WAIT', side: null, confidence: 0, signals: [...signals, 'LOW_VOLATILITY'], score: 0, regime, bias: 0, rawConfidence: 0 };
  }
  if (priceMove > 3.0) {
    // Market too violent — gap risk
    return { action: 'WAIT', side: null, confidence: 0, signals: [...signals, 'HIGH_VOLATILITY_BLOCK'], score: 0, regime, bias: 0, rawConfidence: 0 };
  }

  const bestScore = Math.max(longScore, shortScore);
  const side = longScore >= shortScore ? 'LONG' : 'SHORT';

  // Require minimum confluence: at least 2 signals + score > 45
  const signalCount = signals.filter(s => !s.includes('VOLUME') || s.includes('SPIKE')).length;
  if (bestScore < 45 || signalCount < 2) {
    return { action: 'WAIT', side: null, confidence: 0, signals, score: bestScore, regime, bias: 0, rawConfidence: 0 };
  }

  // Convert score to confidence (45-85 maps to 0.65-0.92)
  const rawConfidence = Math.min(0.92, 0.65 + (bestScore - 45) / 100);

  // Phase 6B.1: soft directional regime bias on the confidence (never hard-blocks).
  const adjusted = applyRegimeBias(rawConfidence, side, regime);
  let confidence = adjusted.confidence;

  // Phase 6B.1A: confidence honesty — cap at the setup's historical win-rate band.
  const cap = confidenceCap(side, regime);
  const capped = cap < confidence;
  if (capped) confidence = cap;

  // Phase 6B.1A: adaptive auto-veto — a proven-losing setup is pushed below the gate.
  // This is a CONFIDENCE gate only; risk/execution/safe-mode are untouched.
  const vetoed = isSetupVetoed(side, regime);
  if (vetoed) confidence = Math.min(confidence, 0.40);

  // Phase 6B.1B: setup fatigue — modulate confidence by rolling health score.
  // Only applied when not already vetoed (veto is the harder gate).
  const fatigueState = getFatigueState(symbol, side, regime);
  if (!vetoed) confidence = applyFatigueToConfidence(confidence, fatigueState);

  if (TRAINING_MODE) {
    const fatBand = fatigueState.band !== 'NEUTRAL' ? ` [${fatigueState.band} ×${fatigueState.confidenceMultiplier}]` : '';
    console.log(`[scalping][TRAINING] ${symbol}: ${side} score=${bestScore} regime=${regime} conf=${(rawConfidence*100).toFixed(0)}%→${(confidence*100).toFixed(0)}%${vetoed ? ' [VETOED]' : capped ? ' [capped]' : ''}${fatBand} signals=[${signals.join(',')}]`);
  }

  const fatigue = { band: fatigueState.band, healthScore: fatigueState.healthScore, confidenceMultiplier: fatigueState.confidenceMultiplier, consecutiveLosses: fatigueState.consecutiveLosses };
  return { action: 'TRADE', side, confidence, signals, score: bestScore, regime, bias: adjusted.bias, rawConfidence, capped, vetoed, fatigue };
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

  if (EDGE_PAUSE_ENFORCED) {
    const edgePause = shouldPauseScalpEntriesForNegativeEdge();
    if (edgePause.pause) {
      logEvent({
        category: CATEGORY.RISK,
        severity: SEVERITY.WARNING,
        subsystem: AGENT_ID,
        reason: 'SCALPING PAUSED - negative edge recommendation',
        metadata: edgePause,
      });
      result.blocked = true;
      return result;
    }
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
  const snapshot = [];

  for (const asset of assets) {
    // Operator visibility: log what we're scanning
    if (result.scanned > 0) {
      logEvent({ category: CATEGORY.SCAN, severity: SEVERITY.INFO, subsystem: AGENT_ID,
        reason: `SCANNING ${asset.symbol} @ $${asset.price.toFixed(2)} | RSI ${asset.rsi14} | trend ${asset.trend}`,
        metadata: { symbol: asset.symbol, price: asset.price, rsi: asset.rsi14 } });
    }

    const openedAt = new Date().toISOString();
    const signal = applyManualContextBlocks(evaluateScalpSignal(asset), asset, openedAt);
    const positionOpen = hasOpenPosition(asset.pair, TRADE_TYPE);
    const gatePass = signal.action === 'TRADE' && signal.confidence >= MIN_CONFIDENCE;

    // Per-asset snapshot for the operator "why no trade" explainer (no extra fetch)
    snapshot.push({
      symbol:     asset.symbol,
      price:      Math.round(asset.price * 100) / 100,
      rsi:        asset.rsi14,
      action:     signal.action,
      side:       signal.side,
      confidence: Math.round(signal.confidence * 100),
      rawConfidence: Math.round((signal.rawConfidence ?? signal.confidence) * 100),
      gate:       Math.round(MIN_CONFIDENCE * 100),
      score:      signal.score,
      signals:    signal.signals,
      missing:    missingConfluences(signal.signals),
      regime:     signal.regime ?? 'RANGE',
      bias:       signal.bias ?? 0,
      hour:       signal.hour ?? hourBucket(openedAt),
      confidenceBand: signal.confidenceBand ?? confidenceBand(signal.rawConfidence ?? signal.confidence),
      blockedByHour: signal.blockedByHour ?? false,
      blockedByPair: signal.blockedByPair ?? false,
      blockedByConfidenceBand: signal.blockedByConfidenceBand ?? false,
      reason:     rejectReasonFor(signal, MIN_CONFIDENCE, gatePass, positionOpen),
    });

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
    if (positionOpen) {
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
      reason: `Scalp ${signal.side} on ${signal.signals.join('+')} | ${signal.regime} | RSI ${asset.rsi14} | EMA sep ${((Math.abs(asset.ema9 - asset.ema21) / asset.ema21) * 100).toFixed(2)}%`,
      evidence: [...signal.signals, `REGIME:${signal.regime}`],
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

  _lastScanSnapshot = { at: new Date().toISOString(), assets: snapshot };
  return result;
}
