// signal.mjs — the crypto entry rule. PURE and PARAMETERIZED so the live engine
// and the backtest use the EXACT same logic. This is the strategy's real edge:
// it requires confluence (trend + momentum + RSI + volume), not 0.1% noise.
//
// evaluateSignal(ctx, params) → { action:'TRADE'|'SKIP', side:'LONG'|'SHORT'|null, score, reasons[] }
//
// ctx is a priceFeeder asset context:
//   { price, change1h(%), volume24h, ema9, ema21, rsi14, ... }

import { DEFAULTS } from './strategyParams.mjs';
import { computeEma } from './priceFeeder.mjs';

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

/**
 * Higher-timeframe trend from 1m closes. Resamples the 1m series to `htfMinutes`
 * bars (every Nth close) and compares EMA fast vs slow. Pure — same in live and
 * backtest so the multi-timeframe filter is consistent. Returns 'bullish' |
 * 'bearish' | 'neutral'. Neutral when data is insufficient (never blocks).
 */
export function computeHtfTrend(closes, params = DEFAULTS) {
  const { htfMinutes, htfEmaFast, htfEmaSlow, htfMarginPct } = params;
  if (!Array.isArray(closes) || closes.length < htfEmaSlow * htfMinutes) return 'neutral';

  const htf = [];
  const need = htfEmaSlow * 3;
  for (let i = closes.length - 1; i >= 0 && htf.length < need; i -= htfMinutes) {
    htf.unshift(closes[i]);
  }
  if (htf.length < htfEmaSlow) return 'neutral';

  const fast = computeEma(htf, htfEmaFast);
  const slow = computeEma(htf, htfEmaSlow);
  if (fast >= slow * (1 + htfMarginPct)) return 'bullish';
  if (fast <= slow * (1 - htfMarginPct)) return 'bearish';
  return 'neutral';
}

export function evaluateSignal(ctx, params = DEFAULTS) {
  // ── Sanity: reject unusable data before deciding anything ──
  if (!ctx || !Number.isFinite(ctx.price) || ctx.price <= 0 ||
      !Number.isFinite(ctx.ema9) || !Number.isFinite(ctx.ema21) ||
      !Number.isFinite(ctx.rsi14) || !Number.isFinite(ctx.change1h)) {
    return { action: 'SKIP', side: null, score: 0, reasons: ['Invalid or missing market data'] };
  }

  // ── Hard gate: liquidity (shared by both strategies) ──
  if (!(ctx.volume24h >= params.minVolume24h)) {
    return {
      action: 'SKIP', side: null, score: 0,
      reasons: [`Volume $${Math.round(ctx.volume24h).toLocaleString()} below $${params.minVolume24h.toLocaleString()} floor`],
    };
  }

  // ── Strategy dispatch → { side, reasons, score } ──
  const decision = (params.strategy ?? 'momentum') === 'meanreversion'
    ? meanReversionSide(ctx, params)
    : momentumSide(ctx, params);

  if (!decision.side) {
    return { action: 'SKIP', side: null, score: 0, reasons: decision.reasons };
  }

  const { side, reasons, score } = decision;

  // ── Multi-timeframe filter: never trade against the higher-timeframe trend ──
  if (params.useHtfFilter) {
    const htf = computeHtfTrend(ctx.closes, params);
    if ((side === 'LONG' && htf === 'bearish') || (side === 'SHORT' && htf === 'bullish')) {
      return { action: 'SKIP', side: null, score: 0, reasons: [`Higher timeframe (${params.htfMinutes}m) is ${htf} — blocks ${side}`] };
    }
    if (htf !== 'neutral') reasons.push(`HTF ${params.htfMinutes}m ${htf} confirms`);
  }

  return { action: 'TRADE', side, score, reasons };
}

