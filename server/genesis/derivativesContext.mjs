// server/genesis/derivativesContext.mjs
// DERIVATIVES CONTEXT — market dimensions beyond price candles.
// Free official Binance futures endpoints (NO API key needed):
//   - Open interest history      GET /futures/data/openInterestHist
//   - Global long/short accounts GET /futures/data/globalLongShortAccountRatio
//   - Top trader position ratio  GET /futures/data/topLongShortPositionRatio
//   - Taker buy/sell volume      GET /futures/data/takerlongshortRatio  (order-flow delta proxy)
//   - Funding rate history       GET /fapi/v1/fundingRate
// Sentiment:
//   - Fear & Greed Index         GET https://api.alternative.me/fng/?limit=N
//
// Purpose: give strategies/regime filters access to POSITIONING data, not just price.
// All fetchers are read-only public data; cached to disk like candle_cache.
// Funding and positioning dynamics are exposed as RESEARCH_ONLY context; they are
// descriptive features, not execution signals by themselves.
//
// Usage (CLI):
//   node derivativesContext.mjs context COTIUSDT     # full snapshot JSON
//   node derivativesContext.mjs oi COTIUSDT 30       # last N 5-min OI points
//
// Usage (module):
//   import { getContext } from './derivativesContext.mjs';
//   const ctx = await getContext('COTIUSDT', { oiPoints: 48 });

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { getSharedThrottler } from './rateLimiter.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '../../data/derivatives_cache');
const FUTS = 'https://fapi.binance.com';
const FNG = 'https://api.alternative.me/fng/';

const TTL_MS = 10 * 60 * 1000; // 10 min cache for positioning snapshots

// fapi market-data endpoints draw from the shared public-IP budget.
const FAPI_WEIGHT = 1;

