// RESEARCH_ONLY mark/index dislocation capture for BTC perpetuals.
// Public read-only OKX data. Never places orders or changes trading/promotion gates.

import fs from 'node:fs';
import path from 'node:path';

const OKX = 'https://www.okx.com';
const ENDPOINTS = {
  mark: `${OKX}/api/v5/public/mark-price`,
  index: `${OKX}/api/v5/market/index-tickers`,
};

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function getJson(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': 'genesis-hq-research/1.0' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${new URL(url).pathname}`);
  const body = await res.json();
  if (body?.code !== '0' || !Array.isArray(body?.data) || !body.data.length) {
    throw new Error(`Unexpected OKX response for ${new URL(url).pathname}`);
  }
  return body.data[0];
}

export function deriveMarkIndexStress(markRow, indexRow, {
  capturedAtMs = Date.now(),
  maxAgeMs = 120_000,
} = {}) {
  const markPx = finite(markRow?.markPx);
  const indexPx = finite(indexRow?.idxPx);
  const markTs = finite(markRow?.ts);
  const indexTs = finite(indexRow?.ts);

  if (![markPx, indexPx, markTs, indexTs].every(Number.isFinite)) {
    throw new Error('mark/index values or source timestamps missing');
  }
  if (markPx <= 0 || indexPx <= 0) throw new Error('mark/index price must be positive');
  if (markTs > capturedAtMs || indexTs > capturedAtMs) throw new Error('future source timestamp');

  const markAgeMs = capturedAtMs - markTs;
  const indexAgeMs = capturedAtMs - indexTs;
  if (markAgeMs > maxAgeMs || indexAgeMs > maxAgeMs) throw new Error('stale mark/index source');

  const dislocationBps = Math.log(markPx / indexPx) * 10_000;
  return {
    markPx,
    indexPx,
    dislocationBps: +dislocationBps.toFixed(4),
    absoluteDislocationBps: +Math.abs(dislocationBps).toFixed(4),
    sourceTimes: {
      mark: new Date(markTs).toISOString(),
      index: new Date(indexTs).toISOString(),
    },
    agesMs: { mark: markAgeMs, index: indexAgeMs },
    maxAgeMs,
  };
}

export async function captureMarkIndexStress({
  instrument = 'BTC-USDT-SWAP',
  indexInstrument = 'BTC-USDT',
  out,
  jsonl,
} = {}) {
  const capturedAtMs = Date.now();
  const [mark, index] = await Promise.all([
    getJson(`${ENDPOINTS.mark}?instType=SWAP&instId=${encodeURIComponent(instrument)}`),
    getJson(`${ENDPOINTS.index}?instId=${encodeURIComponent(indexInstrument)}`),
  ]);

  const stress = deriveMarkIndexStress(mark, index, { capturedAtMs });
  const payload = {
    schemaVersion: 1,
    mode: 'RESEARCH_ONLY',
    provider: 'okx_public_market_data',
    instrument,
    indexInstrument,
    capturedAt: new Date(capturedAtMs).toISOString(),
    stress,
    provenance: {
      securityType: 'PUBLIC_READ_ONLY_NO_API_KEY',
      endpoints: ENDPOINTS,
      markInstrument: mark?.instId ?? instrument,
      indexInstrument: index?.instId ?? indexInstrument,
      markPricePurpose: 'OKX mark price; liquidation/risk-reference price, not last trade',
      sourceTimestampsRequired: true,
      failClosedOnFutureOrStaleSource: true,
    },
    interpretation: 'MARK_INDEX_DISLOCATION_OBSERVATION_ONLY_NOT_DIRECT_LIQUIDATION_COUNT',
    researchUse: 'OBSERVATIONAL_ONLY_NOT_IN_H1_NOT_FOR_RANKING',
    boundaries: {
      liveTradingEnabled: false,
      realOrdersPlaced: false,
      realTradingConfirmationsChanged: false,
      riskGatesChanged: false,
      holdoutUsedForRanking: false,
      forwardPaperPromotion: false,
    },
  };

  if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`);
  }
  if (jsonl) {
    fs.mkdirSync(path.dirname(jsonl), { recursive: true });
    fs.appendFileSync(jsonl, `${JSON.stringify(payload)}\n`);
  }
  return payload;
}

if (process.argv[1]?.endsWith('okxMarkIndexStress.mjs')) {
  const args = process.argv.slice(2);
  const valueAfter = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  captureMarkIndexStress({
    instrument: valueAfter('--instrument') || 'BTC-USDT-SWAP',
    indexInstrument: valueAfter('--index') || 'BTC-USDT',
    out: valueAfter('--out'),
    jsonl: valueAfter('--jsonl'),
  }).then(x => console.log(JSON.stringify(x, null, 2)))
    .catch(err => { console.error('ERROR:', err.message); process.exitCode = 1; });
}
