import { sendJson, sendMethodNotAllowed } from '../_lib/http.js';
import { getCryptoOverviewFallback } from '../_lib/cryptoFallback.js';
import { fetchRemoteFallback } from '../_lib/remoteFallback.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendMethodNotAllowed(res);
  try {
    return sendJson(res, 200, await fetchRemoteFallback('crypto-overview'));
  } catch (error) {
    try {
      return sendJson(res, 200, await getCryptoOverviewFallback());
    } catch (innerError) {
      return sendJson(res, 500, {
        ok: false,
        error: innerError instanceof Error ? innerError.message : (error instanceof Error ? error.message : 'fallback_crypto_overview_failed'),
      });
    }
  }
}
