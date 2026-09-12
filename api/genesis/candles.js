// Public read-only market candles for the Genesis trading cockpit.
// Strict allowlists prevent this route becoming a generic exchange proxy.
// No account, tenant, wallet, order or private exchange data is exposed here.
import { sendJson, sendMethodNotAllowed } from '../_lib/http.js';

const HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com'];
export const MARKET_PAIRS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT'];
const PAIRS = new Set(MARKET_PAIRS);
const TIMEFRAMES = new Set(['1m', '5m', '15m', '1h', '4h']);

const finite = (value) => (typeof value === 'number' && Number.isFinite(value))
  || (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)));

export function normalizeWatchlist(rows, observedAt = new Date().toISOString()) {
  const bySymbol = new Map((Array.isArray(rows) ? rows : []).map((row) => [String(row?.symbol || '').toUpperCase(), row]));
  return MARKET_PAIRS.map((symbol) => {
    const row = bySymbol.get(symbol);
    const lastPrice = finite(row?.lastPrice) ? Number(row.lastPrice) : null;
    const changePct = finite(row?.priceChangePercent) ? Number(row.priceChangePercent) : null;
    const quoteVolume = finite(row?.quoteVolume) ? Number(row.quoteVolume) : null;
    const closeTime = finite(row?.closeTime) ? Number(row.closeTime) : null;
    return {
      symbol,
      lastPrice,
      changePct,
      quoteVolume,
      updatedAt: closeTime ? new Date(closeTime).toISOString() : (lastPrice == null ? null : observedAt),
      state: lastPrice == null ? 'unavailable' : 'ready',
      source: 'binance_spot_public',
    };
  });
}

async function fetchBinance(path) {
  let lastError = null;
  for (const host of HOSTS) {
    try {
      const response = await fetch(`${host}${path}`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`binance_${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('market_feed_unavailable');
}

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

    const symbols = encodeURIComponent(JSON.stringify(MARKET_PAIRS));
    const [klinesResult, tickerResult] = await Promise.allSettled([
      fetchBinance(`/api/v3/klines?symbol=${encodeURIComponent(pair)}&interval=${encodeURIComponent(tf)}&limit=${limit}`),
      fetchBinance(`/api/v3/ticker/24hr?symbols=${symbols}`),
    ]);
    if (klinesResult.status !== 'fulfilled' || !Array.isArray(klinesResult.value) || klinesResult.value.length === 0) {
      throw klinesResult.status === 'rejected' ? klinesResult.reason : new Error('invalid_kline_payload');
    }
    const klines = klinesResult.value;
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
    const observedAt = new Date().toISOString();
    const watchlist = normalizeWatchlist(tickerResult.status === 'fulfilled' ? tickerResult.value : [], observedAt);
    const selectedIndex = watchlist.findIndex((item) => item.symbol === pair);
    if (selectedIndex >= 0 && watchlist[selectedIndex].lastPrice == null && last) {
      watchlist[selectedIndex] = {
        ...watchlist[selectedIndex],
        lastPrice: last.close,
        updatedAt: observedAt,
        state: 'ready',
      };
    }

    return sendJson(res, 200, {
      ok: true,
      pair,
      tf,
      market: 'binance_spot_public',
      candles,
      watchlist,
      lastPrice: last?.close ?? null,
      changePct,
      updatedAt: observedAt,
    });
  } catch (error) {
    return sendJson(res, 502, { ok: false, error: error instanceof Error ? error.message : 'market_feed_unavailable' });
  }
}
