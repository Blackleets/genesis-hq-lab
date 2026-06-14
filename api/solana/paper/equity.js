import { sendJson, sendMethodNotAllowed } from '../../_lib/http.js';
import { solanaEquityCurve, solanaLimit } from '../../_lib/solanaFallback.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendMethodNotAllowed(res, 'GET');
  return sendJson(res, 200, await solanaEquityCurve(solanaLimit(req, 200)));
}
