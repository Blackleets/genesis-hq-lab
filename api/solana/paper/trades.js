import { sendJson, sendMethodNotAllowed } from '../../_lib/http.js';
import { solanaLimit, solanaPaperTrades } from '../../_lib/solanaFallback.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendMethodNotAllowed(res, 'GET');
  return sendJson(res, 200, await solanaPaperTrades(solanaLimit(req, 50)));
}
