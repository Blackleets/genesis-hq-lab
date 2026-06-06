// swingEngine.mjs — SWING engine. Multi-timeframe crypto swing trades.
//
// Timeframes: 1m (resampled to 15m/1h/4h)
// Assets:     BTC, ETH, SOL
// Entry:      confidence >= 0.80 (stricter than scalping)
// TP:         3%–8% from entry
// SL:         1%–2% from entry
// Hold:       4–24h (longer holds than scalping)
//
// Signal requires ALL 3 timeframes to agree on direction.
// This makes swing entries rare but high-quality.

import { getAssetContexts, computeEma, computeRsi } from '../crypto/priceFeeder.mjs';
import { openCryptoPosition, hasOpenPosition } from '../trading/paperExecutionEngine.mjs';
import { isGlobalSafeMode, getGlobalRiskDiagnostics } from '../risk/globalRiskEngine.mjs';
import { isSafeMode } from '../memory/reconciliationEngine.mjs';
import { logEvent, CATEGORY, SEVERITY } from '../observability/eventTimeline.mjs';
import { isDeptActive } from '../command/orgState.mjs';

const AGENT_ID   = 'swing-engine-1';
const TRADE_TYPE = 'swing_v1';

const TP_PCT = parseFloat(process.env.SWING_TP_PCT ?? '0.05');    // 5% default
const SL_PCT = parseFloat(process.env.SWING_SL_PCT ?? '0.015');   // 1.5% default
const MIN_CONFIDENCE = parseFloat(process.env.SWING_MIN_CONF ?? '0.80');
const MAX_CAPITAL_PER_TRADE = parseFloat(process.env.SWING_MAX_CAPITAL ?? '300'); // $300 max
const TIMEOUT_HOURS = parseFloat(process.env.SWING_TIMEOUT_H ?? '12');

const TRAINING_MODE = ['1', 'true', 'yes'].includes((process.env.TRAINING_MODE ?? '').toLowerCase());

// ── Resample 1m closes to N-minute bars ──────────────────────────────────────

function resampleCloses(closes1m, intervalMin) {
  const result = [];
  for (let i = intervalMin - 1; i < closes1m.length; i += intervalMin) {
    result.push(closes1m[i]);
  }
  return result;
}

// ── Multi-timeframe signal ────────────────────────────────────────────────────

/**
 * Evaluate swing signal across 15m, 1h, 4h timeframes derived from 1m closes.
 * Returns { action, side, confidence, signals, tfAlignment }
 */
export function evaluateSwingSignal(ctx) {
  const { closes, symbol, change1h, rsi14, price } = ctx;

  // Need enough 1m candles to derive all timeframes
  // 4h = 240 candles, 1h = 60, 15m = 15
  if (closes.length < 250) {
    return { action: 'WAIT', side: null, confidence: 0, signals: ['INSUFFICIENT_DATA'], tfAlignment: 0 };
  }

  // ── Derive EMA for each timeframe ──
  const closes15m = resampleCloses(closes, 15);
  const closes1h  = resampleCloses(closes, 60);
  const closes4h  = resampleCloses(closes, 240);

  const ema9_15m  = computeEma(closes15m, 9);
  const ema21_15m = computeEma(closes15m, 21);
  const ema9_1h   = computeEma(closes1h, 9);
  const ema21_1h  = computeEma(closes1h, 21);
  const ema9_4h   = computeEma(closes4h, 9);
  const ema21_4h  = computeEma(closes4h, 21);

  const rsi15m = computeRsi(closes15m, 14);
  const rsi1h  = computeRsi(closes1h,  14);

  // ── Timeframe direction votes ──
  const bull15m = ema9_15m > ema21_15m * 1.001;
  const bear15m = ema9_15m < ema21_15m * 0.999;
  const bull1h  = ema9_1h  > ema21_1h  * 1.001;
  const bear1h  = ema9_1h  < ema21_1h  * 0.999;
  const bull4h  = ema9_4h  > ema21_4h  * 1.001;
  const bear4h  = ema9_4h  < ema21_4h  * 0.999;

  const bullVotes = [bull15m, bull1h, bull4h].filter(Boolean).length;
  const bearVotes = [bear15m, bear1h, bear4h].filter(Boolean).length;

  // Require full alignment: all 3 timeframes must agree
  if (bullVotes < 3 && bearVotes < 3) {
    return { action: 'WAIT', side: null, confidence: 0, signals: ['NO_TF_ALIGNMENT'], tfAlignment: Math.max(bullVotes, bearVotes) };
  }

  const side = bullVotes === 3 ? 'LONG' : 'SHORT';
  const signals = [`TF_ALIGNED_${side}`];

  let score = 60; // base score for full alignment

  // ── RSI confirmation ──
  if (side === 'LONG' && rsi15m >= 40 && rsi15m <= 65) { score += 10; signals.push('RSI_15M_BULL_ZONE'); }
  if (side === 'LONG' && rsi1h  >= 40 && rsi1h  <= 65) { score += 10; signals.push('RSI_1H_BULL_ZONE'); }
  if (side === 'SHORT' && rsi15m >= 35 && rsi15m <= 60) { score += 10; signals.push('RSI_15M_BEAR_ZONE'); }
  if (side === 'SHORT' && rsi1h  >= 35 && rsi1h  <= 60) { score += 10; signals.push('RSI_1H_BEAR_ZONE'); }

  // ── Momentum confirmation via 1h price change ──
  if (side === 'LONG'  && change1h > 0.5) { score += 10; signals.push('1H_MOMENTUM_BULL'); }
  if (side === 'SHORT' && change1h < -0.5) { score += 10; signals.push('1H_MOMENTUM_BEAR'); }

  // Penalize if RSI is extreme against direction
  if (side === 'LONG'  && rsi14 > 78) { score -= 20; signals.push('RSI_OVERBOUGHT_PENALTY'); }
  if (side === 'SHORT' && rsi14 < 22) { score -= 20; signals.push('RSI_OVERSOLD_PENALTY'); }

  // Convert score to confidence (60-100 maps to 0.75-0.93)
  const confidence = Math.min(0.93, 0.75 + (score - 60) / 200);

  if (TRAINING_MODE) {
    console.log(`[swing][TRAINING] ${symbol}: ${side} score=${score} conf=${(confidence*100).toFixed(0)}% TF_align bull=${bullVotes} bear=${bearVotes}`);
  }

  return { action: 'TRADE', side, confidence, signals, score, tfAlignment: Math.max(bullVotes, bearVotes) };
}

