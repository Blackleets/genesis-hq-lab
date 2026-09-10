// server/genesis/okxResearchContext.mjs
// RESEARCH_ONLY redundant public market-data adapter for synchronized evidence.
// Read-only: no credentials, orders, candidate promotion, REAL_TRADING changes or gate changes.

import { deriveFundingFeatures, derivePremiumFeatures, derivePositioningDynamics } from './derivativesContext.mjs';
import { deriveSpotPerpLeadLag } from './spotPerpLeadLag.mjs';

const BASE = 'https://www.okx.com';
const SUPPORTED_BASES = new Set(['BTC', 'ETH', 'SOL', 'XRP', 'BNB']);

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

export function okxInstrumentIds(symbol) {
  const s = String(symbol || '').toUpperCase();
  if (!s.endsWith('USDT')) throw new Error(`Unsupported OKX research symbol: ${s}`);
  const base = s.slice(0, -4);
  if (!SUPPORTED_BASES.has(base)) throw new Error(`Unsupported OKX research symbol: ${s}`);
  return { spot: `${base}-USDT`, perp: `${base}-USDT-SWAP`, ccy: base };
}

function candles(rows = []) {
  return rows.map(r => ({ time: +r[0], close: +r[4] }))
    .filter(r => Number.isFinite(r.time) && Number.isFinite(r.close) && r.close > 0)
    .sort((a, b) => a.time - b.time);
}

export function completedCandles(rows = []) {
  return rows.map(r => ({
    time: +r[0], open: +r[1], high: +r[2], low: +r[3], close: +r[4],
    volumeQuote: +(r[7] ?? r[6] ?? r[5]), confirm: String(r[8] ?? ''),
  }))
    .filter(r => r.confirm === '1' && [r.time, r.open, r.high, r.low, r.close].every(Number.isFinite) && r.open > 0 && r.high > 0 && r.low > 0 && r.close > 0)
    .sort((a, b) => a.time - b.time);
}

function median(values = []) {
  const xs = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

function rms(values = []) {
  const xs = values.filter(Number.isFinite);
  if (!xs.length) return null;
  return Math.sqrt(xs.reduce((sum, value) => sum + value * value, 0) / xs.length);
}

export function deriveVolatilityShockFeatures(bars = []) {
  const rows = [...bars].filter(r => Number.isFinite(+r?.time) && Number.isFinite(+r?.close) && +r.close > 0).sort((a, b) => +a.time - +b.time);
  if (rows.length < 14) return {
    volatilityBarCount: rows.length, realizedVolShortBps: null, realizedVolLongBps: null,
    volatilityExpansionRatio: null, latestRangeBps: null, rangeShockRatio: null,
    volumeShockRatio: null, maxAbsReturnBpsShort: null, volatilityState: 'insufficient',
  };
  const returnsBps = [];
  for (let i = 1; i < rows.length; i += 1) {
    const prev = +rows[i - 1].close; const now = +rows[i].close;
    if (prev > 0 && now > 0) returnsBps.push(Math.log(now / prev) * 10000);
  }
  const shortReturns = returnsBps.slice(-12);
  const longReturns = returnsBps.slice(-60);
  const shortVol = rms(shortReturns);
  const longVol = rms(longReturns);
  const expansion = Number.isFinite(shortVol) && Number.isFinite(longVol) && longVol > 0 ? shortVol / longVol : null;
  const rangeBps = rows.map(r => ((+r.high - +r.low) / +r.close) * 10000).filter(Number.isFinite);
  const latestRangeBps = rangeBps.at(-1) ?? null;
  const baselineRange = median(rangeBps.slice(0, -1).slice(-60));
  const rangeShockRatio = Number.isFinite(latestRangeBps) && Number.isFinite(baselineRange) && baselineRange > 0 ? latestRangeBps / baselineRange : null;
  const latestVolume = +rows.at(-1)?.volumeQuote;
  const baselineVolume = median(rows.slice(0, -1).slice(-60).map(r => +r.volumeQuote));
  const volumeShockRatio = Number.isFinite(latestVolume) && Number.isFinite(baselineVolume) && baselineVolume > 0 ? latestVolume / baselineVolume : null;
  const maxAbsReturnBpsShort = shortReturns.length ? Math.max(...shortReturns.map(Math.abs)) : null;
  let volatilityState = 'normal';
  if ((Number.isFinite(expansion) && expansion >= 1.5) || (Number.isFinite(rangeShockRatio) && rangeShockRatio >= 2) || (Number.isFinite(volumeShockRatio) && volumeShockRatio >= 2.5)) volatilityState = 'shock';
  else if (Number.isFinite(expansion) && Number.isFinite(rangeShockRatio) && expansion <= 0.65 && rangeShockRatio <= 0.75) volatilityState = 'compressed';
  return {
    volatilityBarCount: rows.length,
    realizedVolShortBps: shortVol,
    realizedVolLongBps: longVol,
    volatilityExpansionRatio: expansion,
    latestRangeBps,
    rangeShockRatio,
    volumeShockRatio,
    maxAbsReturnBpsShort,
    volatilityState,
  };
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
  const { spot, perp } = okxInstrumentIds(symbol);
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
  const completedPerpRows = completedCandles(perpRaw);
  const fundingRows = funding(fundingRaw);
  const oiRows = oi(oiRaw);
  const takerRows = taker(tradesRaw);
  const premiumRows = premiumFromCandles(spotRows, perpRows);
  const positioning = derivePositioningDynamics(oiRows, takerRows);
  const fundingFeatures = deriveFundingFeatures(fundingRows);
  const premiumFeatures = derivePremiumFeatures(premiumRows);
  const volatilityFeatures = deriveVolatilityShockFeatures(completedPerpRows);
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
      ...volatilityFeatures,
      raw: { oi: oiRows, taker: takerRows, funding: fundingRows, premium: premiumRows, volatility: completedPerpRows },
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