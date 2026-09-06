// api/_lib/sessionAuth.js — Bearer JWT session middleware for data endpoints.
//
// Usage in a Vercel handler:
//   const session = await requireSession(req, res);
//   if (!session) return; // 401 already sent
//
// SECURITY INVARIANTS:
// - A valid session grants READ access scoped to the caller's own wallet only
//   (see tenantFilter). There are no cross-tenant write endpoints anywhere.
// - Zero custody: tokens carry only {sub (lowercase address), role}.
import { createHash } from 'node:crypto';
import { sendJson } from './http.js';
import { verifySessionJwt } from './sessions.js';
import { readSessionCookie, sameOriginRequest } from './sessionCookie.js';

// Extracts and verifies Authorization: Bearer <jwt>. On success attaches
// req.session = { address (lowercase), role } and returns it. On failure
// responds 401 {ok:false,error:'unauthorized'} and returns null.
export async function requireSession(req, res) {
  const header = req.headers?.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  // Bearer remains supported for existing server clients; the browser uses
  // HttpOnly cookies and never receives or stores a bearer token.
  const cookieToken = readSessionCookie(req);
  const token = cookieToken ?? (m ? m[1].trim() : null);
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
  req.session = { address: payload.sub.toLowerCase(), role: payload.role === 'operator' ? 'operator' : 'user' };
  return req.session;
}

// CENTRAL TENANT FILTER — the single source of truth for data scoping.
// Returns:
//   null                 -> operator: may see everything (read-only audit view)
//   '<address lowercase>'-> user: sees ONLY rows owned by this wallet
// Every bot-data endpoint must funnel through this. A user must NEVER receive
// bytes belonging to another wallet.
export function tenantFilter(session) {
  if (!session) return null; // callers should have required a session first
  if (session.role === 'operator') return null;
  return session.address.toLowerCase();
}

// ownerHash for a wallet address: sha256(lowercase address), truncated to
// 16 hex chars. Stored in bot state files instead of the raw address so no
// public artifact leaks who owns what.
export function ownerHashFor(addressLower) {
  return createHash('sha256').update(addressLower.toLowerCase()).digest('hex').slice(0, 16);
}
