// RESEARCH_ONLY spot-vs-perpetual taker-flow divergence capture.
// Public read-only OKX market data only. Never places orders or changes trading/risk gates.

import fs from 'node:fs';
import path from 'node:path';
import { fetchFixedWindowTaker } from './okxFixedWindowTaker.mjs';

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function buildSpotPerpTakerDivergence(spot, perp, {
  capturedAtMs = Date.now(),
  maxWindowEndSkewMs = 15_000,
} = {}) {
  if (!spot?.available || !perp?.available) {
    throw new Error('Both spot and perpetual fixed-window taker evidence are required');
  }
  const required = [
    spot.time, perp.time,
    spot.targetWindowMs, perp.targetWindowMs,
    spot.coverageMs, perp.coverageMs,
    spot.notionalBuyFraction, perp.notionalBuyFraction,
  ].map(finite);
  if (!required.every(Number.isFinite)) throw new Error('Incomplete taker provenance');

  const [spotTime, perpTime, spotWindowMs, perpWindowMs, spotCoverageMs, perpCoverageMs, spotBuy, perpBuy] = required;
  const endSkewMs = Math.abs(spotTime - perpTime);
  if (spotTime > capturedAtMs || perpTime > capturedAtMs) throw new Error('Future taker evidence');
  if (endSkewMs > maxWindowEndSkewMs) throw new Error(`Spot/perp taker windows not synchronized: ${endSkewMs}ms`);
  if (spotCoverageMs < spotWindowMs * 0.9 || perpCoverageMs < perpWindowMs * 0.9) throw new Error('Insufficient fixed-window coverage');

  return {
    schemaVersion: 1,
    mode: 'RESEARCH_ONLY',
    provider: 'okx_public_market_data',
    symbol: 'BTCUSDT',
    capturedAt: new Date(capturedAtMs).toISOString(),
    windowMs: Math.max(spotWindowMs, perpWindowMs),
    spot: {
      instrument: 'BTC-USDT',
      notionalBuyFraction: spotBuy,
      tradeCount: finite(spot.tradeCount),
      coverageMs: spotCoverageMs,
      windowEndTime: new Date(spotTime).toISOString(),
    },
    perpetual: {
      instrument: 'BTC-USDT-SWAP',
      notionalBuyFraction: perpBuy,
      tradeCount: finite(perp.tradeCount),
      coverageMs: perpCoverageMs,
      windowEndTime: new Date(perpTime).toISOString(),
    },
    divergence: {
      perpMinusSpotNotionalBuyFraction: perpBuy - spotBuy,
      absoluteDifference: Math.abs(perpBuy - spotBuy),
    },
    provenance: {
      securityType: 'PUBLIC_READ_ONLY_NO_API_KEY',
      endpoints: ['/api/v5/market/trades', '/api/v5/market/history-trades'],
      fixedWindow: true,
      windowEndSkewMs: endSkewMs,
      maxWindowEndSkewMs,
      normalization: 'WITHIN_INSTRUMENT_NOTIONAL_BUY_FRACTION',
      rawSpotVsPerpSizeComparisonForbidden: true,
      note: 'Spot base-asset size and perpetual contract size are not compared directly; each instrument is normalized to its own notional buy fraction before divergence is computed.',
    },
    researchUse: 'OBSERVATIONAL_ONLY_NOT_IN_H1_NOT_FOR_RANKING',
  };
}

export async function captureSpotPerpTakerDivergence({ out, jsonl } = {}) {
  const options = { windowMs: 60_000, minimumCoverageRatio: 0.9, maxPages: 20 };
  // Sequential requests reduce rate-limit pressure. Synchronization is validated from exchange timestamps.
  const spot = await fetchFixedWindowTaker('BTC-USDT', options);
  const perp = await fetchFixedWindowTaker('BTC-USDT-SWAP', options);
  const payload = buildSpotPerpTakerDivergence(spot, perp, { capturedAtMs: Date.now() });

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

if (process.argv[1]?.endsWith('spotPerpTakerDivergenceCapture.mjs')) {
  const args = process.argv.slice(2);
  const valueAfter = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  captureSpotPerpTakerDivergence({ out: valueAfter('--out'), jsonl: valueAfter('--jsonl') })
    .then(x => console.log(JSON.stringify(x, null, 2)))
    .catch(err => { console.error('ERROR:', err.message); process.exitCode = 1; });
}
