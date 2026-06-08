// chartTicker — lightweight 24h ticker + 1h change for the DexScreener-style chart header.
// Browser-side Binance REST (CORS-allowed, no key). Pure data, no UI.

const BINANCE = 'https://api.binance.com/api/v3';

export interface ChartTickerStats {
  price: number;
  change1h: number;     // percent (current 1h candle: open→close)
  change24h: number;    // percent (rolling 24h)
  high24h: number;
  low24h: number;
  quoteVol24h: number;  // USDT volume
}

export async function loadChartTicker(pair: string): Promise<ChartTickerStats | null> {
  try {
    const [t, k1h] = await Promise.all([
      fetch(`${BINANCE}/ticker/24hr?symbol=${pair}`, { signal: AbortSignal.timeout(6000) }),
      fetch(`${BINANCE}/klines?symbol=${pair}&interval=1h&limit=1`, { signal: AbortSignal.timeout(6000) }),
    ]);
    if (!t.ok) return null;
    const j = await t.json() as Record<string, string>;

    let change1h = 0;
    if (k1h.ok) {
      const raw = await k1h.json() as unknown[];
      const cur = Array.isArray(raw) && raw.length ? raw[raw.length - 1] as string[] : null;
      if (cur) {
        const open1h = parseFloat(cur[1]);
        const close1h = parseFloat(cur[4]);
        if (open1h > 0) change1h = ((close1h - open1h) / open1h) * 100;
      }
    }

    return {
      price: parseFloat(j.lastPrice),
      change1h,
      change24h: parseFloat(j.priceChangePercent),
      high24h: parseFloat(j.highPrice),
      low24h: parseFloat(j.lowPrice),
      quoteVol24h: parseFloat(j.quoteVolume),
    };
  } catch {
    return null;
  }
}
