// Shared OKX universe. Rank by Glosten–Milgrom select (width = toxicity prior),
// not by widest spread. Never invents a name. Empty tape → empty list.

import { selectScore, intersection as makerIntersection } from './math/select.mjs';

export const OKX = 'https://www.okx.com';
export const MIN_NOTIONAL = 1_000_000;
export const MIN_MAKER_SPREAD_BPS = 5;

let LAST_INTERSECTION = { liquid: 0, hGe: 0, band: 0, both: 0 };
export function lastIntersection() {
  return LAST_INTERSECTION;
}

export function spreadBps(bid, ask) {
  const mid = (bid + ask) / 2;
  if (!(mid > 0)) return 0;
  return ((ask - bid) / mid) * 1e4;
}

export function tickerRows(data) {
  const rows = Array.isArray(data) ? data : [];
  const out = [];
  for (const t of rows) {
    const bid = +t.bidPx;
    const ask = +t.askPx;
    const vol = +t.volCcy24h;
    if (!(bid > 0) || !(ask > bid) || !(vol > 0)) continue;
    const instId = String(t.instId || '');
    if (!instId.endsWith('-USDT-SWAP')) continue;
    const mid = (bid + ask) / 2;
    const notional = vol * mid;
    out.push({
      instId,
      bid,
      ask,
      vol,
      mid,
      notional,
      spread: spreadBps(bid, ask),
    });
  }
  out.sort((a, b) => b.notional - a.notional);
  return out;
}

export function pickUniverseFromTickers(data, limit = 40) {
  const all = tickerRows(data);
  LAST_INTERSECTION = makerIntersection(all);
  const ranked = all
    .map((s) => ({ ...s, select: selectScore(s) }))
    .filter((s) => Number.isFinite(s.select))
    .sort((a, b) => b.select - a.select);
  const seen = new Set();
  const out = [];
  for (const s of ranked) {
    if (out.length >= limit) break;
    seen.add(s.instId);
    out.push({ ...s, sleeve: 'maker' });
  }
  for (const s of all) {
    if (out.length >= limit) break;
    if (seen.has(s.instId)) continue;
    seen.add(s.instId);
    out.push({ ...s, sleeve: 'watch' });
  }
  return out;
}

export async function fetchOkxTickers(ms = 9000) {
  const r = await fetch(`${OKX}/api/v5/market/tickers?instType=SWAP`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(ms),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} tickers`);
  const j = await r.json();
  return Array.isArray(j.data) ? j.data : [];
}

export async function pickUniverse(limit = 40) {
  const data = await fetchOkxTickers();
  return pickUniverseFromTickers(data, limit);
}
