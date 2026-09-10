// RESEARCH_ONLY cross-market spot/perpetual capture for BTC-USDT.
// Public OKX market data only. Never places orders or changes trading gates.

import fs from 'node:fs';
import path from 'node:path';

const CANDLES = 'https://www.okx.com/api/v5/market/candles';
const BOOKS = 'https://www.okx.com/api/v5/market/books';
const CANDLE_LIMIT = 20;
const BOOK_DEPTH = 5;
const VOL_BASELINE_RETURNS = 15;

async function getMarketData(endpoint, params) {
  const url = `${endpoint}?${new URLSearchParams(params)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${endpoint}`);
  const body = await res.json();
  if (String(body?.code) !== '0' || !Array.isArray(body?.data)) {
    throw new Error(`OKX market data error: ${body?.code ?? 'unknown'} ${body?.msg ?? ''}`.trim());
  }
  return body.data;
}

async function getCandles(instId) {
  return getMarketData(CANDLES, { instId, bar: '1m', limit: String(CANDLE_LIMIT) });
}

async function getBook(instId) {
  const data = await getMarketData(BOOKS, { instId, sz: String(BOOK_DEPTH) });
  return data[0] ?? null;
}

function parseKline(row) {
  return {
    openTime: Number(row[0]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    baseVolume: Number(row[5]),
    quoteVolume: Number(row[7]),
    confirmed: String(row[8]) === '1',
  };
}

function pctReturn(prev, next) {
  return Number.isFinite(prev) && prev > 0 && Number.isFinite(next)
    ? ((next / prev) - 1) * 10_000
    : null;
}

function rms(values) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return null;
  return Math.sqrt(finite.reduce((sum, value) => sum + value ** 2, 0) / finite.length);
}

function volatilityContext(aligned) {
  const spotReturns = [];
  const futuresReturns = [];
  for (let i = 1; i < aligned.length; i += 1) {
    spotReturns.push(pctReturn(aligned[i - 1].spot.close, aligned[i].spot.close));
    futuresReturns.push(pctReturn(aligned[i - 1].futures.close, aligned[i].futures.close));
  }

  const spotBaseline = spotReturns.slice(-(VOL_BASELINE_RETURNS + 1), -1);
  const futuresBaseline = futuresReturns.slice(-(VOL_BASELINE_RETURNS + 1), -1);
  const available = spotBaseline.length === VOL_BASELINE_RETURNS
    && futuresBaseline.length === VOL_BASELINE_RETURNS
    && spotBaseline.every(Number.isFinite)
    && futuresBaseline.every(Number.isFinite);

  if (!available) {
    return {
      available: false,
      baselineReturnCount: Math.min(spotBaseline.length, futuresBaseline.length),
      baselineWindowMinutes: VOL_BASELINE_RETURNS,
      spotRms15mBps: null,
      futuresRms15mBps: null,
      spotShockRatio: null,
      futuresShockRatio: null,
    };
  }

  const spotRms = rms(spotBaseline);
  const futuresRms = rms(futuresBaseline);
  const currentSpot = spotReturns.at(-1);
  const currentFutures = futuresReturns.at(-1);
  return {
    available: true,
    baselineReturnCount: VOL_BASELINE_RETURNS,
    baselineWindowMinutes: VOL_BASELINE_RETURNS,
    spotRms15mBps: Number.isFinite(spotRms) ? +spotRms.toFixed(4) : null,
    futuresRms15mBps: Number.isFinite(futuresRms) ? +futuresRms.toFixed(4) : null,
    spotShockRatio: Number.isFinite(spotRms) && spotRms > 0 ? +(Math.abs(currentSpot) / spotRms).toFixed(4) : null,
    futuresShockRatio: Number.isFinite(futuresRms) && futuresRms > 0 ? +(Math.abs(currentFutures) / futuresRms).toFixed(4) : null,
  };
}

export function parseTopOfBook(book) {
  const bid = Number(book?.bids?.[0]?.[0]);
  const ask = Number(book?.asks?.[0]?.[0]);
  const sourceTs = Number(book?.ts);
  const valid = Number.isFinite(bid) && bid > 0 && Number.isFinite(ask) && ask > bid && Number.isFinite(sourceTs) && sourceTs > 0;
  if (!valid) return { available: false, bid: null, ask: null, mid: null, spreadBps: null, sourceAsOf: null };
  const mid = (bid + ask) / 2;
  return {
    available: true,
    bid,
    ask,
    mid: +mid.toFixed(8),
    spreadBps: +(((ask - bid) / mid) * 10_000).toFixed(4),
    sourceAsOf: new Date(sourceTs).toISOString(),
  };
}

export function buildExecutionFriction(spotBook, futuresBook) {
  const spot = parseTopOfBook(spotBook);
  const futures = parseTopOfBook(futuresBook);
  return {
    available: spot.available && futures.available,
    spot,
    futures,
    conservativeRoundTripTopOfBookBps: spot.available && futures.available
      ? +(2 * Math.max(spot.spreadBps, futures.spreadBps)).toFixed(4)
      : null,
    policy: 'OBSERVATIONAL_TOP_OF_BOOK_ONLY_NO_SLIPPAGE_MODEL_NO_GATE_OR_RANKING_USE',
  };
}

