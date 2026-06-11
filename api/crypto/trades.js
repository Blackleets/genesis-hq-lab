import { sendJson, sendMethodNotAllowed } from '../_lib/http.js';
import { getTradeStoriesFallback } from '../_lib/cryptoFallback.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendMethodNotAllowed(res);
  try {
    const limit = Number.parseInt(String(req.query.limit ?? '40'), 10) || 40;
    const pair = typeof req.query.pair === 'string' && req.query.pair.trim() ? req.query.pair.trim().toUpperCase() : null;
    return sendJson(res, 200, { ok: true, trades: await getTradeStoriesFallback(limit, pair) });
  } catch (error) {
    return sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : 'fallback_crypto_trades_failed' });
  }
}
