import { sendJson, sendMethodNotAllowed } from '../_lib/http.js';

const STATE_KEY = 'mev_shadow_radar_public';

function supabaseConfig() {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

async function readRadarState() {
  const config = supabaseConfig();
  if (!config) return { configured: false, state: null };

  const query = `org_state?key=eq.${encodeURIComponent(STATE_KEY)}&select=value,updated_at&limit=1`;
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

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendMethodNotAllowed(res, 'GET');

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
