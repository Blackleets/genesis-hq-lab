// api/_lib/sessionAuth.js — session middleware for owner-scoped data endpoints.
import { createHash } from 'node:crypto';
import { sendJson } from './http.js';
import { verifySessionJwt } from './sessions.js';
import { readSessionCookie, sameOriginRequest } from './sessionCookie.js';
import { getRemoteAuthSession } from './authNonceRemote.js';

const OPAQUE_SESSION_RE = /^[0-9a-f]{64}$/;

function canonicalSessionAddress(value) {
  const address = String(value || '').trim();
  return /^0x[0-9a-fA-F]{40}$/.test(address) ? address.toLowerCase() : address;
}

async function resolveSession(token) {
  if (OPAQUE_SESSION_RE.test(token)) {
    const remote = await getRemoteAuthSession(token);
    if (remote.status === 200 && remote.body?.ok && remote.body?.session) return remote.body.session;
    if (remote.status === 401) return null;
    const error = new Error('auth_gateway_unavailable');
    error.code = 'auth_gateway_unavailable';
    throw error;
  }

  const payload = await verifySessionJwt(token);
  if (!payload) return null;
  return {
    address: payload.sub,
    role: payload.role === 'operator' ? 'operator' : 'user',
    issuedAt: payload.iat,
    expiresAt: payload.exp,
  };
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

  let session;
  try {
    session = await resolveSession(token);
  } catch {
    sendJson(res, 503, { ok: false, error: 'auth_gateway_unavailable' });
    return null;
  }
  if (!session?.address) {
    sendJson(res, 401, { ok: false, error: 'unauthorized' });
    return null;
  }

  req.sessionToken = token;
  req.session = {
    address: canonicalSessionAddress(session.address),
    role: session.role === 'operator' ? 'operator' : 'user',
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
