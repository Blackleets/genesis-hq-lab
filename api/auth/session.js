import { sendJson, sendMethodNotAllowed } from '../_lib/http.js';
import { readSessionCookie } from '../_lib/sessionCookie.js';
import { verifySessionJwt } from '../_lib/sessions.js';
import { getRemoteAuthSession } from '../_lib/authNonceRemote.js';

const OPAQUE_SESSION_RE = /^[0-9a-f]{64}$/;

function toEpochMs(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return NaN;
  return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendMethodNotAllowed(res);
  const token = readSessionCookie(req);
  if (!token) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

  if (OPAQUE_SESSION_RE.test(token)) {
    try {
      const remote = await getRemoteAuthSession(token);
      if (remote.status !== 200 || !remote.body?.ok || !remote.body?.session) {
        return sendJson(res, remote.status === 401 ? 401 : 503, {
          ok: false,
          error: remote.body?.error || (remote.status === 401 ? 'unauthorized' : 'auth_gateway_unavailable'),
        });
      }
      const session = {
        ...remote.body.session,
        issuedAt: toEpochMs(remote.body.session.issuedAt),
        expiresAt: toEpochMs(remote.body.session.expiresAt),
      };
      if (!session.address || !Number.isFinite(session.issuedAt) || !Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now()) {
        return sendJson(res, 401, { ok: false, error: 'unauthorized' });
      }
      return sendJson(res, 200, { ok: true, session });
    } catch {
      return sendJson(res, 503, { ok: false, error: 'auth_gateway_unavailable' });
    }
  }

  const payload = await verifySessionJwt(token);
  if (!payload) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
  return sendJson(res, 200, {
    ok: true,
    session: {
      address: payload.sub,
      role: payload.role === 'operator' ? 'operator' : 'user',
      issuedAt: Number(payload.iat) * 1000,
      expiresAt: Number(payload.exp) * 1000,
    },
  });
}
