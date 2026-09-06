import { sendJson, sendMethodNotAllowed } from '../_lib/http.js';
import { readSessionCookie } from '../_lib/sessionCookie.js';
import { verifySessionJwt } from '../_lib/sessions.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendMethodNotAllowed(res);
  const token = readSessionCookie(req);
  const payload = token ? await verifySessionJwt(token) : null;
  if (!payload) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
  return sendJson(res, 200, { ok: true, session: { address: payload.sub, role: payload.role === 'operator' ? 'operator' : 'user', issuedAt: payload.iat, expiresAt: payload.exp } });
}
