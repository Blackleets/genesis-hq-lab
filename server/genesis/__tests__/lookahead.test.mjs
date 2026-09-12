// server/genesis/__tests__/lookahead.test.mjs
// P0 guard tests: the backtester must catch future-peeking strategies,
// pass honest ones clean, and shift entry fills to the next candle's open.

import { describe, it, expect } from 'vitest';
import { runBacktest } from '../backtestCore.mjs';

const N = 200;
const BASE = 100;
const AMP = 5;
const PERIOD = 40;

/** Deterministic synthetic sine candles: [ts, open, high, low, close, vol]. */
function sineCandles(n = N) {
  const closes = [];
  for (let i = 0; i < n; i++) {
    closes.push(BASE + AMP * Math.sin((2 * Math.PI * i) / PERIOD));
  }
  const candles = [];
  for (let i = 0; i < n; i++) {
    const close = closes[i];
    const open = i === 0 ? BASE : closes[i - 1];
    const hi = Math.max(open, close) + 0.5;
    const lo = Math.min(open, close) - 0.5;
    candles.push([i * 3600_000, open, hi, lo, close, 100 + (i % 7)]);
  }
  return candles;
}

describe('lookahead guard (P0)', () => {
  it('a cheating strategy reading ctx.close[ctx.i+1] generates >= 1 lookaheadViolation', () => {
    const cheating = (ctx) => {
      // Peeks one candle into the future -> must trip the capped view.
      return ctx.close[ctx.i + 1] > ctx.close[ctx.i] ? { long: true } : {};
    };
    const result = runBacktest({ candles: sineCandles(), strategyFn: cheating });
    expect(Array.isArray(result.lookaheadViolations)).toBe(true);
    expect(result.lookaheadViolations.length).toBeGreaterThanOrEqual(1);
    // Every violation carries the LOOKAHEAD_AT_CANDLE_ marker.
    for (const v of result.lookaheadViolations) {
      expect(String(v.detail)).toMatch(/LOOKAHEAD_AT_CANDLE_/);
    }
  });

  it('an honest strategy generates 0 lookaheadViolations', () => {
    // Momentum-ish but strictly causal: only reads indices <= ctx.i.
    const honest = (ctx) => {
      const i = ctx.i;
      const sma20 = ctx.ind.sma20[i];
      const sma50 = ctx.ind.sma50[i];
      if (sma20 == null || sma50 == null || ctx.close[i] == null) return {};
      if (sma20 > sma50 && ctx.close[i] > sma20) return { long: true };
      if (sma20 < sma50 && ctx.close[i] < sma20) return { short: true };
      return {};
    };
    const result = runBacktest({ candles: sineCandles(), strategyFn: honest });
    expect(result.lookaheadViolations.length).toBe(0);
    expect(result.equityCurve.length).toBe(N); // ran the full series
  });

  it('signalShift: a signal born on candle i fills at the OPEN of candle i+1', () => {
    const SIGNAL_AT = 50;
    const EXIT_AT = 60;
    const candles = sineCandles();
    const opens = candles.map(c => c[1]);
    const strategy = (ctx) => {
      if (ctx.i === SIGNAL_AT) return { long: true, slMult: 1000, tpMult: 1000 };
      if (ctx.i === EXIT_AT) return { exit: true };
      return {};
    };
    const result = runBacktest({ candles, strategyFn: strategy, signalShift: true });
    // Exactly one trade, entered on the candle AFTER the signal candle.
    expect(result.trades.length).toBe(1);
    const t = result.trades[0];
    expect(t.side).toBe('long');
    expect(t.entryIdx).toBe(SIGNAL_AT + 1);
    expect(Math.abs(t.entry - opens[SIGNAL_AT + 1])).toBeLessThan(1e-9);
  });
});
