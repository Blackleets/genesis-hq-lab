import { sendJson, sendMethodNotAllowed } from '../_lib/http.js';
import { founderResponse } from '../../server/genesis/founderHttp.mjs';

// Public, allowlisted readiness projection only. No secrets, raw identity,
// account, signatures, approval payloads or trading operations leave this route.
export default function handler(req, res) {
  if (req.method !== 'GET') return sendMethodNotAllowed(res);
  const result = founderResponse(req.method);
  return sendJson(res, result.status, result.body);
}