// ── Momentum: trade WITH a confirmed 1m trend (EMA + momentum + RSI band) ──
function momentumSide(ctx, params) {
  const reasons = [];
  const sep = (ctx.ema9 - ctx.ema21) / ctx.ema21;
  const bullishTrend = sep >= params.emaMarginPct;
  const bearishTrend = sep <= -params.emaMarginPct;
  const upMomentum   = ctx.change1h >= params.momentumPct;
  const downMomentum = ctx.change1h <= -params.momentumPct;
  const rsiOkLong  = ctx.rsi14 >= params.rsiLongMin  && ctx.rsi14 <= params.rsiLongMax;
  const rsiOkShort = ctx.rsi14 >= params.rsiShortMin && ctx.rsi14 <= params.rsiShortMax;

  let side = null;
  if (bullishTrend && upMomentum && rsiOkLong) {
    side = 'LONG';
    reasons.push(`EMA9 above EMA21 by ${(sep * 100).toFixed(2)}%`, `1h momentum +${ctx.change1h}%`, `RSI ${ctx.rsi14} in long band`);
  } else if (bearishTrend && downMomentum && rsiOkShort) {
    side = 'SHORT';
    reasons.push(`EMA9 below EMA21 by ${(sep * 100).toFixed(2)}%`, `1h momentum ${ctx.change1h}%`, `RSI ${ctx.rsi14} in short band`);
  } else {
    if (!bullishTrend && !bearishTrend) reasons.push('No EMA trend (flat)');
    else if (!(upMomentum || downMomentum)) reasons.push(`Momentum ${ctx.change1h}% below ±${params.momentumPct}%`);
    else if (bullishTrend && !upMomentum) reasons.push('Trend up but momentum not up (conflict)');
    else if (bearishTrend && !downMomentum) reasons.push('Trend down but momentum not down (conflict)');
    else reasons.push(`RSI ${ctx.rsi14} outside entry band`);
    return { side: null, reasons, score: 0 };
  }

  const sepStrength = clamp01(Math.abs(sep) / (params.emaMarginPct * 5));
  const momStrength = clamp01(Math.abs(ctx.change1h) / (params.momentumPct * 3));
  const band = side === 'LONG'
    ? { lo: params.rsiLongMin, hi: params.rsiLongMax }
    : { lo: params.rsiShortMin, hi: params.rsiShortMax };
  const mid = (band.lo + band.hi) / 2;
  const half = (band.hi - band.lo) / 2 || 1;
  const rsiCentered = clamp01(1 - Math.abs(ctx.rsi14 - mid) / half);
  const score = Math.round((0.40 * sepStrength + 0.40 * momStrength + 0.20 * rsiCentered) * 1000) / 1000;

  return { side, reasons, score };
}

// ── Mean-reversion: fade stretched extremes (RSI exhausted + price far from mean) ──
function meanReversionSide(ctx, params) {
  const reasons = [];
  const deviation = (ctx.price - ctx.ema21) / ctx.ema21; // signed distance from the mean
  const stretchedDown = deviation <= -params.mrDeviationPct;
  const stretchedUp   = deviation >=  params.mrDeviationPct;
  const oversold   = ctx.rsi14 <= params.mrRsiOversold;
  const overbought = ctx.rsi14 >= params.mrRsiOverbought;

  if (oversold && stretchedDown) {
    reasons.push(`RSI ${ctx.rsi14} oversold`, `price ${(deviation * 100).toFixed(2)}% below EMA21 (stretched)`);
    return { side: 'LONG', reasons, score: mrScore(ctx, params, deviation) };
  }
  if (overbought && stretchedUp) {
    reasons.push(`RSI ${ctx.rsi14} overbought`, `price +${(deviation * 100).toFixed(2)}% above EMA21 (stretched)`);
    return { side: 'SHORT', reasons, score: mrScore(ctx, params, deviation) };
  }
  reasons.push(`No mean-reversion extreme (RSI ${ctx.rsi14}, dev ${(deviation * 100).toFixed(2)}%)`);
  return { side: null, reasons, score: 0 };
}

function mrScore(ctx, params, deviation) {
  const devStrength = clamp01(Math.abs(deviation) / (params.mrDeviationPct * 3));
  const rsiExtreme = ctx.rsi14 <= params.mrRsiOversold
    ? clamp01((params.mrRsiOversold - ctx.rsi14) / Math.max(1, params.mrRsiOversold))
    : clamp01((ctx.rsi14 - params.mrRsiOverbought) / Math.max(1, 100 - params.mrRsiOverbought));
  return Math.round((0.5 * devStrength + 0.5 * rsiExtreme) * 1000) / 1000;
}
