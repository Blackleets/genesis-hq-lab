// api/genesis/candles.js — real Binance klines for the Quant Lab chart.
// Serverless-friendly: fetches directly from Binance public API (no disk needed).
import { sendJson, sendMethodNotAllowed } from '../_lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendMethodNotAllowed(res);
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pair = (url.searchParams.get('pair') || 'COTIUSDT').toUpperCase();
    const tf = url.searchParams.get('tf') || '1h';
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '300', 10) || 300, 1000);
    const symbol = pair.replace(/USDT$/, 'USDT');
    const r = await fetch(
      `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${tf}&limit=${limit}`,
      { signal: AbortSignal.timeout(12_000) },
    );
    if (!r.ok) throw new Error(`Binance HTTP ${r.status}`);
    const klines = await r.json();
    const candles = klines.map(k => ({
      time: Math.floor(k[0] / 1000),
      open: +k[1], high: +k[2], low: +k[3], close: +k[4],
    }));
    sendJson(res, 200, { ok: true, pair, tf, candles });
  } catch (e) {
    sendJson(res, 500, { ok: false, error: e.message });
  }
}
