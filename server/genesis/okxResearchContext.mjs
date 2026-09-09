// server/genesis/okxResearchContext.mjs
// RESEARCH_ONLY redundant public market-data adapter for synchronized evidence.
// Read-only: no credentials, orders, candidate promotion, REAL_TRADING changes or gate changes.

import { deriveFundingFeatures, derivePremiumFeatures, derivePositioningDynamics } from './derivativesContext.mjs';
import { deriveSpotPerpLeadLag } from './spotPerpLeadLag.mjs';

const BASE = 'https://www.okx.com';

async function okx(path, fetchImpl = fetch) {
  const res = await fetchImpl(`${BASE}${path}`, {
    headers: { 'user-agent': 'genesis-hq-research-only/1.0' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path.split('?')[0]}`);
  const payload = await res.json();
  if (String(payload?.code ?? '') !== '0' || !Array.isArray(payload?.data)) {
    throw new Error(`OKX ${payload?.code ?? 'invalid'} for ${path.split('?')[0]}`);
  }
  return payload.data;
}

function ids(symbol) {
  const s = String(symbol || '').toUpperCase();
  if (s !== 'BTCUSDT') throw new Error(`OKX research fallback currently supports BTCUSDT only: ${s}`);
  return { spot: 'BTC-USDT', perp: 'BTC-USDT-SWAP', ccy: 'BTC' };
}

function candles(rows = []) {
  return rows.map(r => ({ time: +r[0], close: +r[4] }))
    .filter(r => Number.isFinite(r.time) && Number.isFinite(r.close) && r.close > 0)
    .sort((a, b) => a.time - b.time);
}

function funding(rows = []) {
  return rows.map(r => ({ time: +r.fundingTime, rate: +r.fundingRate, markPrice: null }))
    .filter(r => Number.isFinite(r.time) && Number.isFinite(r.rate))
    .sort((a, b) => a.time - b.time);
}

function oi(rows = []) {
  return rows.map(r => ({ time: +r.ts, oi: +r.oi, oiUsd: +(r.oiUsd ?? r.oiCcy) }))
    .filter(r => Number.isFinite(r.time) && Number.isFinite(r.oi))
    .sort((a, b) => a.time - b.time);
}

function taker(rows = []) {
  if (!rows.length) return [];
  let buy = 0; let sell = 0; let latest = 0;
  for (const r of rows) {
    const size = +r.sz;
    const ts = +r.ts;
    if (!Number.isFinite(size) || !Number.isFinite(ts)) continue;
    latest = Math.max(latest, ts);
    if (r.side === 'buy') buy += size;
    if (r.side === 'sell') sell += size;
  }
  if (!latest || sell <= 0) return [];
  return [{ time: latest, buySellRatio: buy / sell }];
}

function premiumFromCandles(spotRows, perpRows) {
  const spot = new Map(spotRows.map(r => [r.time, r.close]));
  return perpRows.filter(r => spot.has(r.time)).map(r => ({
    time: r.time,
    close: (r.close / spot.get(r.time)) - 1,
  }));
}

export async function getOkxResearchContexts(symbol = 'BTCUSDT', { points = 120, fetchImpl = fetch } = {}) {
  const { spot, perp } = ids(symbol);
  const limit = Math.max(20, Math.min(Number(points) || 120, 300));
  const [fundingRaw, oiRaw, perpRaw, spotRaw, tradesRaw] = await Promise.all([
    okx(`/api/v5/public/funding-rate-history?instId=${perp}&limit=30`, fetchImpl),
    okx(`/api/v5/public/open-interest?instType=SWAP&instId=${perp}`, fetchImpl),
    okx(`/api/v5/market/candles?instId=${perp}&bar=1m&limit=${limit}`, fetchImpl),
    okx(`/api/v5/market/candles?instId=${spot}&bar=1m&limit=${limit}`, fetchImpl),
    okx(`/api/v5/market/trades?instId=${perp}&limit=100`, fetchImpl),
  ]);

  const spotRows = candles(spotRaw);
  const perpRows = candles(perpRaw);
  const fundingRows = funding(fundingRaw);
  const oiRows = oi(oiRaw);
  const takerRows = taker(tradesRaw);
  const premiumRows = premiumFromCandles(spotRows, perpRows);
  const positioning = derivePositioningDynamics(oiRows, takerRows);
  const fundingFeatures = deriveFundingFeatures(fundingRows);
  const premiumFeatures = derivePremiumFeatures(premiumRows);
  const leadLagFeatures = deriveSpotPerpLeadLag(spotRows, perpRows);

  return {
    provider: 'okx',
    derivatives: {
      symbol,
      fetchedAt: new Date().toISOString(),
      oiUsdNow: oiRows.at(-1)?.oiUsd ?? null,
      ...positioning,
      crowdSide: 'unknown',
      crowdRatio: null,
      ...fundingFeatures,
      ...premiumFeatures,
      raw: { oi: oiRows, taker: takerRows, funding: fundingRows, premium: premiumRows },
    },
    leadLag: {
      symbol,
      interval: '1m',
      referenceSource: 'okx_spot',
      fetchedAt: new Date().toISOString(),
      researchOnly: true,
      ...leadLagFeatures,
      raw: { spot: spotRows, perp: perpRows },
    },
  };
}