export function buildCrossMarketObservation(spotRows, futuresRows, {
  symbol = 'BTC-USDT', spotBook = null, futuresBook = null,
} = {}) {
  const spot = spotRows.map(parseKline).filter(r => r.confirmed).sort((a, b) => a.openTime - b.openTime);
  const futures = futuresRows.map(parseKline).filter(r => r.confirmed).sort((a, b) => a.openTime - b.openTime);
  const futuresByTime = new Map(futures.map(r => [r.openTime, r]));
  const aligned = spot.map(s => ({ spot: s, futures: futuresByTime.get(s.openTime) })).filter(x => x.futures);
  if (aligned.length < 2) throw new Error('Need at least two aligned confirmed 1m bars');

  const prev = aligned.at(-2);
  const cur = aligned.at(-1);
  const basisBps = ((cur.futures.close / cur.spot.close) - 1) * 10_000;
  const spotReturnBps = pctReturn(prev.spot.close, cur.spot.close);
  const futuresReturnBps = pctReturn(prev.futures.close, cur.futures.close);
  const volatility = volatilityContext(aligned);
  const executionFriction = buildExecutionFriction(spotBook, futuresBook);
  const futuresToSpotQuoteVolumeRatio = Number.isFinite(cur.spot.quoteVolume) && cur.spot.quoteVolume > 0
    ? cur.futures.quoteVolume / cur.spot.quoteVolume
    : null;

  return {
    schemaVersion: 3,
    mode: 'RESEARCH_ONLY',
    provider: 'okx_public_market_data',
    symbol,
    spotInstId: 'BTC-USDT',
    futuresInstId: 'BTC-USDT-SWAP',
    interval: '1m',
    barOpenTime: new Date(cur.spot.openTime).toISOString(),
    barCloseTime: new Date(cur.spot.openTime + 59_999).toISOString(),
    features: {
      spotClose: cur.spot.close,
      futuresClose: cur.futures.close,
      basisBps: +basisBps.toFixed(4),
      spotReturn1mBps: +spotReturnBps.toFixed(4),
      futuresReturn1mBps: +futuresReturnBps.toFixed(4),
      returnSpread1mBps: +(futuresReturnBps - spotReturnBps).toFixed(4),
      spotQuoteVolume: cur.spot.quoteVolume,
      futuresQuoteVolume: cur.futures.quoteVolume,
      futuresToSpotQuoteVolumeRatio: Number.isFinite(futuresToSpotQuoteVolumeRatio)
        ? +futuresToSpotQuoteVolumeRatio.toFixed(4)
        : null,
      volatility,
      executionFriction,
    },
    provenance: {
      endpoint: CANDLES,
      orderBookEndpoint: BOOKS,
      requestBar: '1m',
      requestLimit: CANDLE_LIMIT,
      orderBookDepth: BOOK_DEPTH,
      spotInstId: 'BTC-USDT',
      futuresInstId: 'BTC-USDT-SWAP',
      confirmedBarsOnly: true,
      volatilityBaselinePolicy: 'CURRENT_CLOSED_1M_RETURN_VS_PRECEDING_15_CLOSED_ALIGNED_1M_RETURNS_RMS',
      executionFrictionPolicy: 'CURRENT_PUBLIC_TOP_OF_BOOK_SNAPSHOT_WITH_EXCHANGE_SOURCE_TIMESTAMP_OBSERVATIONAL_ONLY',
      securityType: 'PUBLIC_READ_ONLY_NO_API_KEY',
    },
    researchUse: 'OBSERVATIONAL_ONLY_NOT_IN_H1_NOT_FOR_RANKING',
  };
}

export async function captureCrossMarket({ out, jsonl } = {}) {
  const [spotRows, futuresRows, spotBook, futuresBook] = await Promise.all([
    getCandles('BTC-USDT'),
    getCandles('BTC-USDT-SWAP'),
    getBook('BTC-USDT'),
    getBook('BTC-USDT-SWAP'),
  ]);
  const observation = buildCrossMarketObservation(spotRows, futuresRows, { spotBook, futuresBook });
  const payload = { ...observation, capturedAt: new Date().toISOString() };

  if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`);
  }
  if (jsonl) {
    fs.mkdirSync(path.dirname(jsonl), { recursive: true });
    let duplicate = false;
    try {
      const last = fs.readFileSync(jsonl, 'utf8').trim().split('\n').at(-1);
      if (last) duplicate = JSON.parse(last).barOpenTime === payload.barOpenTime;
    } catch { /* first write */ }
    if (!duplicate) fs.appendFileSync(jsonl, `${JSON.stringify(payload)}\n`);
  }
  return payload;
}

if (process.argv[1]?.endsWith('crossMarketLeadLagCapture.mjs')) {
  const args = process.argv.slice(2);
  const valueAfter = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  captureCrossMarket({
    out: valueAfter('--out'),
    jsonl: valueAfter('--jsonl'),
  }).then(x => console.log(JSON.stringify(x, null, 2)))
    .catch(err => { console.error('ERROR:', err.message); process.exitCode = 1; });
}
