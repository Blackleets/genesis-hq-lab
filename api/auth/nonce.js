// api/auth/nonce.js — SIWES step 1: issue a single-use login nonce.
//
// The client signs ONLY the message returned here via personal_sign
// (EIP-191). This is pure authentication: no approve, no transfer, no
// signTypedData, nothing that can move funds — ever.
import { randomBytes } from 'node:crypto';
import { sendJson, sendMethodNotAllowed } from '../_lib/http.js';
import { buildSiwesMessage } from '../_lib/sessions.js';
import { makeRateLimit } from '../_lib/rateLimit.js';
import { getStore, DEGRADED_MESSAGE } from '../_lib/store.js';

export const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const NONCE_PREFIX = 'genesis:auth:nonce:';

const rateLimit = makeRateLimit({ windowMs: 60_000, max: 10, blockMs: 15 * 60_000 });

// Process-local nonce store retained ONLY for tests/local non-Vercel execution.
// Vercel production must use the durable store because /nonce and /verify are
// independent serverless functions and therefore cannot share a Map reliably.
export const nonceStore = new Map();

export function canUseProcessLocalNonceStore() {
  return process.env.VERCEL !== '1' && process.env.NODE_ENV !== 'production';
}

export function nonceKey(nonce) {
  return `${NONCE_PREFIX}${nonce}`;
}

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
  const record = {
    addressLower: address.toLowerCase(),
    issuedAtIso,
    expiresAt: Date.now() + NONCE_TTL_MS,
  };

  try {
    const store = await getStore();
    if (store.isDurable()) {
      await store.set(nonceKey(nonce), record, Math.ceil(NONCE_TTL_MS / 1000));
    } else if (canUseProcessLocalNonceStore()) {
      nonceStore.set(nonce, record);
      // opportunistic cleanup of expired local entries
      for (const [k, v] of nonceStore) if (v.expiresAt < Date.now()) nonceStore.delete(k);
    } else {
      return sendJson(res, 503, {
        ok: false,
        error: 'durable_store_not_configured',
        message: DEGRADED_MESSAGE,
      });
    }
  } catch {
    return sendJson(res, 503, {
      ok: false,
      error: 'auth_store_unavailable',
      message: 'El almacenamiento de autenticación no está disponible.',
    });
  }

  const message = buildSiwesMessage(address, nonce, issuedAtIso);
  return sendJson(res, 200, { ok: true, nonce, message });
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
