// RESEARCH_ONLY synchronized derivatives-positioning capture for BTCUSDT.
// Public read-only Binance USDⓈ-M data only. Never places orders or changes trading gates.

import fs from 'node:fs';
import path from 'node:path';
import { getContext } from './derivativesContext.mjs';

const FUTS = 'https://fapi.binance.com';
const PRICE_ENDPOINT = '/fapi/v1/klines';

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function latestByTime(rows = []) {
  return [...rows]
    .filter(row => Number.isFinite(Number(row?.time)))
    .sort((a, b) => Number(a.time) - Number(b.time))
    .at(-1) ?? null;
}

function ageMs(capturedAtMs, sourceTimeMs) {
  return Number.isFinite(sourceTimeMs) ? Math.max(0, capturedAtMs - sourceTimeMs) : null;
}

export function buildPositioningObservation(context, closedKline, {
  capturedAtMs = Date.now(),
  symbol = 'BTCUSDT',
} = {}) {
  if (!context?.raw) throw new Error('Positioning context missing raw provenance rows');
  if (!Array.isArray(closedKline) || closedKline.length < 7) throw new Error('Closed price kline missing');

  const priceOpenTime = finite(closedKline[0]);
  const priceClose = finite(closedKline[4]);
  const priceCloseTime = finite(closedKline[6]);
  if (![priceOpenTime, priceClose, priceCloseTime].every(Number.isFinite) || priceClose <= 0) {
    throw new Error('Invalid closed price kline');
  }
  if (priceCloseTime > capturedAtMs) throw new Error('Price kline is not closed at capture time');

  const oi = latestByTime(context.raw.oi);
  const taker = latestByTime(context.raw.taker);
  const funding = latestByTime(context.raw.funding);
  if (!oi || !taker || !funding) throw new Error('OI, taker and funding observations are required');

  const sourceTimes = {
    price: priceCloseTime,
    openInterest: finite(oi.time),
    taker: finite(taker.time),
    funding: finite(funding.time),
  };
  const agesMs = Object.fromEntries(Object.entries(sourceTimes).map(([key, value]) => [key, ageMs(capturedAtMs, value)]));

  // Fail closed on impossible/future or materially stale observations. These ceilings reflect
  // the native cadence of each public series, not strategy thresholds.
  const maxAgeMs = {
    price: 5 * 60_000,
    openInterest: 15 * 60_000,
    taker: 2 * 60 * 60_000,
    funding: 12 * 60 * 60_000,
  };
  for (const key of Object.keys(maxAgeMs)) {
    if (!Number.isFinite(sourceTimes[key]) || sourceTimes[key] > capturedAtMs) throw new Error(`${key} source time invalid`);
    if (!Number.isFinite(agesMs[key]) || agesMs[key] > maxAgeMs[key]) throw new Error(`${key} source stale`);
  }

  return {
    schemaVersion: 1,
    mode: 'RESEARCH_ONLY',
    provider: 'binance_usdm_public',
    symbol,
    capturedAt: new Date(capturedAtMs).toISOString(),
    price: {
      interval: '1m',
      openTime: new Date(priceOpenTime).toISOString(),
      closeTime: new Date(priceCloseTime).toISOString(),
      close: priceClose,
    },
    positioning: {
      oiUsdNow: finite(oi.oiUsd),
      oiRecentChangePct: finite(context.oiRecentChangePct),
      oiAccelerationPct: finite(context.oiAccelerationPct),
      takerBuySellRatioNow: finite(taker.buySellRatio),
      takerRecentBias: finite(context.takerRecentBias),
      takerImpulse: finite(context.takerImpulse),
      takerPressure: context.takerPressure ?? 'unknown',
      takerReversal: context.takerReversal === true,
      fundingRateNow: finite(funding.rate),
      fundingAvg: finite(context.fundingAvg),
      fundingCrowd: context.fundingCrowd ?? 'unknown',
      premiumNowBps: finite(context.premiumNowBps),
      premiumImpulseBps: finite(context.premiumImpulseBps),
    },
    provenance: {
      securityType: 'PUBLIC_READ_ONLY_NO_API_KEY',
      endpoints: {
        price: `${FUTS}${PRICE_ENDPOINT}`,
        openInterest: `${FUTS}/futures/data/openInterestHist`,
        taker: `${FUTS}/futures/data/takerlongshortRatio`,
        funding: `${FUTS}/fapi/v1/fundingRate`,
      },
      sourceTimes: Object.fromEntries(Object.entries(sourceTimes).map(([key, value]) => [key, new Date(value).toISOString()])),
      agesMs,
      maxAgeMs,
      closedPriceBarOnly: true,
    },
    researchUse: 'OBSERVATIONAL_ONLY_NOT_IN_H1_NOT_FOR_RANKING',
  };
}

async function getClosedKline(symbol) {
  const url = `${FUTS}${PRICE_ENDPOINT}?symbol=${encodeURIComponent(symbol)}&interval=1m&limit=3`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${PRICE_ENDPOINT}`);
  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error('Binance price response malformed');
  const now = Date.now();
  const closed = rows.filter(row => Number(row?.[6]) <= now).sort((a, b) => Number(a[0]) - Number(b[0])).at(-1);
  if (!closed) throw new Error('No closed 1m kline available');
  return closed;
}

export async function capturePositioning({ symbol = 'BTCUSDT', out, jsonl } = {}) {
  const upper = symbol.toUpperCase();
  const [context, kline] = await Promise.all([getContext(upper), getClosedKline(upper)]);
  const payload = buildPositioningObservation(context, kline, { capturedAtMs: Date.now(), symbol: upper });

  if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`);
  }
  if (jsonl) {
    fs.mkdirSync(path.dirname(jsonl), { recursive: true });
    let duplicate = false;
    try {
      const last = fs.readFileSync(jsonl, 'utf8').trim().split('\n').at(-1);
      if (last) duplicate = JSON.parse(last)?.price?.closeTime === payload.price.closeTime;
    } catch { /* first write */ }
    if (!duplicate) fs.appendFileSync(jsonl, `${JSON.stringify(payload)}\n`);
  }
  return payload;
}

if (process.argv[1]?.endsWith('positioningDynamicsCapture.mjs')) {
  const args = process.argv.slice(2);
  const valueAfter = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  capturePositioning({
    symbol: valueAfter('--symbol') || 'BTCUSDT',
    out: valueAfter('--out'),
    jsonl: valueAfter('--jsonl'),
  }).then(x => console.log(JSON.stringify(x, null, 2)))
    .catch(err => { console.error('ERROR:', err.message); process.exitCode = 1; });
}
