import { sendJson, sendMethodNotAllowed } from '../_lib/http.js';
import { sameOriginRequest, setSessionCookie } from '../_lib/sessionCookie.js';

export default function handler(req, res) {
  if (req.method !== 'POST') return sendMethodNotAllowed(res, 'POST');
  if (!sameOriginRequest(req)) return sendJson(res, 403, { ok: false, error: 'cross_origin_request' });
  setSessionCookie(res, '', 0);
  return sendJson(res, 200, { ok: true });
}
