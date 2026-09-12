import { sendJson, sendMethodNotAllowed } from '../_lib/http.js';
import { getCommentaryFallback } from '../_lib/cryptoFallback.js';
import { fetchRemoteFallback } from '../_lib/remoteFallback.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendMethodNotAllowed(res);
  try {
    const limit = Number.parseInt(String(req.query.limit ?? '40'), 10) || 40;
    return sendJson(res, 200, await fetchRemoteFallback('crypto-commentary', { limit }));
  } catch (error) {
    try {
      const limit = Number.parseInt(String(req.query.limit ?? '40'), 10) || 40;
      return sendJson(res, 200, { ok: true, commentary: await getCommentaryFallback(limit) });
    } catch (innerError) {
      return sendJson(res, 500, {
        ok: false,
        error: innerError instanceof Error ? innerError.message : (error instanceof Error ? error.message : 'fallback_crypto_commentary_failed'),
      });
    }
  }
}
