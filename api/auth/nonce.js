// api/auth/nonce.js — SIWES step 1: issue a single-use login nonce.
//
// The client signs ONLY the message returned here via personal_sign
// (EIP-191). This is pure authentication: no approve, no transfer, no
// signTypedData, nothing that can move funds — ever.
import { randomBytes } from 'node:crypto';
import { sendJson, sendMethodNotAllowed } from '../_lib/http.js';
import { buildSiwesMessage } from '../_lib/sessions.js';
import { makeRateLimit } from '../_lib/rateLimit.js';

export const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const rateLimit = makeRateLimit({ windowMs: 60_000, max: 10, blockMs: 15 * 60_000 });

// In-memory nonce store, exported for tests. Phase 2 candidate: Upstash Redis
// so nonces survive cold starts / multi-instance Vercel.
// Key: nonce (hex) -> { addressLower, issuedAtIso, expiresAt }
export const nonceStore = new Map();

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendMethodNotAllowed(res, 'POST');
  if (!(await rateLimit(req, res))) return; // 429 already sent

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const address = String(body.address || '').trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return sendJson(res, 400, { ok: false, error: 'invalid_address' });
  }

  const nonce = randomBytes(16).toString('hex'); // 32 hex chars
  const issuedAtIso = new Date().toISOString();
  nonceStore.set(nonce, {
    addressLower: address.toLowerCase(),
    issuedAtIso,
    expiresAt: Date.now() + NONCE_TTL_MS,
  });
  // opportunistic cleanup of expired entries
  for (const [k, v] of nonceStore) if (v.expiresAt < Date.now()) nonceStore.delete(k);

  const message = buildSiwesMessage(address, nonce, issuedAtIso);
  return sendJson(res, 200, { ok: true, nonce, message });
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
