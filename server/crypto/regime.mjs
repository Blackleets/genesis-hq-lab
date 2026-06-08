// regime.mjs — Phase 6B.1 market regime classification + directional confidence bias.
//
// Surgical edge optimization: classify the crypto regime from EXISTING signals only
// (HTF trend, EMA alignment, momentum, volatility) and softly bias the confidence
// that feeds the trade gate. Never hard-blocks, never flips a side, never touches
// risk/safe-mode/execution/Kelly. Fully adaptive — no hardcoded directional bias.

import { computeHtfTrend } from './signal.mjs';
import { DEFAULTS } from './strategyParams.mjs';

export const REGIMES = ['STRONG_BULL', 'BULL', 'RANGE', 'BEAR', 'STRONG_BEAR', 'HIGH_VOLATILITY'];

// Confidence-point modifiers per regime × side (mission-specified). Positive favours
// the side, negative penalises it. Applied on the 0–1 scale (÷100).
export const BIAS = {
  STRONG_BULL:     { LONG: +10, SHORT: -20 },
  BULL:            { LONG:  +5, SHORT: -10 },
  RANGE:           { LONG:   0, SHORT:   0 },
  BEAR:            { LONG: -10, SHORT:  +5 },
  STRONG_BEAR:     { LONG: -20, SHORT: +10 },
  HIGH_VOLATILITY: { LONG:  -5, SHORT:  -5 },
};

const VOL_HIGH_PCT = 2.5;   // |1h change| ≥ this → HIGH_VOLATILITY (violent, penalise both)
const CONF_MAX     = 0.92;  // engine confidence ceiling — never exceed system limits

function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

/**
 * Classify the crypto regime from an asset context (priceFeeder shape).
 * Uses HTF trend + EMA9/21 alignment + 1h momentum + volatility. Pure.
 * @param {{ema9:number, ema21:number, change1h:number, closes:number[]}} ctx
 * @returns {string} one of REGIMES
 */
export function classifyRegime(ctx) {
  if (!ctx || !Number.isFinite(ctx.ema9) || !Number.isFinite(ctx.ema21) || !Number.isFinite(ctx.change1h)) {
    return 'RANGE';
  }

  const vol = Math.abs(ctx.change1h);
  if (vol >= VOL_HIGH_PCT) return 'HIGH_VOLATILITY';

  const emaSep = ((ctx.ema9 - ctx.ema21) / ctx.ema21) * 100; // signed %
  const htf = (() => {
    try { return computeHtfTrend(ctx.closes ?? [], DEFAULTS); } catch { return 'neutral'; }
  })();
  const mom = ctx.change1h;

  let dir = 0;
  if (htf === 'bullish') dir += 1; else if (htf === 'bearish') dir -= 1;
  if (emaSep >= 0.15) dir += 1; else if (emaSep <= -0.15) dir -= 1;
  if (mom >= 0.5) dir += 1; else if (mom <= -0.5) dir -= 1;

  if (dir >= 3) return 'STRONG_BULL';
  if (dir >= 1) return 'BULL';
  if (dir <= -3) return 'STRONG_BEAR';
  if (dir <= -1) return 'BEAR';
  return 'RANGE';
}

/**
 * Apply the soft directional bias to a confidence value.
 * @param {number} confidence  0–1
 * @param {'LONG'|'SHORT'} side
 * @param {string} regime
 * @returns {{ confidence:number, regime:string, bias:number, original:number }}
 */
export function applyRegimeBias(confidence, side, regime) {
  const mod = (BIAS[regime]?.[side] ?? 0); // confidence points
  const biased = clamp(confidence + mod / 100, 0, CONF_MAX);
  return { confidence: biased, regime, bias: mod, original: confidence };
}

/** Convenience: classify + bias in one call from a ctx. */
export function regimeAdjust(confidence, side, ctx) {
  const regime = classifyRegime(ctx);
  return applyRegimeBias(confidence, side, regime);
}
