import { sendJson, sendMethodNotAllowed } from '../_lib/http.js';
import { readSessionCookie, sameOriginRequest, setSessionCookie } from '../_lib/sessionCookie.js';
import { revokeRemoteAuthSession } from '../_lib/authNonceRemote.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendMethodNotAllowed(res, 'POST');
  if (!sameOriginRequest(req)) return sendJson(res, 403, { ok: false, error: 'cross_origin_request' });
  const token = readSessionCookie(req);
  if (/^[0-9a-f]{64}$/.test(token || '')) {
    try { await revokeRemoteAuthSession(token); } catch { /* cookie is still cleared fail-safe */ }
  }
  setSessionCookie(res, '', 0);
  return sendJson(res, 200, { ok: true });
}
