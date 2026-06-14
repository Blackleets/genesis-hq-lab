// chartIndicators.ts — pure technical-indicator math over OHLCV candles.
// No React, no IO. Each fn returns arrays aligned 1:1 with the input candles;
// values that can't be computed yet (warm-up period) are returned as null so
// callers can skip them when feeding lightweight-charts (which wants whitespace
// gaps, not zeros).

export interface OHLC {
  time: number; // UTC seconds
  open: number; high: number; low: number; close: number; volume: number;
}

/** Exponential moving average. Returns a value for every bar (seeded on bar 0). */
export function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = values[0] ?? 0;
  for (let i = 0; i < values.length; i++) {
    const v = i === 0 ? values[0] : values[i] * k + prev * (1 - k);
    out.push(v);
    prev = v;
  }
  return out;
}

/** Simple moving average; null until `period` bars are available. */
export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    out.push(i >= period - 1 ? sum / period : null);
  }
  return out;
}

/** Bollinger Bands (SMA basis ± mult·σ). */
export function bollinger(
  closes: number[],
  period = 20,
  mult = 2,
): { upper: (number | null)[]; basis: (number | null)[]; lower: (number | null)[] } {
  const basis = sma(closes, period);
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];
  for (let i = 0; i < closes.length; i++) {
    const b = basis[i];
    if (b == null) { upper.push(null); lower.push(null); continue; }
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) variance += (closes[j] - b) ** 2;
    const sd = Math.sqrt(variance / period);
    upper.push(b + mult * sd);
    lower.push(b - mult * sd);
  }
  return { upper, basis, lower };
}

/** Rolling-session VWAP — resets each UTC day so it behaves like a real VWAP. */
export function vwap(candles: OHLC[]): (number | null)[] {
  const out: (number | null)[] = [];
  let day = -1;
  let cumPV = 0;
  let cumV = 0;
  for (const c of candles) {
    const d = Math.floor(c.time / 86400);
    if (d !== day) { day = d; cumPV = 0; cumV = 0; }
    const typical = (c.high + c.low + c.close) / 3;
    cumPV += typical * c.volume;
    cumV += c.volume;
    out.push(cumV > 0 ? cumPV / cumV : null);
  }
  return out;
}

/** Wilder's RSI; null during the warm-up period. */
export function rsi(closes: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = closes[i] - closes[i - 1];
    if (ch >= 0) gain += ch; else loss -= ch;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    const g = ch >= 0 ? ch : 0;
    const l = ch < 0 ? -ch : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

/** MACD line, signal line, histogram. */
export function macd(
  closes: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): { macd: number[]; signal: number[]; hist: number[] } {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const macdLine = closes.map((_, i) => emaFast[i] - emaSlow[i]);
  const signal = ema(macdLine, signalPeriod);
  const hist = macdLine.map((v, i) => v - signal[i]);
  return { macd: macdLine, signal, hist };
}
