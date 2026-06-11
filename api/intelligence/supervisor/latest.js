import { sendJson, sendMethodNotAllowed } from '../../_lib/http.js';
import { getSupervisorLatestFallback } from '../../_lib/cryptoFallback.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendMethodNotAllowed(res);
  try {
    return sendJson(res, 200, { ok: true, advisoryOnly: true, applied: false, ...(await getSupervisorLatestFallback()) });
  } catch (error) {
    return sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : 'fallback_supervisor_latest_failed' });
  }
}
