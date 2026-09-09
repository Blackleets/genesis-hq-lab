// server/genesis/spotPerpLeadLag.mjs
// RESEARCH_ONLY spot↔perpetual microstructure context.
//
// Purpose: preserve synchronized price-discovery information that is lost when spot
// and perpetual candles are studied independently. This module is read-only and MUST
// NOT place orders, promote candidates, alter REAL_TRADING confirmations, or bypass
// fixed audit gates. Features produced here require train/validation/walk-forward and
// untouched holdout evaluation before any Forward PAPER enrollment.

import { getSharedThrottler } from './rateLimiter.mjs';

const SPOT = 'https://api.binance.com';
const FUTS = 'https://fapi.binance.com';
const ALLOWED_INTERVALS = new Set(['1m', '3m', '5m', '15m', '30m', '1h']);

async function jget(url, { futures = false } = {}) {
  if (futures) await getSharedThrottler().acquire('default', 1);
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.split('?')[0]}`);
  return res.json();
}

function normalizeSymbol(symbol) {
  const value = String(symbol || '').toUpperCase();
  if (!/^[A-Z0-9]{5,20}$/.test(value)) throw new Error('invalid symbol');
  return value;
}

function normalizeInterval(interval) {
  if (!ALLOWED_INTERVALS.has(interval)) throw new Error(`unsupported interval: ${interval}`);
  return interval;
}

function normalizeKlines(rows = []) {
  return rows.map(row => ({
    time: Number(row?.[0]),
    close: Number(row?.[4]),
  })).filter(row => Number.isFinite(row.time) && Number.isFinite(row.close) && row.close > 0);
}

export async function getSpotPerpKlines(symbol, { interval = '1m', points = 120 } = {}) {
  const normalizedSymbol = normalizeSymbol(symbol);
  const normalizedInterval = normalizeInterval(interval);
  const limit = Math.max(20, Math.min(Number(points) || 120, 1000));
  const query = `symbol=${encodeURIComponent(normalizedSymbol)}&interval=${encodeURIComponent(normalizedInterval)}&limit=${limit}`;

  const [spotRaw, perpRaw] = await Promise.all([
    jget(`${SPOT}/api/v3/klines?${query}`),
    jget(`${FUTS}/fapi/v1/klines?${query}`, { futures: true }),
  ]);

  return {
    symbol: normalizedSymbol,
    interval: normalizedInterval,
    spot: normalizeKlines(spotRaw),
    perp: normalizeKlines(perpRaw),
  };
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function std(values) {
  if (values.length < 2) return null;
  const avg = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / values.length);
}

function correlation(xs, ys) {
  if (xs.length !== ys.length || xs.length < 3) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let numerator = 0;
  let xx = 0;
  let yy = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    numerator += dx * dy;
    xx += dx * dx;
    yy += dy * dy;
  }
  const denominator = Math.sqrt(xx * yy);
  return denominator > 0 ? numerator / denominator : null;
}

function logReturns(closes) {
  const out = [];
  for (let i = 1; i < closes.length; i += 1) {
    out.push(Math.log(closes[i] / closes[i - 1]));
  }
  return out;
}

function lagCorrelation(spotReturns, perpReturns, lag) {
  if (lag > 0) {
    return correlation(spotReturns.slice(0, -lag), perpReturns.slice(lag));
  }
  if (lag < 0) {
    const offset = -lag;
    return correlation(spotReturns.slice(offset), perpReturns.slice(0, -offset));
  }
  return correlation(spotReturns, perpReturns);
}

/**
 * Derive synchronized spot↔perpetual microstructure features.
 * Positive bestLagBars means spot returns lead perpetual returns by that many bars;
 * negative means perpetual leads spot. Lag zero is reported separately and excluded
 * when selecting a leader because contemporaneous correlation is normally dominant.
 */
export function deriveSpotPerpLeadLag(spotRows = [], perpRows = [], {
  maxLagBars = 3,
  minAlignedPoints = 20,
} = {}) {
  const spotByTime = new Map(spotRows
    .map(row => [Number(row?.time), Number(row?.close)])
    .filter(([time, close]) => Number.isFinite(time) && Number.isFinite(close) && close > 0));
  const perpByTime = new Map(perpRows
    .map(row => [Number(row?.time), Number(row?.close)])
    .filter(([time, close]) => Number.isFinite(time) && Number.isFinite(close) && close > 0));

  const times = [...spotByTime.keys()].filter(time => perpByTime.has(time)).sort((a, b) => a - b);
  const empty = {
    alignedPoints: times.length,
    spreadNowBps: null,
    spreadAvgBps: null,
    spreadVolBps: null,
    returnCorr0: null,
    bestLagBars: null,
    bestLagCorr: null,
    leader: 'unknown',
    latestReturnDivergenceBps: null,
  };
  if (times.length < Math.max(3, minAlignedPoints)) return empty;

  const spotCloses = times.map(time => spotByTime.get(time));
  const perpCloses = times.map(time => perpByTime.get(time));
  const spreadsBps = spotCloses.map((spotClose, index) => ((perpCloses[index] / spotClose) - 1) * 10_000);
  const spotReturns = logReturns(spotCloses);
  const perpReturns = logReturns(perpCloses);
  const returnCorr0 = lagCorrelation(spotReturns, perpReturns, 0);

  const maxLag = Math.max(1, Math.min(Math.trunc(maxLagBars) || 1, 10));
  let bestLagBars = null;
  let bestLagCorr = null;
  for (let lag = -maxLag; lag <= maxLag; lag += 1) {
    if (lag === 0) continue;
    const corr = lagCorrelation(spotReturns, perpReturns, lag);
    if (!Number.isFinite(corr)) continue;
    if (bestLagCorr === null || Math.abs(corr) > Math.abs(bestLagCorr)) {
      bestLagBars = lag;
      bestLagCorr = corr;
    }
  }

  const latestSpotReturn = spotReturns[spotReturns.length - 1];
  const latestPerpReturn = perpReturns[perpReturns.length - 1];
  const round = (value, digits) => Number.isFinite(value) ? +value.toFixed(digits) : null;

  return {
    alignedPoints: times.length,
    spreadNowBps: round(spreadsBps[spreadsBps.length - 1], 3),
    spreadAvgBps: round(mean(spreadsBps), 3),
    spreadVolBps: round(std(spreadsBps), 3),
    returnCorr0: round(returnCorr0, 4),
    bestLagBars,
    bestLagCorr: round(bestLagCorr, 4),
    leader: bestLagBars > 0 ? 'spot' : bestLagBars < 0 ? 'perp' : 'unknown',
    latestReturnDivergenceBps: round((latestSpotReturn - latestPerpReturn) * 10_000, 3),
  };
}

export async function getSpotPerpLeadLagContext(symbol, options = {}) {
  const history = await getSpotPerpKlines(symbol, options);
  return {
    symbol: history.symbol,
    interval: history.interval,
    fetchedAt: new Date().toISOString(),
    researchOnly: true,
    ...deriveSpotPerpLeadLag(history.spot, history.perp, options),
    raw: history,
  };
}

if (process.argv[1] && process.argv[1].endsWith('spotPerpLeadLag.mjs')) {
  const symbol = (process.argv[2] || 'BTCUSDT').toUpperCase();
  getSpotPerpLeadLagContext(symbol)
    .then(result => console.log(JSON.stringify({ ...result, raw: undefined }, null, 2)))
    .catch(error => { console.error('ERROR:', error.message); process.exitCode = 1; });
}
