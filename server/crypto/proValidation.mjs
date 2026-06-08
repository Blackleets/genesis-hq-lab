import { computeEma, computeRsi } from './priceFeeder.mjs';

const BINANCE_BASE = process.env.BINANCE_BASE || 'https://data-api.binance.vision/api/v3';
const PAIRS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'];
const TIMEFRAMES = [
  { label: '15m', interval: '15m', limit: 160 },
  { label: '1h', interval: '1h', limit: 160 },
  { label: '4h', interval: '4h', limit: 160 },
];

function round(n, digits = 2) {
  if (!Number.isFinite(n)) return null;
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}

export function computeMacd(closes, fast = 12, slow = 26, signal = 9) {
  if (!Array.isArray(closes) || closes.length < slow + signal) {
    return { macd: 0, signal: 0, histogram: 0 };
  }
  const macdSeries = [];
  for (let i = 0; i < closes.length; i++) {
    const slice = closes.slice(0, i + 1);
    macdSeries.push(computeEma(slice, fast) - computeEma(slice, slow));
  }
  const macd = macdSeries[macdSeries.length - 1];
  const signalLine = computeEma(macdSeries, signal);
  return {
    macd: round(macd, 4),
    signal: round(signalLine, 4),
    histogram: round(macd - signalLine, 4),
  };
}

export function summarizeTimeframe(closes, label) {
  if (!Array.isArray(closes) || closes.length < 40) {
    return {
      label,
      trend: 'unknown',
      verdict: 'insufficient',
      ema9: null,
      ema21: null,
      rsi14: null,
      macdHistogram: null,
      price: null,
      changePct: null,
      score: 0,
      notes: ['insufficient candles'],
    };
  }

  const ema9 = computeEma(closes, 9);
  const ema21 = computeEma(closes, 21);
  const rsi14 = computeRsi(closes, 14);
  const macd = computeMacd(closes);
  const last = closes[closes.length - 1];
  const ref = closes[Math.max(0, closes.length - 13)];
  const changePct = ref ? ((last - ref) / ref) * 100 : 0;

  let score = 0;
  const notes = [];
  const sep = ema21 !== 0 ? (ema9 - ema21) / ema21 : 0;
  const trend = sep > 0.001 ? 'bullish' : sep < -0.001 ? 'bearish' : 'neutral';

  if (trend === 'bullish') { score += 1; notes.push('ema9 > ema21'); }
  if (trend === 'bearish') { score -= 1; notes.push('ema9 < ema21'); }

  if (rsi14 >= 48 && rsi14 <= 68) { score += 1; notes.push('rsi supportive'); }
  else if (rsi14 <= 32 || rsi14 >= 72) { score -= 1; notes.push('rsi stretched'); }
  else { notes.push('rsi mixed'); }

  if ((macd.histogram ?? 0) > 0) { score += 1; notes.push('macd positive'); }
  if ((macd.histogram ?? 0) < 0) { score -= 1; notes.push('macd negative'); }

  if (changePct > 0.4) { score += 1; notes.push('price advancing'); }
  if (changePct < -0.4) { score -= 1; notes.push('price fading'); }

  const verdict = score >= 2 ? 'confirm_long'
    : score <= -2 ? 'confirm_short'
    : 'mixed';

  return {
    label,
    trend,
    verdict,
    ema9: round(ema9, last >= 1000 ? 2 : 4),
    ema21: round(ema21, last >= 1000 ? 2 : 4),
    rsi14: round(rsi14, 2),
    macdHistogram: macd.histogram,
    price: round(last, last >= 1000 ? 2 : 4),
    changePct: round(changePct, 2),
    score,
    notes,
  };
}

async function fetchKlines(pair, interval, limit) {
  const res = await fetch(`${BINANCE_BASE}/klines?symbol=${pair}&interval=${interval}&limit=${limit}`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Binance ${interval} HTTP ${res.status}`);
  return res.json();
}

export async function getProValidation(pair = 'BTCUSDT') {
  const normalized = PAIRS.includes(pair?.toUpperCase()) ? pair.toUpperCase() : 'BTCUSDT';
  const results = await Promise.all(TIMEFRAMES.map(async (tf) => {
    const raw = await fetchKlines(normalized, tf.interval, tf.limit);
    const closes = raw.map(k => parseFloat(k[4])).filter(Number.isFinite);
    return summarizeTimeframe(closes, tf.label);
  }));

  const score = results.reduce((sum, tf) => sum + (tf.score ?? 0), 0);
  const longCount = results.filter(tf => tf.verdict === 'confirm_long').length;
  const shortCount = results.filter(tf => tf.verdict === 'confirm_short').length;
  const mixedCount = results.filter(tf => tf.verdict === 'mixed').length;

  const bias = longCount >= 2 ? 'LONG_BIAS'
    : shortCount >= 2 ? 'SHORT_BIAS'
    : 'MIXED';

  const action = bias === 'LONG_BIAS' ? 'validate_longs_only'
    : bias === 'SHORT_BIAS' ? 'validate_shorts_only'
    : 'stand_aside';

  return {
    pair: normalized,
    bias,
    action,
    score,
    timeframes: results,
    note: 'Operator validation only. Not wired to execution.',
    fetchedAt: new Date().toISOString(),
  };
}
