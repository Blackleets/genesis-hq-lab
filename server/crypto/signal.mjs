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
  const reasons = [];

  // ── Sanity: reject unusable data before deciding anything ──
  if (!ctx || !Number.isFinite(ctx.price) || ctx.price <= 0 ||
      !Number.isFinite(ctx.ema9) || !Number.isFinite(ctx.ema21) ||
      !Number.isFinite(ctx.rsi14) || !Number.isFinite(ctx.change1h)) {
    return { action: 'SKIP', side: null, score: 0, reasons: ['Invalid or missing market data'] };
  }

  // ── Hard gate: liquidity ──
  if (!(ctx.volume24h >= params.minVolume24h)) {
    return {
      action: 'SKIP', side: null, score: 0,
      reasons: [`Volume $${Math.round(ctx.volume24h).toLocaleString()} below $${params.minVolume24h.toLocaleString()} floor`],
    };
  }

  // ── Trend from EMA separation ──
  const sep = (ctx.ema9 - ctx.ema21) / ctx.ema21;       // signed fractional separation
  const bullishTrend = sep >= params.emaMarginPct;
  const bearishTrend = sep <= -params.emaMarginPct;

  // ── Momentum (1h change is in percent units) ──
  const upMomentum   = ctx.change1h >= params.momentumPct;
  const downMomentum = ctx.change1h <= -params.momentumPct;

  // ── RSI bands keep us out of exhausted moves ──
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
    // Explain the strongest missing condition for diagnostics.
    if (!bullishTrend && !bearishTrend) reasons.push('No EMA trend (flat)');
    else if (side === null && !(upMomentum || downMomentum)) reasons.push(`Momentum ${ctx.change1h}% below ±${params.momentumPct}%`);
    else if (bullishTrend && !upMomentum) reasons.push('Trend up but momentum not up (conflict)');
    else if (bearishTrend && !downMomentum) reasons.push('Trend down but momentum not down (conflict)');
    else reasons.push(`RSI ${ctx.rsi14} outside entry band`);
    return { action: 'SKIP', side: null, score: 0, reasons };
  }

  // ── Multi-timeframe filter: never trade against the higher-timeframe trend ──
  if (params.useHtfFilter) {
    const htf = computeHtfTrend(ctx.closes, params);
    if ((side === 'LONG' && htf === 'bearish') || (side === 'SHORT' && htf === 'bullish')) {
      return { action: 'SKIP', side: null, score: 0, reasons: [`Higher timeframe (${params.htfMinutes}m) is ${htf} — blocks ${side}`] };
    }
    if (htf !== 'neutral') reasons.push(`HTF ${params.htfMinutes}m ${htf} confirms`);
  }

  // ── Confluence score in [0,1]: stronger separation/momentum + RSI centered → higher ──
  const sepStrength = clamp01(Math.abs(sep) / (params.emaMarginPct * 5));
  const momStrength = clamp01(Math.abs(ctx.change1h) / (params.momentumPct * 3));
  const band = side === 'LONG'
    ? { lo: params.rsiLongMin, hi: params.rsiLongMax }
    : { lo: params.rsiShortMin, hi: params.rsiShortMax };
  const mid = (band.lo + band.hi) / 2;
  const half = (band.hi - band.lo) / 2 || 1;
  const rsiCentered = clamp01(1 - Math.abs(ctx.rsi14 - mid) / half);

  const score = Math.round((0.40 * sepStrength + 0.40 * momStrength + 0.20 * rsiCentered) * 1000) / 1000;

  return { action: 'TRADE', side, score, reasons };
}
