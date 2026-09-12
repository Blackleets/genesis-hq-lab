// server/genesis/strategyLib.mjs
// Strategy factory: each returns a strategyFn(ctx) -> signal object.
// Params are plain objects so the evolution loop can mutate them.
// All strategies are LONG/SHORT with ATR-based exits.
// Families: meanReversion (+ADX regime filter), breakout, momentum,
//           orderbookImbalance (uses bid/ask pressure proxy via volume),
//           volumeProfile (volume-weighted mean reversion).

import { bollinger, donchian, ema } from './backtestCore.mjs';

export function makeMeanReversion(params) {
  const { rsiLow = 32, rsiHigh = 68, bbMult = 2, slMult = 1.5, tpMult = 2.0, atrMinPct = 0.003, adxMax = 25 } = params;
  return (ctx) => {
    const { i, close, ind } = ctx;
    const r = ind.rsi14[i];
    const lower = ind.bb.lower[i];
    const upper = ind.bb.upper[i];
    if (r == null || lower == null) return {};
    const a = ind.atr14[i] || close[i] * 0.01;
    const volOk = a / close[i] >= atrMinPct;
    const adx = ind.adx14[i];
    const regimeOk = adx == null || adx <= adxMax;
    if (!volOk || !regimeOk) return {};
    if (r <= rsiLow && close[i] <= lower) return { long: true, slMult, tpMult };
    if (r >= rsiHigh && close[i] >= upper) return { short: true, slMult, tpMult };
    return {};
  };
}

export function makeBreakout(params) {
  const { donchianPeriod = 20, slMult = 1.5, tpMult = 2.0, atrMinPct = 0.004 } = params;
  return (ctx) => {
    const { i, close, ind } = ctx;
    const up = ind.dc.upper[i];
    const lo = ind.dc.lower[i];
    if (up == null || lo == null) return {};
    const a = ind.atr14[i] || close[i] * 0.01;
    if (a / close[i] < atrMinPct) return {};
    if (close[i] > up) return { long: true, slMult, tpMult };
    if (close[i] < lo) return { short: true, slMult, tpMult };
    return {};
  };
}

export function makeMomentum(params) {
  const { fast = 9, slow = 21, slMult = 1.5, tpMult = 2.0, atrMinPct = 0.004 } = params;
  return (ctx) => {
    const { i, ind, close } = ctx;
    const f = ind.ema9[i];
    const s = ind.ema21[i];
    if (f == null || s == null) return {};
    const a = ind.atr14[i] || 1;
    if (a / close[i] < atrMinPct) return {};
    if (f > s) return { long: true, slMult, tpMult };
    if (f < s) return { short: true, slMult, tpMult };
    return {};
  };
}

// Orderbook imbalance proxy via volume delta: if candle closed UP on high
// volume vs average AND we are not in extended trend, fade the move (reversion
// on exhaustion). Uses volume only (no true L2 in OHLCV).
export function makeOrderbookImbalance(params) {
  const { volLookback = 20, volMult = 1.8, slMult = 1.5, tpMult = 2.0, atrMinPct = 0.003, adxMax = 25 } = params;
  return (ctx) => {
    const { i, close, open, vol, ind } = ctx;
    if (i < volLookback) return {};
    let vsum = 0;
    for (let j = i - volLookback + 1; j <= i; j++) vsum += vol[j];
    const vavg = vsum / volLookback;
    const a = ind.atr14[i] || close[i] * 0.01;
    if (a / close[i] < atrMinPct) return {};
    const adx = ind.adx14[i];
    if (adx != null && adx > adxMax) return {};
    const body = close[i] - open[i];
    const volSpike = vol[i] > vavg * volMult;
    // exhaustion reversal: big volume move up -> short fade; down -> long fade
    if (volSpike && body > 0 && close[i] > ind.bb.upper[i]) return { short: true, slMult, tpMult };
    if (volSpike && body < 0 && close[i] < ind.bb.lower[i]) return { long: true, slMult, tpMult };
    return {};
  };
}

// Volume profile: reversion toward the volume-weighted average price (VWAP
// proxy = sum(close*vol)/sum(vol) over window). Trade back to VWAP.
export function makeVolumeProfile(params) {
  const { vwapLookback = 24, devPct = 0.01, slMult = 1.5, tpMult = 2.0, atrMinPct = 0.003, adxMax = 25 } = params;
  return (ctx) => {
    const { i, close, vol, ind } = ctx;
    if (i < vwapLookback) return {};
    let pv = 0, v = 0;
    for (let j = i - vwapLookback + 1; j <= i; j++) { pv += close[j] * vol[j]; v += vol[j]; }
    if (v === 0) return {};
    const vwap = pv / v;
    const a = ind.atr14[i] || close[i] * 0.01;
    if (a / close[i] < atrMinPct) return {};
    const adx = ind.adx14[i];
    if (adx != null && adx > adxMax) return {};
    const dev = (close[i] - vwap) / vwap;
    if (dev > devPct) return { short: true, slMult, tpMult }; // above VWAP -> fade down
    if (dev < -devPct) return { long: true, slMult, tpMult }; // below VWAP -> fade up
    return {};
  };
}


// Additive GLFT maker family. Quotes are inventory-skewed around Kalman FV
// using OHLCV pressure as the imbalance proxy (no L2). This still returns
// directional long/short for the existing taker engine — the honest maker
// path is simulateMarketMaker(). Use this family only as a paper candidate;
// fills inside runBacktest remain taker (COST_ROUNDTRIP). Do not treat a
// GO here as a maker edge.
export function makeGlftMaker(params) {
  const { slMult = 1.5, tpMult = 2.0, pressureAbs = 0.35, adxMax = 25 } = params;
  return (ctx) => {
    const { i, close, open, high, low, ind } = ctx;
    if (i < 2) return {};
    const h = high[i], l = low[i], c = close[i], o = open[i];
    const range = h - l;
    if (!(range > 0)) return {};
    const pressure = ((c - l) - (h - c)) / range;
    const adx = ind.adx14[i];
    if (adx != null && adx > adxMax) return {};
    // Fade pressure: selling into us (negative pressure) -> bid / long;
    // buying into us -> ask / short. Same spirit as posting the opposite quote.
    if (pressure <= -pressureAbs) return { long: true, slMult, tpMult };
    if (pressure >= pressureAbs) return { short: true, slMult, tpMult };
    return {};
  };
}

export const STRATEGY_FACTORIES = {
  meanReversion: makeMeanReversion,
  breakout: makeBreakout,
  momentum: makeMomentum,
  orderbookImbalance: makeOrderbookImbalance,
  volumeProfile: makeVolumeProfile,
  glftMaker: makeGlftMaker,
};

export function makeStrategy(kind, params) {
  const factory = STRATEGY_FACTORIES[kind];
  if (!factory) throw new Error(`unknown strategy kind: ${kind}`);
  return factory(params);
}
