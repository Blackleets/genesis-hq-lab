import { sendJson, sendMethodNotAllowed } from '../_lib/http.js';

const RATCHET_STATUS_URL = 'https://swgixcbwyhxttnmrglbk.supabase.co/functions/v1/genesis-ratchet-status';

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendMethodNotAllowed(res);
  try {
    const response = await fetch(RATCHET_STATUS_URL, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      return sendJson(res, 502, { ok: false, error: payload?.error || `ratchet_status_${response.status}` });
    }
    return sendJson(res, 200, payload);
  } catch (error) {
    return sendJson(res, 502, { ok: false, error: error instanceof Error ? error.message : 'ratchet_status_unavailable' });
  }
}
