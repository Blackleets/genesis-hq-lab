// Vercel serverless: live Binance funding-rate board (real data, no key).
// Returns top pairs by |funding rate| with countdown to next settlement,
// and which side receives. Refreshed on every call (cache-control: no-store).
import type { VercelRequest, VercelResponse } from '@vercel/node';

const PAIRS = [
  'BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT','DOGEUSDT','ADAUSDT','AVAXUSDT',
  'LINKUSDT','NEARUSDT','SUIUSDT','TRXUSDT','TONUSDT','ARBUSDT','OPUSDT','PEPEUSDT',
  'WIFUSDT','1000PEPEUSDT','NEIROUSDT','POPCATUSDT','COTIUSDT','OGNUSDT','RIFUSDT',
  'AUDIOUSDT','LUNAUSDT','STORJUSDT','FETUSDT','COMPUSDT','ATOMUSDT','DOTUSDT',
  'SANDUSDT','JSTUSDT','BNTUSDT','BCHUSDT','NEOUSDT','XLMUSDT','ZECUSDT','QTUMUSDT',
  'ANKRUSDT','ONEUSDT','ZILUSDT','HOTUSDT','ONGUSDT','MTLUSDT','THETAUSDT','IOSTUSDT','CELRUSDT'
];

function sideForFunding(rate: number): 'short-perp/long-spot' | 'long-perp/short-spot' | 'neutral' {
  if (rate > 0.00005) return 'short-perp/long-spot';   // shorts pay longs → receive by being short-perp
  if (rate < -0.00005) return 'long-perp/short-spot';
  return 'neutral';
}

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const url = 'https://fapi.binance.com/fapi/v1/premiumIndex';
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error('binance ' + r.status);
    const all: any[] = await r.json();
    const bySymbol = new Map(all.map((x: any) => [x.symbol, x]));
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
          annualPct: +(rate * 3 * 365 * 100).toFixed(2), // 3 settlements/day
          side: sideForFunding(rate),
          nextMs: msTo > 0 ? msTo : 0,
          nextMin: Math.max(0, Math.floor(msTo / 60000)),
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => Math.abs(b.rate) - Math.abs(a.rate));
    res.status(200).json({
      ok: true,
      source: 'binance-live',
      ts: now,
      count: rows.length,
      rows,
    });
  } catch (e: any) {
    res.status(200).json({ ok: false, error: String(e?.message || e), rows: [] });
  }
}
