// Public read-only market candles for the Genesis trading cockpit.
// Strict allowlists prevent this route becoming a generic Binance proxy.
// No account, tenant, wallet, order or private exchange data is exposed here.
import { sendJson, sendMethodNotAllowed } from '../_lib/http.js';

const HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com'];
const PAIRS = new Set(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT']);
const TIMEFRAMES = new Set(['1m', '5m', '15m', '1h', '4h']);

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendMethodNotAllowed(res);
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pair = (url.searchParams.get('pair') || 'BTCUSDT').toUpperCase();
    const tf = url.searchParams.get('tf') || '5m';
    const requested = Number.parseInt(url.searchParams.get('limit') || '300', 10);
    const limit = Math.min(500, Math.max(80, Number.isFinite(requested) ? requested : 300));

    if (!PAIRS.has(pair)) return sendJson(res, 400, { ok: false, error: 'unsupported_pair' });
    if (!TIMEFRAMES.has(tf)) return sendJson(res, 400, { ok: false, error: 'unsupported_timeframe' });

    let klines = null;
    let lastError = null;
    for (const host of HOSTS) {
      try {
        const response = await fetch(`${host}/api/v3/klines?symbol=${encodeURIComponent(pair)}&interval=${encodeURIComponent(tf)}&limit=${limit}`, {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error(`binance_${response.status}`);
        const payload = await response.json();
        if (!Array.isArray(payload) || payload.length === 0) throw new Error('invalid_kline_payload');
        klines = payload;
        break;
      } catch (error) {
        lastError = error;
      }
    }

    if (!klines) throw lastError instanceof Error ? lastError : new Error('market_feed_unavailable');
    const candles = klines.map((row) => ({
      time: Math.floor(Number(row[0]) / 1000),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
    })).filter((candle) => Number.isFinite(candle.time) && Number.isFinite(candle.open) && Number.isFinite(candle.high) && Number.isFinite(candle.low) && Number.isFinite(candle.close));

    const last = candles.at(-1) ?? null;
    const first = candles[0] ?? null;
    const changePct = first && last && first.open > 0 ? ((last.close / first.open) - 1) * 100 : null;

    return sendJson(res, 200, {
      ok: true,
      pair,
      tf,
      market: 'binance_spot_public',
      candles,
      lastPrice: last?.close ?? null,
      changePct,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return sendJson(res, 502, { ok: false, error: error instanceof Error ? error.message : 'market_feed_unavailable' });
  }
}
