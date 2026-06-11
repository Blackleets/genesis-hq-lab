import { sendJson, sendMethodNotAllowed } from '../_lib/http.js';
import { getFuturesDeskFallback } from '../_lib/cryptoFallback.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendMethodNotAllowed(res);
  try {
    return sendJson(res, 200, await getFuturesDeskFallback());
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      mode: 'status',
      generatedAt: new Date().toISOString(),
      warnings: [{ section: 'fallback', error: error instanceof Error ? error.message : 'fallback_futures_desk_failed', at: new Date().toISOString() }],
    });
  }
}
