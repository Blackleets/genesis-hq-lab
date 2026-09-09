// RESEARCH_ONLY synchronized derivatives-positioning capture for BTCUSDT.
// Public read-only OKX data only. Never places orders or changes trading gates.

import fs from 'node:fs';
import path from 'node:path';
import { getOkxResearchContexts } from './okxResearchContext.mjs';
import { fetchFixedWindowTaker } from './okxFixedWindowTaker.mjs';

const OKX = 'https://www.okx.com';
const OKX_ENDPOINTS = {
  price: `${OKX}/api/v5/market/candles`,
  openInterest: `${OKX}/api/v5/public/open-interest`,
  taker: `${OKX}/api/v5/market/history-trades`,
  funding: `${OKX}/api/v5/public/funding-rate-history`,
};

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

function takerWindowMs(observation) {
  return finite(observation?.positioning?.takerWindowMs)
    ?? finite(observation?.provenance?.takerWindowMs)
    ?? null;
}

export function deriveCrossCapturePositioningFeatures(previous, current, { maxGapMinutes = 60 } = {}) {
  if (!previous || !current) return { available: false, reason: 'NO_PRIOR_CAPTURE' };
  if (previous.mode !== 'RESEARCH_ONLY' || current.mode !== 'RESEARCH_ONLY') {
    return { available: false, reason: 'MODE_MISMATCH' };
  }
  if (previous.provider !== current.provider || previous.symbol !== current.symbol) {
    return { available: false, reason: 'SERIES_MISMATCH' };
  }
  if (previous.schemaVersion !== current.schemaVersion) {
    return { available: false, reason: 'SCHEMA_MISMATCH' };
  }

  const previousMs = Date.parse(previous.capturedAt);
  const currentMs = Date.parse(current.capturedAt);
  const elapsedMs = currentMs - previousMs;
  if (!Number.isFinite(previousMs) || !Number.isFinite(currentMs) || elapsedMs <= 0) {
    return { available: false, reason: 'NON_CAUSAL_TIME_ORDER' };
  }
  if (elapsedMs > maxGapMinutes * 60_000) {
    return { available: false, reason: 'PRIOR_CAPTURE_TOO_OLD', elapsedMinutes: elapsedMs / 60_000 };
  }

  const previousWindowMs = takerWindowMs(previous);
  const currentWindowMs = takerWindowMs(current);
  if (!Number.isFinite(previousWindowMs) || !Number.isFinite(currentWindowMs) || previousWindowMs <= 0 || currentWindowMs <= 0) {
    return { available: false, reason: 'TAKER_WINDOW_PROVENANCE_MISSING', elapsedMinutes: elapsedMs / 60_000 };
  }
  const minimumSeparationMs = Math.max(previousWindowMs, currentWindowMs);
  if (elapsedMs < minimumSeparationMs) {
    return {
      available: false,
      reason: 'OVERLAPPING_TAKER_WINDOWS',
      elapsedMinutes: elapsedMs / 60_000,
      minimumSeparationMinutes: minimumSeparationMs / 60_000,
    };
  }

  const previousOi = finite(previous.positioning?.openInterest?.value);
  const currentOi = finite(current.positioning?.openInterest?.value);
  const previousTaker = finite(previous.positioning?.takerBuySellRatioNow);
  const currentTaker = finite(current.positioning?.takerBuySellRatioNow);
  const previousFunding = finite(previous.positioning?.fundingRateNow);
  const currentFunding = finite(current.positioning?.fundingRateNow);
  const previousPremium = finite(previous.positioning?.premiumNowBps);
  const currentPremium = finite(current.positioning?.premiumNowBps);
  const previousClose = finite(previous.price?.close);
  const currentClose = finite(current.price?.close);

  if (![previousOi, currentOi, previousTaker, currentTaker, previousFunding, currentFunding, previousPremium, currentPremium, previousClose, currentClose].every(Number.isFinite)) {
    return { available: false, reason: 'MISSING_REQUIRED_FEATURE' };
  }
  if (previousOi <= 0 || previousClose <= 0 || currentClose <= 0) {
    return { available: false, reason: 'INVALID_DENOMINATOR' };
  }

  const previousBuyFraction = finite(previous.positioning?.takerBuyFractionNow);
  const currentBuyFraction = finite(current.positioning?.takerBuyFractionNow);

  return {
    available: true,
    priorCapturedAt: previous.capturedAt,
    elapsedMinutes: elapsedMs / 60_000,
    minimumSeparationMinutes: minimumSeparationMs / 60_000,
    oiChangePct: ((currentOi / previousOi) - 1) * 100,
    takerBuySellRatioDelta: currentTaker - previousTaker,
    takerBuyFractionDelta: Number.isFinite(previousBuyFraction) && Number.isFinite(currentBuyFraction)
      ? currentBuyFraction - previousBuyFraction
      : null,
    fundingDeltaBps: (currentFunding - previousFunding) * 10_000,
    premiumDeltaBps: currentPremium - previousPremium,
    perpReturnBps: Math.log(currentClose / previousClose) * 10_000,
    causal: true,
    nonOverlappingTakerWindows: true,
    researchUse: 'OBSERVATIONAL_ONLY_NOT_FOR_RANKING',
  };
}

