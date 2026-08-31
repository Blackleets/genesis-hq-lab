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
import { nonceStore } from './nonce.js';
import { makeRateLimit } from '../_lib/rateLimit.js';

const rateLimit = makeRateLimit({ windowMs: 60_000, max: 10, blockMs: 15 * 60_000 });

function operatorAddresses() {
  return (process.env.OPERATOR_ADDRESSES || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendMethodNotAllowed(res, 'POST');
  if (!(await rateLimit(req, res))) return; // 429 already sent

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const address = String(body.address || '').trim();
  const signature = String(body.signature || '').trim();
  const nonce = String(body.nonce || '').trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(address) || !signature || !nonce) {
    return sendJson(res, 400, { ok: false, error: 'invalid_request' });
  }

  // Nonce must exist, be unexpired and unclaimed -> claim it atomically
  // (single use). Delete-first so two concurrent verifies can't both pass.
  const record = nonceStore.get(nonce);
  nonceStore.delete(nonce);
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

  return sendJson(res, 200, {
    ok: true,
    session: {
      address: getAddress(addressLower), // checksummed
      role,
      token,
      issuedAt: nowSeconds,
      expiresAt: nowSeconds + SESSION_TTL_SECONDS,
    },
  });
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
