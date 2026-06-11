import { sendJson, sendMethodNotAllowed } from '../_lib/http.js';
import { getCommentaryFallback } from '../_lib/cryptoFallback.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendMethodNotAllowed(res);
  try {
    const limit = Number.parseInt(String(req.query.limit ?? '40'), 10) || 40;
    return sendJson(res, 200, { ok: true, commentary: await getCommentaryFallback(limit) });
  } catch (error) {
    return sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : 'fallback_crypto_commentary_failed' });
  }
}