export function buildPositioningObservation(context, closedKline, {
  capturedAtMs = Date.now(),
  symbol = 'BTCUSDT',
  provider = 'okx_public_market_data',
  endpoints = OKX_ENDPOINTS,
  openInterestUnit = 'SOURCE_NATIVE_UNITS',
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
  // native series cadence and evidence quality only; they are not trading/promotion thresholds.
  const maxAgeMs = {
    price: 5 * 60_000,
    openInterest: 15 * 60_000,
    taker: 2 * 60_000,
    funding: 12 * 60 * 60_000,
  };
  for (const key of Object.keys(maxAgeMs)) {
    if (!Number.isFinite(sourceTimes[key]) || sourceTimes[key] > capturedAtMs) throw new Error(`${key} source time invalid`);
    if (!Number.isFinite(agesMs[key]) || agesMs[key] > maxAgeMs[key]) throw new Error(`${key} source stale`);
  }

  const oiValue = finite(oi.oi ?? oi.oiUsd);
  if (!Number.isFinite(oiValue)) throw new Error('Open interest value missing');

  return {
    schemaVersion: 4,
    mode: 'RESEARCH_ONLY',
    provider,
    symbol,
    capturedAt: new Date(capturedAtMs).toISOString(),
    price: {
      interval: '1m',
      openTime: new Date(priceOpenTime).toISOString(),
      closeTime: new Date(priceCloseTime).toISOString(),
      close: priceClose,
    },
    positioning: {
      openInterest: { value: oiValue, unit: openInterestUnit },
      oiRecentChangePct: finite(context.oiRecentChangePct),
      oiAccelerationPct: finite(context.oiAccelerationPct),
      takerBuySellRatioNow: finite(taker.buySellRatio),
      takerBuyFractionNow: finite(taker.buyFraction),
      takerNotionalBuyFractionNow: finite(taker.notionalBuyFraction),
      takerTradeCount: finite(taker.tradeCount),
      takerWindowMs: finite(taker.targetWindowMs),
      takerWindowCoverageMs: finite(taker.coverageMs),
      takerRecentBias: finite(context.takerRecentBias),
      takerImpulse: finite(context.takerImpulse),
      takerPressure: context.takerPressure ?? 'unknown',
      takerReversal: context.takerReversal === true,
      fundingRateNow: finite(funding.rate),
      fundingAvg: finite(context.fundingAvg),
      fundingCrowd: context.fundingCrowd ?? 'unknown',
      premiumNowBps: finite(context.premiumNowBps),
      premiumImpulseBps: finite(context.premiumImpulseBps),
      volatilityState: context.volatilityState ?? 'unknown',
      volatilityExpansionRatio: finite(context.volatilityExpansionRatio),
    },
    crossCapture: { available: false, reason: 'NOT_DERIVED_YET' },
    provenance: {
      securityType: 'PUBLIC_READ_ONLY_NO_API_KEY',
      endpoints,
      instrument: 'BTC-USDT-SWAP',
      sourceTimes: Object.fromEntries(Object.entries(sourceTimes).map(([key, value]) => [key, new Date(value).toISOString()])),
      agesMs,
      maxAgeMs,
      closedPriceBarOnly: true,
      fixedWindowTakerFlow: true,
      takerWindowMs: finite(taker.targetWindowMs),
      takerWindowCoverageMs: finite(taker.coverageMs),
      takerTradeCount: finite(taker.tradeCount),
      takerPagesFetched: finite(taker.pagesFetched),
      takerSampleSource: taker.source ?? null,
      crossCaptureUsesStrictlyPriorDurableObservation: true,
      crossCaptureRequiresSameSchema: true,
      crossCaptureRequiresNonOverlappingTakerWindows: true,
      note: 'openInterest.value preserves provider-native contract units; taker flow uses a fixed one-minute public-trade window; cross-capture deltas require same-schema non-overlapping taker windows',
    },
    researchUse: 'OBSERVATIONAL_ONLY_NOT_IN_H1_NOT_FOR_RANKING',
  };
}

function readLastJsonlObservation(jsonl) {
  if (!jsonl) return null;
  try {
    const last = fs.readFileSync(jsonl, 'utf8').trim().split('\n').filter(Boolean).at(-1);
    return last ? JSON.parse(last) : null;
  } catch {
    return null;
  }
}

export async function capturePositioning({ symbol = 'BTCUSDT', out, jsonl } = {}) {
  const upper = symbol.toUpperCase();
  const contexts = await getOkxResearchContexts(upper, { points: 120 });
  const context = contexts.derivatives;
  const bar = context?.raw?.volatility?.at(-1);
  if (!bar) throw new Error('No confirmed OKX 1m perpetual bar available');

  const fixedTaker = await fetchFixedWindowTaker('BTC-USDT-SWAP', {
    windowMs: 60_000,
    minimumCoverageRatio: 0.9,
    maxPages: 20,
  });
  if (!fixedTaker.available) throw new Error(`Fixed-window taker flow unavailable: ${fixedTaker.reason}`);

  const buyFraction = fixedTaker.buyFraction;
  const fixedContext = {
    ...context,
    takerRecentBias: fixedTaker.buySellRatio,
    takerImpulse: null,
    takerPressure: buyFraction >= 0.55 ? 'buy_pressure' : buyFraction <= 0.45 ? 'sell_pressure' : 'balanced',
    takerReversal: false,
    raw: {
      ...context.raw,
      taker: [{ ...fixedTaker, time: fixedTaker.time }],
    },
  };

  const kline = [bar.time, bar.open, bar.high, bar.low, bar.close, bar.volumeQuote, Number(bar.time) + 59_999];
  const payload = buildPositioningObservation(fixedContext, kline, {
    capturedAtMs: Date.now(),
    symbol: upper,
    provider: 'okx_public_market_data',
    endpoints: OKX_ENDPOINTS,
    openInterestUnit: 'CONTRACTS',
  });

  const prior = readLastJsonlObservation(jsonl);
  payload.crossCapture = deriveCrossCapturePositioningFeatures(prior, payload);

  if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`);
  }
  if (jsonl) {
    fs.mkdirSync(path.dirname(jsonl), { recursive: true });
    const duplicate = prior?.price?.closeTime === payload.price.closeTime;
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