// ── Main cycle ────────────────────────────────────────────────────────────────

/**
 * Run one swing cycle. Called by executionScheduler on the SLOW (5 min) loop.
 * Returns { scanned, qualified, executed }
 */
export async function runSwingCycle() {
  const result = { scanned: 0, qualified: 0, executed: 0, skipped: 0, blocked: false };

  if (isGlobalSafeMode() || isSafeMode()) {
    result.blocked = true;
    return result;
  }

  if (!isDeptActive('crypto_scalping')) {
    return result;
  }

  const risk = getGlobalRiskDiagnostics();
  if (risk.band === 'CRITICAL' || risk.band === 'HIGH_RISK') {
    logEvent({ category: CATEGORY.RISK, severity: SEVERITY.WARNING, subsystem: AGENT_ID, reason: `SWING PAUSED — risk band ${risk.band}` });
    return result;
  }

  let assets;
  try {
    assets = await getAssetContexts();
  } catch {
    return result;
  }

  result.scanned = assets.length;

  for (const asset of assets) {
    logEvent({ category: CATEGORY.SCAN, severity: SEVERITY.INFO, subsystem: AGENT_ID,
      reason: `ANALYZING SWING: ${asset.symbol} @ $${asset.price.toFixed(2)} | 1h change: ${asset.change1h > 0 ? '+' : ''}${asset.change1h}%`,
      metadata: { symbol: asset.symbol, price: asset.price, change1h: asset.change1h } });

    const signal = evaluateSwingSignal(asset);

    if (signal.action !== 'TRADE') {
      result.skipped++;
      continue;
    }

    if (signal.confidence < MIN_CONFIDENCE) {
      result.skipped++;
      continue;
    }

    // No duplicate swings per asset
    if (hasOpenPosition(asset.pair, TRADE_TYPE)) {
      result.skipped++;
      continue;
    }

    result.qualified++;

    const execution = await openCryptoPosition({
      asset,
      side: signal.side,
      confidence: signal.confidence,
      capitalUsed: MAX_CAPITAL_PER_TRADE,
      reason: `Swing ${signal.side}: all 3 TF aligned | ${signal.signals.join(', ')}`,
      evidence: signal.signals,
      agentId: AGENT_ID,
      tradeType: TRADE_TYPE,
      targetPct: TP_PCT,
      stopPct: SL_PCT,
      timeoutHours: TIMEOUT_HOURS,
    });

    if (execution.executed) {
      result.executed++;
      console.log(`[swingEngine] ✓ ${signal.side} ${asset.symbol} @ $${asset.price.toFixed(2)} | conf ${(signal.confidence*100).toFixed(0)}% | TF align: ${signal.tfAlignment}/3`);
    }
  }

  return result;
}
