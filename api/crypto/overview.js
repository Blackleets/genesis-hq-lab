import { sendJson, sendMethodNotAllowed } from '../_lib/http.js';
import { getCryptoOverviewFallback } from '../_lib/cryptoFallback.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendMethodNotAllowed(res);
  try {
    return sendJson(res, 200, await getCryptoOverviewFallback());
  } catch (error) {
    return sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : 'fallback_crypto_overview_failed' });
  }
}
