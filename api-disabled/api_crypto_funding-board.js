// api/crypto/funding-board.js — live Binance funding-rate board (real data, no key).
// Returns top pairs by |rate| with countdown to next settlement + which side
// receives. Refreshed on every call (no-store). NO secrets exposed.
import { sendJson } from '../_lib/http.js';

const PAIRS = [
  'BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT','DOGEUSDT','ADAUSDT','AVAXUSDT',
  'LINKUSDT','NEARUSDT','SUIUSDT','TRXUSDT','TONUSDT','ARBUSDT','OPUSDT','PEPEUSDT',
  'WIFUSDT','1000PEPEUSDT','NEIROUSDT','POPCATUSDT','COTIUSDT','OGNUSDT','RIFUSDT',
  'AUDIOUSDT','LUNAUSDT','STORJUSDT','FETUSDT','COMPUSDT','ATOMUSDT','DOTUSDT',
  'SANDUSDT','JSTUSDT','BNTUSDT','BCHUSDT','NEOUSDT','XLMUSDT','ZECUSDT','QTUMUSDT',
  'ANKRUSDT','ONEUSDT','ZILUSDT','HOTUSDT','ONGUSDT','MTLUSDT','THETAUSDT','IOSTUSDT','CELRUSDT'
];

function sideForFunding(rate) {
  if (rate > 0.00005) return 'short-perp/long-spot';
  if (rate < -0.00005) return 'long-perp/short-spot';
  return 'neutral';
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const r = await fetch('https://fapi.binance.com/fapi/v1/premiumIndex', { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error('binance ' + r.status);
    const all = await r.json();
    const bySymbol = new Map(all.map((x) => [x.symbol, x]));
    const now = Date.now();
    const rows = PAIRS
      .map((sym) => {
        const d = bySymbol.get(sym);
        if (!d) return null;
        const rate = parseFloat(d.lastFundingRate);
        const nextTs = parseInt(d.nextFundingTime, 10);
        const msTo = nextTs - now;
        return {
          pair: sym,
          rate,
          annualPct: +(rate * 3 * 365 * 100).toFixed(2),
          side: sideForFunding(rate),
          nextMs: msTo > 0 ? msTo : 0,
          nextMin: Math.max(0, Math.floor(msTo / 60000)),
        };
      })
      .filter(Boolean)
      .sort((a, b) => Math.abs(b.rate) - Math.abs(a.rate));
    sendJson(res, 200, { ok: true, source: 'binance-live', ts: now, count: rows.length, rows });
  } catch (e) {
    sendJson(res, 200, { ok: false, error: String(e?.message || e), rows: [] });
  }
}
