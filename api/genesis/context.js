// api/genesis/context.js — derivatives positioning context for the Quant Lab.
// NOTE: Binance fapi (futures data) returns 451 on Vercel's AWS ranges, so the
// OI/long-short/taker block is fetched CLIENT-SIDE by the dashboard when it
// runs in a browser with access to fapi; this serverless route provides what
// always works from any region: Fear & Greed Index. Shape matches the local
// backend's /api/genesis/context (context.fearGreed* fields present).
//
// SESSION REQUIRED, NO TENANT FILTERING: the Fear & Greed Index (and any
// derivatives context) is PUBLIC market sentiment — identical for every
// wallet, so nothing is scoped by tenant. The session gate exists only to
// stop anonymous scraping of the endpoint.
import { sendJson, sendMethodNotAllowed } from '../_lib/http.js';
import { requireSession } from '../_lib/sessionAuth.js';

const FNG = 'https://api.alternative.me/fng/';

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendMethodNotAllowed(res);
  // Public market data: session gate only (anti-scraping), no tenant filter.
  const session = await requireSession(req, res);
  if (!session) return; // 401 sent
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const symbol = (url.searchParams.get('pair') || 'COTIUSDT').toUpperCase();
    const r = await fetch(`${FNG}?limit=30&format=json`, { signal: AbortSignal.timeout(12_000) });
    if (!r.ok) throw new Error(`FNG HTTP ${r.status}`);
    const j = await r.json();
    const arr = (j.data || []).map(d => +d.value).reverse();
    sendJson(res, 200, {
      ok: true,
      context: {
        symbol,
        fetchedAt: new Date().toISOString(),
        oiUsdNow: null,
        oiChangePct: null,
        crowdSide: 'unknown',
        crowdRatio: null,
        takerBias: null,
        fearGreedNow: arr.length ? arr[arr.length - 1] : null,
        fearGreedAvg30: arr.length ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : null,
        note: 'derivatives fields require client-side fetch of fapi (451-blocked on Vercel edge)',
      },
    });
  } catch (e) {
    sendJson(res, 500, { ok: false, error: e.message });
  }
}
