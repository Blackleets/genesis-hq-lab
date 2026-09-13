// api/genesis/context.js — derivatives positioning context for the Quant Lab.
// NOTE: Binance fapi (futures data) returns 451 on Vercel's AWS ranges, so the
// OI/long-short/taker block is fetched CLIENT-SIDE by the dashboard when it
// runs in a browser with access to fapi; this serverless route provides what
// always works from any region: Fear & Greed Index. Shape matches the local
// backend's /api/genesis/context (context.fearGreed* fields present).
//
// SESSION REQUIRED, NO TENANT FILTERING for the default context response.
// `?view=arbitrage-radar` is a read-only public system-evidence view backed by
// one allowlisted org_state key; it never exposes credentials or execution authority.
import { sendJson, sendMethodNotAllowed } from '../_lib/http.js';
import { requireSession } from '../_lib/sessionAuth.js';

const FNG = 'https://api.alternative.me/fng/';
const RADAR_STATE_KEY = 'mev_shadow_radar_public';

function supabaseConfig() {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

async function readRadarState() {
  const config = supabaseConfig();
  if (!config) return { configured: false, state: null };

  const query = `org_state?key=eq.${encodeURIComponent(RADAR_STATE_KEY)}&select=value,updated_at&limit=1`;
  const response = await fetch(`${config.url}/rest/v1/${query}`, {
    headers: {
      apikey: config.key,
      authorization: `Bearer ${config.key}`,
      accept: 'application/json',
    },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`supabase_${response.status}`);
  const rows = await response.json();
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row?.value) return { configured: true, state: null };

  try {
    const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
    return {
      configured: true,
      state: parsed && typeof parsed === 'object'
        ? { ...parsed, stateUpdatedAt: row.updated_at ?? null }
        : null,
    };
  } catch {
    return { configured: true, state: null };
  }
}

async function sendRadarView(res) {
  try {
    const { configured, state } = await readRadarState();
    if (!configured) {
      return sendJson(res, 200, {
        ok: false,
        status: 'provider_not_configured',
        message: 'Provider not configured',
        radar: null,
      });
    }

    return sendJson(res, 200, {
      ok: true,
      status: state?.status ?? 'idle',
      radar: state,
      executionAuthority: false,
      mode: 'SHADOW',
    });
  } catch (error) {
    return sendJson(res, 503, {
      ok: false,
      status: 'unavailable',
      error: error instanceof Error ? error.message : 'radar_unavailable',
      radar: null,
    });
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendMethodNotAllowed(res);

  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.searchParams.get('view') === 'arbitrage-radar') return sendRadarView(res);

  // Public market data: session gate only (anti-scraping), no tenant filter.
  const session = await requireSession(req, res);
  if (!session) return; // 401 sent
  try {
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
