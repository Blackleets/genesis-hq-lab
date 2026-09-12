import { sendJson, sendMethodNotAllowed } from '../_lib/http.js';
import { getTradeStoriesFallback } from '../_lib/cryptoFallback.js';
import { fetchRemoteFallback } from '../_lib/remoteFallback.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendMethodNotAllowed(res);
  try {
    const limit = Number.parseInt(String(req.query.limit ?? '40'), 10) || 40;
    const pair = typeof req.query.pair === 'string' && req.query.pair.trim() ? req.query.pair.trim().toUpperCase() : null;
    return sendJson(res, 200, await fetchRemoteFallback('crypto-trades', { limit, pair }));
  } catch (error) {
    try {
      const limit = Number.parseInt(String(req.query.limit ?? '40'), 10) || 40;
      const pair = typeof req.query.pair === 'string' && req.query.pair.trim() ? req.query.pair.trim().toUpperCase() : null;
      return sendJson(res, 200, { ok: true, trades: await getTradeStoriesFallback(limit, pair) });
    } catch (innerError) {
      return sendJson(res, 500, {
        ok: false,
        error: innerError instanceof Error ? innerError.message : (error instanceof Error ? error.message : 'fallback_crypto_trades_failed'),
      });
    }
  }
}
