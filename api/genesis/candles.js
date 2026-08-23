// api/genesis/candles.js — real klines for the Quant Lab chart.
// Serverless-friendly: uses Binance SPOT public data endpoints
// (fapi is geo-blocked 451 on Vercel's AWS ranges; spot api.binance.com and
// data-api.binance.vision are not). No keys, no disk.
import { sendJson, sendMethodNotAllowed } from '../_lib/http.js';

const HOSTS = [
  'https://data-api.binance.vision', // public data mirror, no geo-block
  'https://api.binance.com',
];

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendMethodNotAllowed(res);
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pair = (url.searchParams.get('pair') || 'COTIUSDT').toUpperCase();
    const tf = url.searchParams.get('tf') || '1h';
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '300', 10) || 300, 1000);

    let klines = null;
    let lastErr = null;
    for (const host of HOSTS) {
      try {
        const r = await fetch(`${host}/api/v3/klines?symbol=${pair}&interval=${tf}&limit=${limit}`, {
          signal: AbortSignal.timeout(12_000),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status} @ ${host}`);
        klines = await r.json();
        break;
      } catch (e) { lastErr = e; }
    }
    if (!klines) throw new Error(lastErr?.message || 'no kline source reachable');

    const candles = klines.map(k => ({
      time: Math.floor(k[0] / 1000),
      open: +k[1], high: +k[2], low: +k[3], close: +k[4],
    }));
    sendJson(res, 200, { ok: true, pair, tf, candles, market: 'spot' });
  } catch (e) {
    sendJson(res, 500, { ok: false, error: e.message });
  }
}
