// api/auth/verify.js — SIWES step 2: verify the personal_sign of the login
// nonce and issue a scoped JWT session.
//
// SECURITY INVARIANTS:
// - Verifies ONLY the EIP-191 personal_sign of the nonce message. A valid
//   signature grants nothing but a read-scoped session: no approvals, no
//   transfers, no spending of any kind.
// - Zero custody: we never see or request private keys; viem checks the
//   signature against the public address.
// - Nonces are single-use and expire in 5 minutes.
import { getAddress } from 'viem';
import { verifyMessage } from 'viem';
import { sendJson, sendMethodNotAllowed } from '../_lib/http.js';
import { buildSiwesMessage, signSessionJwt, SESSION_TTL_SECONDS } from '../_lib/sessions.js';
import { nonceStore, nonceKey, canUseProcessLocalNonceStore } from './nonce.js';
import { makeRateLimit } from '../_lib/rateLimit.js';
import { sameOriginRequest, setSessionCookie } from '../_lib/sessionCookie.js';
import { getStore, DEGRADED_MESSAGE } from '../_lib/store.js';

const rateLimit = makeRateLimit({ windowMs: 60_000, max: 10, blockMs: 15 * 60_000 });

function operatorAddresses() {
  return (process.env.OPERATOR_ADDRESSES || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

async function consumeNonce(nonce) {
  const store = await getStore();
  if (store.isDurable()) {
    return store.take(nonceKey(nonce));
  }
  if (canUseProcessLocalNonceStore()) {
    const record = nonceStore.get(nonce) ?? null;
    nonceStore.delete(nonce);
    return record;
  }
  const err = new Error('durable_store_not_configured');
  err.code = 'durable_store_not_configured';
  throw err;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendMethodNotAllowed(res, 'POST');
  if (!sameOriginRequest(req)) return sendJson(res, 403, { ok: false, error: 'cross_origin_request' });
  if (!(await rateLimit(req, res))) return; // 429 already sent

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const address = String(body.address || '').trim();
  const signature = String(body.signature || '').trim();
  const nonce = String(body.nonce || '').trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(address) || !signature || !nonce) {
    return sendJson(res, 400, { ok: false, error: 'invalid_request' });
  }

  // Claim the nonce before any cryptographic verification. Durable adapters
  // implement take() atomically so two concurrent verifies cannot both pass.
  let record;
  try {
    record = await consumeNonce(nonce);
  } catch (error) {
    if (error?.code === 'durable_store_not_configured' || error?.message === 'durable_store_not_configured') {
      return sendJson(res, 503, {
        ok: false,
        error: 'durable_store_not_configured',
        message: DEGRADED_MESSAGE,
      });
    }
    return sendJson(res, 503, {
      ok: false,
      error: 'auth_store_unavailable',
      message: 'El almacenamiento de autenticación no está disponible.',
    });
  }

  if (!record || record.expiresAt < Date.now()) {
    return sendJson(res, 401, { ok: false, error: 'invalid_or_expired_nonce' });
  }
  if (record.addressLower !== address.toLowerCase()) {
    return sendJson(res, 401, { ok: false, error: 'nonce_address_mismatch' });
  }

  // Cryptographic check of the EIP-191 personal_sign over the exact SIWES
  // message that was issued for this nonce.
  let valid = false;
  try {
    valid = await verifyMessage({
      address,
      message: buildSiwesMessage(address, nonce, record.issuedAtIso),
      signature,
    });
  } catch {
    valid = false;
  }
  if (!valid) return sendJson(res, 401, { ok: false, error: 'invalid_signature' });

  const addressLower = address.toLowerCase();
  const role = operatorAddresses().includes(addressLower) ? 'operator' : 'user';

  const nowSeconds = Math.floor(Date.now() / 1000);
  const token = await signSessionJwt(addressLower, role, nowSeconds);
  setSessionCookie(res, token, SESSION_TTL_SECONDS);

  return sendJson(res, 200, {
    ok: true,
    session: {
      address: getAddress(addressLower), // checksummed
      role,
      issuedAt: nowSeconds,
      expiresAt: nowSeconds + SESSION_TTL_SECONDS,
    },
  });
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
