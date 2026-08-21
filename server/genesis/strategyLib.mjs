// server/genesis/strategyLib.mjs
// Strategy factory: each returns a strategyFn(ctx) -> signal object.
// Params are plain objects so the evolution loop can mutate them.
// All strategies are LONG/SHORT mean-reversion or breakout with ATR exits.

export function makeMeanReversion(params) {
  const { rsiPeriod = 14, rsiLow = 32, rsiHigh = 68, bbPeriod = 20, bbMult = 2, slMult = 1.5, tpMult = 2.0, atrMinPct = 0.003, adxMax = 25 } = params;
  return (ctx) => {
    const { i, close, ind } = ctx;
    const r = ind.rsi14[i];
    const lower = ind.bb.lower[i];
    const upper = ind.bb.upper[i];
    if (r == null || lower == null) return {};
    const a = ind.atr14[i] || close[i] * 0.01;
    const volOk = a / close[i] >= atrMinPct;
    // REGIME FILTER: only trade mean reversion in ranging markets (ADX low)
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
    const volOk = a / close[i] >= atrMinPct;
    if (!volOk) return {};
    if (close[i] > up) return { long: true, slMult, tpMult };
    if (close[i] < lo) return { short: true, slMult, tpMult };
    return {};
  };
}

export function makeMomentum(params) {
  const { fast = 9, slow = 21, slMult = 1.5, tpMult = 2.0, atrMinPct = 0.004 } = params;
  return (ctx) => {
    const { i, ind } = ctx;
    const f = ind.ema9[i];
    const s = ind.ema21[i];
    if (f == null || s == null) return {};
    const a = ind.atr14[i] || 1;
    const volOk = a / ctx.close[i] >= atrMinPct;
    if (!volOk) return {};
    if (f > s) return { long: true, slMult, tpMult };
    if (f < s) return { short: true, slMult, tpMult };
    return {};
  };
}

export const STRATEGY_FACTORIES = {
  meanReversion: makeMeanReversion,
  breakout: makeBreakout,
  momentum: makeMomentum,
};

export function makeStrategy(kind, params) {
  const factory = STRATEGY_FACTORIES[kind];
  if (!factory) throw new Error(`unknown strategy kind: ${kind}`);
  return factory(params);
}
