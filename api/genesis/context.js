// api/genesis/context.js — derivatives positioning context for the Quant Lab.
// NOTE: Binance fapi (futures data) returns 451 on Vercel's AWS ranges, so the
// OI/long-short/taker block is fetched CLIENT-SIDE by the dashboard when it
// runs in a browser with access to fapi; this serverless route provides what
// always works from any region: Fear & Greed Index. Shape matches the local
// backend's /api/genesis/context (context.fearGreed* fields present).
//
// SESSION REQUIRED, NO TENANT FILTERING for the default context response.
// Read-only arbitrage views expose public system evidence only; they never
// expose credentials, wallet material, signing capability, or execution authority.
import { sendJson, sendMethodNotAllowed } from '../_lib/http.js';
import { requireSession } from '../_lib/sessionAuth.js';

const FNG = 'https://api.alternative.me/fng/';
const RADAR_STATE_KEY = 'mev_shadow_radar_public';
const SOLANA_RADAR_SNAPSHOT_URL = 'https://raw.githubusercontent.com/Blackleets/genesis-hq-lab/data/solana-arbitrage-observations/data/solana-arbitrage-latest.json';
const SOLANA_RADAR_HISTORY_URL = 'https://raw.githubusercontent.com/Blackleets/genesis-hq-lab/data/solana-arbitrage-observations/data/solana-arbitrage-history.json';

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

async function sendLegacyRadarView(res) {
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

async function readSolanaRadarSnapshot() {
  const response = await fetch(SOLANA_RADAR_SNAPSHOT_URL, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`solana_snapshot_${response.status}`);

  const snapshot = await response.json();
  const observation = snapshot?.observation;
  const safetyValid = snapshot?.mode === 'SHADOW'
    && snapshot?.executionAuthority === false
    && snapshot?.liveLocked === true;
  const chainValid = !observation || observation?.chain === 'SOLANA';

  if (!safetyValid || !chainValid) throw new Error('solana_snapshot_contract_violation');
  return snapshot;
}

function isSafeSolanaSnapshot(snapshot) {
  const observation = snapshot?.observation;
  return snapshot?.mode === 'SHADOW'
    && snapshot?.executionAuthority === false
    && snapshot?.liveLocked === true
    && (!observation || observation?.chain === 'SOLANA');
}

async function readSolanaRadarHistory() {
  const response = await fetch(SOLANA_RADAR_HISTORY_URL, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`solana_history_${response.status}`);

  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error('solana_history_invalid');

  return rows
    .filter(isSafeSolanaSnapshot)
    .filter((row) => row?.observation)
    .slice(-120)
    .reverse();
}

function summarizeSolanaHistory(rows) {
  const observations = rows.map((row) => row.observation).filter(Boolean);
  const positiveNet = observations.filter((o) => Number(o?.economics?.netPnlUsd) > 0).length;
  const qualified = observations.filter((o) => String(o?.status ?? '').toUpperCase() === 'QUALIFIED').length;
  const blocked = observations.filter((o) => String(o?.status ?? '').toUpperCase() === 'BLOCKED').length;
  const knownNet = observations
    .map((o) => Number(o?.economics?.netPnlUsd))
    .filter(Number.isFinite);
  return {
    observations: observations.length,
    positiveNet,
    qualified,
    blocked,
    theoreticalNetOpportunityUsd: knownNet.reduce((sum, value) => sum + value, 0),
    note: 'Observed opportunity economics only; not realized account P&L.',
  };
}

async function sendSolanaRadarView(res) {
  try {
    const [snapshot, historyResult] = await Promise.all([
      readSolanaRadarSnapshot(),
      readSolanaRadarHistory().catch(() => []),
    ]);
    return sendJson(res, 200, {
      ok: true,
      status: snapshot?.observation?.status ?? snapshot?.status ?? 'OBSERVING',
      radar: snapshot,
      history: historyResult,
      summary: summarizeSolanaHistory(historyResult),
      executionAuthority: false,
      liveLocked: true,
      mode: 'SHADOW',
      chain: 'SOLANA',
    });
  } catch (error) {
    return sendJson(res, 503, {
      ok: false,
      status: 'unavailable',
      error: error instanceof Error ? error.message : 'solana_radar_unavailable',
      radar: null,
      history: [],
      summary: summarizeSolanaHistory([]),
      executionAuthority: false,
      liveLocked: true,
      mode: 'SHADOW',
      chain: 'SOLANA',
    });
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendMethodNotAllowed(res);

  const url = new URL(req.url, `http://${req.headers.host}`);
  const view = url.searchParams.get('view');
  if (view === 'solana-arbitrage-radar') return sendSolanaRadarView(res);
  if (view === 'arbitrage-radar') return sendLegacyRadarView(res);

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
