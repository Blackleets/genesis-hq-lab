// priceFeeder.mjs — Binance public REST API price feed for crypto scalping.
// No API key required. Returns price context with EMA9/EMA21 and RSI14.
// Pure math — no external libraries.

// api.binance.com is geo-blocked (HTTP 451) from many cloud regions (e.g. Render US).
// data-api.binance.vision mirrors the public market-data API with no geo-block/auth.
const BINANCE_BASE = process.env.BINANCE_BASE || 'https://data-api.binance.vision/api/v3';

// 1-minute candles to pull per asset. ≥60 for a true 1h change; 360 so the
// multi-timeframe filter can build a 15m EMA21 (21 * 15 = 315) from resampled 1m.
const KLINES_LIMIT = 360;

const DEFAULT_ASSETS = [
  { symbol: 'BTC', pair: 'BTCUSDT' },
  { symbol: 'ETH', pair: 'ETHUSDT' },
  { symbol: 'SOL', pair: 'SOLUSDT' },
  { symbol: 'BNB', pair: 'BNBUSDT' },
];

// Asset list is configurable via env so new coins are a one-line change:
//   CRYPTO_ASSETS=BTC:BTCUSDT,ETH:ETHUSDT,XRP:XRPUSDT
export function getAssets() {
  const raw = (process.env.CRYPTO_ASSETS ?? '').trim();
  if (!raw) return DEFAULT_ASSETS;
  const parsed = raw.split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(entry => {
      const [symbol, pair] = entry.split(':').map(p => p.trim());
      return symbol && pair ? { symbol, pair } : null;
    })
    .filter(Boolean);
  return parsed.length > 0 ? parsed : DEFAULT_ASSETS;
}

// ─── EMA (exponential moving average) ─────────────────────────────────────────

export function computeEma(values, period) {
  if (values.length === 0) return 0;
  if (values.length === 1) return values[0];
  const k = 2 / (period + 1);
  let result = values[0];
  for (let i = 1; i < values.length; i++) {
    result = values[i] * k + result * (1 - k);
  }
  return result;
}

// ─── RSI(14) ──────────────────────────────────────────────────────────────────

export function computeRsi(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return Math.round((100 - 100 / (1 + rs)) * 100) / 100;
}

// ─── Build asset context from raw API data ────────────────────────────────────

export function buildAssetContext(symbol, pair, klines, ticker) {
  const closes = klines.map(k => parseFloat(k[4]));
  const ema9   = computeEma(closes, 9);
  const ema21  = computeEma(closes, 21);
  const rsi14  = computeRsi(closes, 14);
  const price  = parseFloat(ticker.lastPrice);
  const change1h = closes.length >= 60
    ? ((closes[closes.length - 1] - closes[closes.length - 60]) / closes[closes.length - 60]) * 100
    : parseFloat(ticker.priceChangePercent ?? 0);

  const trend = ema9 > ema21 * 1.001 ? 'bullish'
              : ema9 < ema21 * 0.999 ? 'bearish'
              : 'neutral';

  return {
    symbol,
    pair,
    price,
    change1h:  Math.round(change1h * 100) / 100,
    change24h: parseFloat(ticker.priceChangePercent ?? 0),
    volume24h: parseFloat(ticker.quoteVolume ?? 0),
    ema9:      Math.round(ema9 * 100) / 100,
    ema21:     Math.round(ema21 * 100) / 100,
    rsi14,
    trend,
    closes,    // raw 1m closes — used by the multi-timeframe (HTF) filter
  };
}

// ─── Fetch all 4 assets from Binance ─────────────────────────────────────────

export async function getAssetContexts() {
  try {
    const assets = getAssets();
    const pairs = assets.map(a => `"${a.pair}"`).join(',');
    const [tickerRes, ...klinesRes] = await Promise.all([
      fetch(`${BINANCE_BASE}/ticker/24hr?symbols=[${pairs}]`, { signal: AbortSignal.timeout(8000) }),
      ...assets.map(a => fetch(`${BINANCE_BASE}/klines?symbol=${a.pair}&interval=1m&limit=${KLINES_LIMIT}`, { signal: AbortSignal.timeout(8000) })),
    ]);

    if (!tickerRes.ok) throw new Error(`Binance ticker HTTP ${tickerRes.status}`);
    const tickers = await tickerRes.json();

    const klinesData = await Promise.all(klinesRes.map(async (r) => {
      if (!r.ok) return null;
      return r.json().catch(() => null);
    }));

    const contexts = [];
    for (let i = 0; i < assets.length; i++) {
      const { symbol, pair } = assets[i];
      const ticker = tickers.find(t => t.symbol === pair);
      const klines = klinesData[i];
      if (!ticker || !klines || klines.length < 22) continue;
      contexts.push(buildAssetContext(symbol, pair, klines, ticker));
    }

    console.log(`[priceFeeder] ${contexts.length} assets fetched: ${contexts.map(c => `${c.symbol}@$${c.price}`).join(', ')}`);
    return contexts;

  } catch (err) {
    console.warn('[priceFeeder] Error fetching Binance data:', err.message);
    return [];
  }
}

// ─── Fetch current price for a single pair (used by positionManager) ─────────

export async function getCurrentPrice(pair) {
  try {
    const res = await fetch(`${BINANCE_BASE}/ticker/price?symbol=${pair}`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json();
    return parseFloat(data.price);
  } catch {
    return null;
  }
}