async function jget(u, weight = FAPI_WEIGHT) {
  // Only Binance fapi calls draw from the shared budget; third-party (Fear & Greed) is not throttled here.
  if (u.startsWith(FUTS)) await getSharedThrottler().acquire('default', weight);
  const res = await fetch(u, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${u.split('?')[0]}`);
  return res.json();
}

function cacheGet(key, ttl = TTL_MS) {
  try {
    const f = path.join(CACHE_DIR, `${key}.json`);
    const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (Date.now() - raw.at < ttl) return raw.data;
  } catch { /* miss */ }
  return null;
}
function cacheSet(key, data) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(path.join(CACHE_DIR, `${key}.json`), JSON.stringify({ at: Date.now(), data }));
}

/** Open-interest history (5m granularity, up to 500 points ≈ ~41h). */
export async function getOpenInterestHistory(symbol, points = 48) {
  const key = `oi_${symbol}_${points}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  const data = await jget(`${FUTS}/futures/data/openInterestHist?symbol=${symbol}&period=5m&limit=${Math.min(points, 500)}`);
  const out = data.map(d => ({
    time: +d.timestamp,
    oi: +d.sumOpenInterest,            // base asset
    oiUsd: +d.sumOpenInterestValue,    // USD notional
  }));
  cacheSet(key, out);
  return out;
}

/** Historical USDⓈ-M perpetual funding rates (normally one observation per funding interval). */
export async function getFundingRateHistory(symbol, points = 30) {
  const limit = Math.max(1, Math.min(points, 1000));
  const key = `funding_${symbol}_${limit}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  const data = await jget(`${FUTS}/fapi/v1/fundingRate?symbol=${symbol}&limit=${limit}`);
  const out = data.map(d => ({
    time: +d.fundingTime,
    rate: +d.fundingRate,
    markPrice: d.markPrice == null ? null : +d.markPrice,
  })).filter(d => Number.isFinite(d.time) && Number.isFinite(d.rate));
  cacheSet(key, out);
  return out;
}

/**
 * Pure funding feature derivation so research/tests can evaluate the feature without network access.
 * Rates remain decimals (0.0001 = 1 bp per funding event).
 */
export function deriveFundingFeatures(rows = []) {
  const rates = rows.map(r => Number(r?.rate)).filter(Number.isFinite);
  if (!rates.length) {
    return {
      fundingRateNow: null,
      fundingAvg: null,
      fundingAbsAvg: null,
      fundingPositiveShare: null,
      fundingCumulative: null,
      fundingCrowd: 'unknown',
    };
  }

  const latest = rates[rates.length - 1];
  const avg = rates.reduce((sum, rate) => sum + rate, 0) / rates.length;
  const absAvg = rates.reduce((sum, rate) => sum + Math.abs(rate), 0) / rates.length;
  const positiveShare = rates.filter(rate => rate > 0).length / rates.length;
  const cumulative = rates.reduce((sum, rate) => sum + rate, 0);

  // This labels persistent payer-side pressure, not trade direction.
  // 1 bp/event is intentionally a conservative descriptive threshold.
  const crowdThreshold = 0.0001;
  const fundingCrowd = avg >= crowdThreshold ? 'long_payers'
    : avg <= -crowdThreshold ? 'short_payers'
    : 'balanced';

  return {
    fundingRateNow: +latest.toFixed(8),
    fundingAvg: +avg.toFixed(8),
    fundingAbsAvg: +absAvg.toFixed(8),
    fundingPositiveShare: +positiveShare.toFixed(4),
    fundingCumulative: +cumulative.toFixed(8),
    fundingCrowd,
  };
}

function pctChange(first, last) {
  return Number.isFinite(first) && first !== 0 && Number.isFinite(last)
    ? ((last - first) / first) * 100
    : null;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function takerSide(ratio, threshold = 0.05) {
  if (!Number.isFinite(ratio)) return 'unknown';
  if (ratio >= 1 + threshold) return 'buy_pressure';
  if (ratio <= 1 - threshold) return 'sell_pressure';
  return 'balanced';
}

/**
 * Preserve short-horizon derivatives dynamics instead of collapsing OI and taker flow
 * into one long-window average. These features are intentionally descriptive and
 * RESEARCH_ONLY. They MUST NOT place orders or bypass promotion/audit gates.
 */
export function derivePositioningDynamics(oiRows = [], takerRows = [], {
  recentOiPoints = 6,      // 30 minutes with 5m OI rows
  recentTakerPoints = 3,  // 3 hours with 1h taker rows
} = {}) {
  const oiValues = oiRows.map(row => Number(row?.oiUsd)).filter(Number.isFinite);
  const takerValues = takerRows.map(row => Number(row?.buySellRatio)).filter(Number.isFinite);

  const oiChangePct = oiValues.length >= 2
    ? pctChange(oiValues[0], oiValues[oiValues.length - 1])
    : null;

  const oiRecent = oiValues.slice(-Math.max(2, recentOiPoints));
  const oiRecentChangePct = oiRecent.length >= 2
    ? pctChange(oiRecent[0], oiRecent[oiRecent.length - 1])
    : null;

  const oiPrevious = oiValues.slice(
    -Math.max(2, recentOiPoints) * 2,
    -Math.max(2, recentOiPoints),
  );
  const oiPreviousChangePct = oiPrevious.length >= 2
    ? pctChange(oiPrevious[0], oiPrevious[oiPrevious.length - 1])
    : null;
  const oiAccelerationPct = Number.isFinite(oiRecentChangePct) && Number.isFinite(oiPreviousChangePct)
    ? oiRecentChangePct - oiPreviousChangePct
    : null;

  const takerBias = mean(takerValues);
  const takerRecent = takerValues.slice(-Math.max(1, recentTakerPoints));
  const takerPrevious = takerValues.slice(
    -Math.max(1, recentTakerPoints) * 2,
    -Math.max(1, recentTakerPoints),
  );
  const takerRecentBias = mean(takerRecent);
  const takerPreviousBias = mean(takerPrevious);
  const takerImpulse = Number.isFinite(takerRecentBias) && Number.isFinite(takerPreviousBias)
    ? takerRecentBias - takerPreviousBias
    : null;
  const takerPressure = takerSide(takerRecentBias);
  const previousPressure = takerSide(takerPreviousBias);
  const takerReversal = previousPressure !== 'unknown'
    && previousPressure !== 'balanced'
    && takerPressure !== 'unknown'
    && takerPressure !== 'balanced'
    && previousPressure !== takerPressure;

  const round = (value, digits) => Number.isFinite(value) ? +value.toFixed(digits) : null;

  return {
    oiChangePct: round(oiChangePct, 2),
    oiRecentChangePct: round(oiRecentChangePct, 2),
    oiAccelerationPct: round(oiAccelerationPct, 2),
    takerBias: round(takerBias, 3),
    takerRecentBias: round(takerRecentBias, 3),
    takerImpulse: round(takerImpulse, 3),
    takerPressure,
    takerReversal,
  };
}

/** Global long/short account ratio (all traders). */
export async function getGlobalLongShort(symbol, points = 24) {
  const key = `gls_${symbol}_${points}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  const data = await jget(`${FUTS}/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=1h&limit=${Math.min(points, 500)}`);
  const out = data.map(d => ({ time: +d.timestamp, ratio: +d.longShortRatio, longs: +d.longAccount, shorts: +d.shortAccount }));
  cacheSet(key, out);
  return out;
}

/** Taker buy vs sell volume ratio — the official order-flow delta proxy. */
export async function getTakerFlow(symbol, points = 24) {
  const key = `taker_${symbol}_${points}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  const data = await jget(`${FUTS}/futures/data/takerlongshortRatio?symbol=${symbol}&period=1h&limit=${Math.min(points, 500)}`);
  const out = data.map(d => ({ time: +d.timestamp, buySellRatio: +d.buySellRatio }));
  cacheSet(key, out);
  return out;
}

/** Crypto Fear & Greed Index (daily). */
export async function getFearGreed(days = 30) {
  const key = `fng_${days}`;
  const hit = cacheGet(key, 60 * 60 * 1000); // hourly cache is plenty for daily data
  if (hit) return hit;
  const data = await jget(`${FNG}?limit=${days}&format=json`);
  const out = data.data.map(d => ({ time: d.timestamp * 1000, value: +d.value, label: d.valueClassification }));
  cacheSet(key, out);
  return out.reverse(); // oldest -> newest
}

/**
 * Aggregate positioning snapshot with derived features a strategy can research/gate on:
 *  - oiChangePct:          OI expansion/contraction over the full window
 *  - oiRecentChangePct:    short-window OI expansion/contraction
 *  - oiAccelerationPct:    recent OI change minus prior equal-window OI change
 *  - crowdSide:            where retail accounts lean ('long'|'short'|'neutral')
 *  - takerBias:            avg taker buy/sell over recent hours (>1 = aggressive buying)
 *  - takerRecentBias:      recent subset average to retain short-horizon information
 *  - takerImpulse:         recent average minus prior equal-window average
 *  - takerPressure:        descriptive buy/sell/balanced label
 *  - takerReversal:        whether strong payer aggression flipped sides
 *  - funding*:             payer-side pressure; descriptive RESEARCH_ONLY context
 *  - fearGreedNow:         current sentiment value
 */
export async function getContext(symbol, { oiPoints = 48, fundingPoints = 30 } = {}) {
  const [oi, gls, taker, funding, fng] = await Promise.all([
    getOpenInterestHistory(symbol, oiPoints),
    getGlobalLongShort(symbol, 24),
    getTakerFlow(symbol, 12),
    getFundingRateHistory(symbol, fundingPoints),
    getFearGreed(30),
  ]);
  const positioningDynamics = derivePositioningDynamics(oi, taker);

  const latestGls = gls[gls.length - 1];
  const crowdSide = !latestGls ? 'unknown'
    : latestGls.ratio > 2 ? 'long'      // >2:1 accounts long = crowded long
    : latestGls.ratio < 0.67 ? 'short'  // crowded short
    : 'neutral';

  const fundingFeatures = deriveFundingFeatures(funding);
  const fngNow = fng[fng.length - 1] ?? null;
  const fngAvg30 = fng.length ? +(fng.reduce((s, d) => s + d.value, 0) / fng.length).toFixed(1) : null;
  const oiUsdNow = oi[oi.length - 1]?.oiUsd ?? null;

  return {
    symbol,
    fetchedAt: new Date().toISOString(),
    oiUsdNow,
    ...positioningDynamics,
    crowdSide,
    crowdRatio: latestGls?.ratio ?? null,
    ...fundingFeatures,
    fearGreedNow: fngNow?.value ?? null,
    fearGreedLabel: fngNow?.label ?? null,
    fearGreedAvg30: fngAvg30,
    raw: { oi, gls, taker, funding },
  };
}

// ----- CLI -----
if (process.argv[1] && process.argv[1].endsWith('derivativesContext.mjs')) {
  const [, , cmd, symbol = 'COTIUSDT'] = process.argv;
  if (cmd === 'context') {
    getContext(symbol.toUpperCase())
      .then(c => console.log(JSON.stringify({ ...c, raw: undefined }, null, 2)))
      .then(() => process.exit(0))
      .catch(e => { console.error('ERROR:', e.message); process.exit(1); });
  } else if (cmd === 'oi') {
    getOpenInterestHistory(symbol.toUpperCase(), parseInt(process.argv[4] || '30', 10))
      .then(d => console.log(JSON.stringify(d.slice(-5), null, 2)))
      .then(() => process.exit(0))
      .catch(e => { console.error('ERROR:', e.message); process.exit(1); });
  } else {
    console.log('commands: context <SYMBOL> | oi <SYMBOL> <points>');
    process.exit(0);
  }
}
