// api/genesis/context.js — derivatives positioning context (OI, long/short,
// taker flow, Fear&Greed) for the Quant Lab view. Direct public APIs, no keys.
import { sendJson, sendMethodNotAllowed } from '../_lib/http.js';

const FUTS = 'https://fapi.binance.com';
const FNG = 'https://api.alternative.me/fng/';

async function jget(u) {
  const r = await fetch(u, { signal: AbortSignal.timeout(12_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${u.split('?')[0]}`);
  return r.json();
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendMethodNotAllowed(res);
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const symbol = (url.searchParams.get('pair') || 'COTIUSDT').toUpperCase();

    const [oi, gls, taker, fng] = await Promise.all([
      jget(`${FUTS}/futures/data/openInterestHist?symbol=${symbol}&period=5m&limit=48`),
      jget(`${FUTS}/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=1h&limit=24`),
      jget(`${FUTS}/futures/data/takerlongshortRatio?symbol=${symbol}&period=1h&limit=12`),
      jget(`${FNG}?limit=30&format=json`),
    ]).catch(() => [null, null, null, null]);

    if (!oi || !oi.length) throw new Error('no OI data (symbol may not have Binance futures)');

    const first = +oi[0].sumOpenInterestValue;
    const last = +oi[oi.length - 1].sumOpenInterestValue;
    const latestGls = gls?.[gls.length - 1];
    const ratio = latestGls ? +latestGls.longShortRatio : null;
    const takerArr = (taker || []).map(d => +d.buySellRatio);
    const fngArr = (fng?.data || []).map(d => ({ value: +d.value })).reverse();

    sendJson(res, 200, {
      ok: true,
      context: {
        symbol,
        fetchedAt: new Date().toISOString(),
        oiUsdNow: last || null,
        oiChangePct: first ? +(((last - first) / first) * 100).toFixed(2) : null,
        crowdSide: ratio == null ? 'unknown' : ratio > 2 ? 'long' : ratio < 0.67 ? 'short' : 'neutral',
        crowdRatio: ratio,
        takerBias: takerArr.length ? +(takerArr.reduce((a, b) => a + b, 0) / takerArr.length).toFixed(3) : null,
        fearGreedNow: fngArr.length ? fngArr[fngArr.length - 1].value : null,
        fearGreedAvg30: fngArr.length ? +(fngArr.reduce((s, d) => s + d.value, 0) / fngArr.length).toFixed(1) : null,
      },
    });
  } catch (e) {
    sendJson(res, 500, { ok: false, error: e.message });
  }
}
