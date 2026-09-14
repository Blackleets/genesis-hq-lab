// api/_lib/sessionAuth.js — session middleware for owner-scoped data endpoints.
import { createHash } from 'node:crypto';
import { sendJson } from './http.js';
import { verifySessionJwt } from './sessions.js';
import { readSessionCookie, sameOriginRequest } from './sessionCookie.js';

function canonicalSessionAddress(value) {
  const address = String(value || '').trim();
  return /^0x[0-9a-fA-F]{40}$/.test(address) ? address.toLowerCase() : address;
}

export async function requireSession(req, res) {
  const header = req.headers?.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const cookieToken = readSessionCookie(req);
  const token = cookieToken ?? (match ? match[1].trim() : null);

  if (cookieToken && !['GET', 'HEAD'].includes(req.method) && !sameOriginRequest(req)) {
    sendJson(res, 403, { ok: false, error: 'cross_origin_request' });
    return null;
  }
  if (!token) {
    sendJson(res, 401, { ok: false, error: 'unauthorized' });
    return null;
  }

  const payload = await verifySessionJwt(token);
  if (!payload) {
    sendJson(res, 401, { ok: false, error: 'unauthorized' });
    return null;
  }

  req.session = {
    address: canonicalSessionAddress(payload.sub),
    role: payload.role === 'operator' ? 'operator' : 'user',
  };
  return req.session;
}

export function tenantFilter(session) {
  if (!session) return null;
  if (session.role === 'operator') return null;
  return canonicalSessionAddress(session.address);
}

// EVM addresses are case-insensitive; Solana public keys are case-sensitive.
export function ownerHashFor(address) {
  return createHash('sha256').update(canonicalSessionAddress(address)).digest('hex').slice(0, 16);
}
