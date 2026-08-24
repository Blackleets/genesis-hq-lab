// server/genesis/derivativesContext.mjs
// DERIVATIVES CONTEXT — market dimensions beyond price candles.
// Free official Binance futures endpoints (NO API key needed):
//   - Open interest history      GET /futures/data/openInterestHist
//   - Global long/short accounts GET /futures/data/globalLongShortAccountRatio
//   - Top trader position ratio  GET /futures/data/topLongShortPositionRatio
//   - Taker buy/sell volume      GET /futures/data/takerlongshortRatio  (order-flow delta proxy)
// Sentiment:
//   - Fear & Greed Index         GET https://api.alternative.me/fng/?limit=N
//
// Purpose: give strategies/regime filters access to POSITIONING data, not just price.
// All fetchers are read-only public data; cached to disk like candle_cache.
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

// fapi /futures/data/* endpoints: IP weight 1 each on Binance futures.
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
 * Aggregate positioning snapshot with derived features a strategy can gate on:
 *  - oiChangePct:    OI expansion/contraction over the window
 *  - crowdSide:      where retail accounts lean ('long'|'short'|'neutral')
 *  - takerBias:      avg taker buy/sell over recent hours (>1 = aggressive buying)
 *  - fearGreedNow:   current sentiment value
 */
export async function getContext(symbol, { oiPoints = 48 } = {}) {
  const [oi, gls, taker, fng] = await Promise.all([
    getOpenInterestHistory(symbol, oiPoints),
    getGlobalLongShort(symbol, 24),
    getTakerFlow(symbol, 12),
    getFearGreed(30),
  ]);
  const first = oi[0]?.oiUsd ?? 0;
  const last = oi[oi.length - 1]?.oiUsd ?? 0;
  const oiChangePct = first ? +(((last - first) / first) * 100).toFixed(2) : null;

  const latestGls = gls[gls.length - 1];
  const crowdSide = !latestGls ? 'unknown'
    : latestGls.ratio > 2 ? 'long'      // >2:1 accounts long = crowded long
    : latestGls.ratio < 0.67 ? 'short'  // crowded short
    : 'neutral';

  const takerAvg = taker.length ? +(taker.reduce((s, d) => s + d.buySellRatio, 0) / taker.length).toFixed(3) : null;
  const fngNow = fng[fng.length - 1] ?? null;
  const fngAvg30 = fng.length ? +(fng.reduce((s, d) => s + d.value, 0) / fng.length).toFixed(1) : null;

  return {
    symbol,
    fetchedAt: new Date().toISOString(),
    oiUsdNow: last || null,
    oiChangePct,
    crowdSide,
    crowdRatio: latestGls?.ratio ?? null,
    takerBias: takerAvg,
    fearGreedNow: fngNow?.value ?? null,
    fearGreedLabel: fngNow?.label ?? null,
    fearGreedAvg30: fngAvg30,
    raw: { oi, gls, taker },
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
