import { sendJson, sendMethodNotAllowed } from '../_lib/http.js';
import { getFuturesDeskFallback } from '../_lib/cryptoFallback.js';
import { fetchRemoteFallback } from '../_lib/remoteFallback.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendMethodNotAllowed(res);
  try {
    return sendJson(res, 200, await fetchRemoteFallback('crypto-futures-desk'));
  } catch (error) {
    try {
      return sendJson(res, 200, await getFuturesDeskFallback());
    } catch (innerError) {
      return sendJson(res, 500, {
        ok: false,
        mode: 'status',
        generatedAt: new Date().toISOString(),
        warnings: [{
          section: 'fallback',
          error: innerError instanceof Error ? innerError.message : (error instanceof Error ? error.message : 'fallback_futures_desk_failed'),
          at: new Date().toISOString(),
        }],
      });
    }
  }
}
