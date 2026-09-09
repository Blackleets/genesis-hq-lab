// RESEARCH_ONLY cross-market spot/perpetual capture for BTCUSDT.
// Public Binance market data only. Never places orders or changes trading gates.

import fs from 'node:fs';
import path from 'node:path';

const SPOT = 'https://api.binance.com/api/v3/klines';
const FUTURES = 'https://fapi.binance.com/fapi/v1/klines';

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.split('?')[0]}`);
  return res.json();
}

function parseKline(row) {
  return {
    openTime: Number(row[0]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    baseVolume: Number(row[5]),
    closeTime: Number(row[6]),
    quoteVolume: Number(row[7]),
    trades: Number(row[8]),
    takerBuyBase: Number(row[9]),
    takerBuyQuote: Number(row[10]),
  };
}

function pctReturn(prev, next) {
  return Number.isFinite(prev) && prev > 0 && Number.isFinite(next)
    ? ((next / prev) - 1) * 10_000
    : null;
}

function takerBuyShare(row) {
  return Number.isFinite(row.quoteVolume) && row.quoteVolume > 0
    ? row.takerBuyQuote / row.quoteVolume
    : null;
}

export function buildCrossMarketObservation(spotRows, futuresRows, { now = Date.now(), symbol = 'BTCUSDT' } = {}) {
  const spot = spotRows.map(parseKline).filter(r => r.closeTime < now);
  const futures = futuresRows.map(parseKline).filter(r => r.closeTime < now);
  const futuresByTime = new Map(futures.map(r => [r.openTime, r]));
  const aligned = spot.map(s => ({ spot: s, futures: futuresByTime.get(s.openTime) })).filter(x => x.futures);
  if (aligned.length < 2) throw new Error('Need at least two aligned closed 1m bars');

  const prev = aligned.at(-2);
  const cur = aligned.at(-1);
  const basisBps = ((cur.futures.close / cur.spot.close) - 1) * 10_000;
  const spotReturnBps = pctReturn(prev.spot.close, cur.spot.close);
  const futuresReturnBps = pctReturn(prev.futures.close, cur.futures.close);

  return {
    schemaVersion: 1,
    mode: 'RESEARCH_ONLY',
    provider: 'binance_public_market_data',
    symbol,
    interval: '1m',
    barOpenTime: new Date(cur.spot.openTime).toISOString(),
    barCloseTime: new Date(Math.min(cur.spot.closeTime, cur.futures.closeTime)).toISOString(),
    features: {
      spotClose: cur.spot.close,
      futuresClose: cur.futures.close,
      basisBps: +basisBps.toFixed(4),
      spotReturn1mBps: +spotReturnBps.toFixed(4),
      futuresReturn1mBps: +futuresReturnBps.toFixed(4),
      returnSpread1mBps: +(futuresReturnBps - spotReturnBps).toFixed(4),
      spotQuoteVolume: cur.spot.quoteVolume,
      futuresQuoteVolume: cur.futures.quoteVolume,
      spotTakerBuyShare: +takerBuyShare(cur.spot).toFixed(6),
      futuresTakerBuyShare: +takerBuyShare(cur.futures).toFixed(6),
      takerBuyShareSpread: +(takerBuyShare(cur.futures) - takerBuyShare(cur.spot)).toFixed(6),
    },
    provenance: {
      spotEndpoint: SPOT,
      futuresEndpoint: FUTURES,
      securityType: 'NONE_PUBLIC_READ_ONLY',
    },
    researchUse: 'OBSERVATIONAL_ONLY_NOT_IN_H1_NOT_FOR_RANKING',
  };
}

export async function captureCrossMarket({ symbol = 'BTCUSDT', out, jsonl } = {}) {
  const q = `symbol=${encodeURIComponent(symbol)}&interval=1m&limit=4`;
  const [spotRows, futuresRows] = await Promise.all([
    getJson(`${SPOT}?${q}`),
    getJson(`${FUTURES}?${q}`),
  ]);
  const observation = buildCrossMarketObservation(spotRows, futuresRows, { symbol });
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
    symbol: valueAfter('--symbol') || 'BTCUSDT',
    out: valueAfter('--out'),
    jsonl: valueAfter('--jsonl'),
  }).then(x => console.log(JSON.stringify(x, null, 2)))
    .catch(err => { console.error('ERROR:', err.message); process.exitCode = 1; });
}
