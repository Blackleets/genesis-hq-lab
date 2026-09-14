// api/auth/verify.js — verify an owner-login signature and issue a scoped JWT.
// EVM remains supported for legacy surfaces; Genesis' owner flow uses Solana
// signMessage. Neither path grants transaction authority.
import { getAddress, verifyMessage } from 'viem';
import { sendJson, sendMethodNotAllowed } from '../_lib/http.js';
import { buildSiwesMessage, signSessionJwt, SESSION_TTL_SECONDS } from '../_lib/sessions.js';
import { nonceStore, nonceKey, canUseProcessLocalNonceStore } from './nonce.js';
import { makeRateLimit } from '../_lib/rateLimit.js';
import { sameOriginRequest, setSessionCookie } from '../_lib/sessionCookie.js';
import { getStore, DEGRADED_MESSAGE } from '../_lib/store.js';
import { takeRemoteAuthNonce } from '../_lib/authNonceRemote.js';
import {
  canonicalWalletAddress,
  isValidSolanaPublicKey,
  verifySolanaMessageSignature,
} from '../_lib/solanaAuth.js';

const rateLimit = makeRateLimit({ windowMs: 60_000, max: 10, blockMs: 15 * 60_000 });

function operatorAddresses() {
  return (process.env.OPERATOR_ADDRESSES || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
}

function isOperator(address, chain) {
  return operatorAddresses().some(candidate => (
    canonicalWalletAddress(candidate, chain) === canonicalWalletAddress(address, chain)
  ));
}

function validAddress(address, chain) {
  return chain === 'solana'
    ? isValidSolanaPublicKey(address)
    : /^0x[0-9a-fA-F]{40}$/.test(address);
}

async function consumeNonce(nonce) {
  const store = await getStore();
  if (store.isDurable()) return store.take(nonceKey(nonce));
  if (canUseProcessLocalNonceStore()) {
    const record = nonceStore.get(nonce) ?? null;
    nonceStore.delete(nonce);
    return record;
  }

  const remote = await takeRemoteAuthNonce(nonce);
  if (remote.available) return remote.record;

  const error = new Error('durable_store_not_configured');
  error.code = 'durable_store_not_configured';
  throw error;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendMethodNotAllowed(res, 'POST');
  if (!sameOriginRequest(req)) return sendJson(res, 403, { ok: false, error: 'cross_origin_request' });
  if (!(await rateLimit(req, res))) return;

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const address = String(body.address || '').trim();
  const signature = String(body.signature || '').trim();
  const nonce = String(body.nonce || '').trim();
  if (!address || !signature || !nonce) {
    return sendJson(res, 400, { ok: false, error: 'invalid_request' });
  }

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
      message: 'El almacenamiento seguro de autenticación no está disponible.',
    });
  }

  if (!record || record.expiresAt < Date.now()) {
    return sendJson(res, 401, { ok: false, error: 'invalid_or_expired_nonce' });
  }

  const chain = record.chain === 'solana' ? 'solana' : 'evm';
  if (body.chain && body.chain !== chain) {
    return sendJson(res, 401, { ok: false, error: 'nonce_chain_mismatch' });
  }
  if (!validAddress(address, chain)) {
    return sendJson(res, 400, { ok: false, error: 'invalid_request' });
  }

  const canonicalAddress = canonicalWalletAddress(address, chain);
  const recordAddress = record.addressCanonical ?? record.addressLower;
  if (recordAddress !== canonicalAddress) {
    return sendJson(res, 401, { ok: false, error: 'nonce_address_mismatch' });
  }

  const message = buildSiwesMessage(canonicalAddress, nonce, record.issuedAtIso);
  let valid = false;
  try {
    if (chain === 'solana') {
      valid = verifySolanaMessageSignature({
        address: canonicalAddress,
        message,
        signatureBase64: signature,
      });
    } else {
      valid = await verifyMessage({ address: canonicalAddress, message, signature });
    }
  } catch {
    valid = false;
  }
  if (!valid) return sendJson(res, 401, { ok: false, error: 'invalid_signature' });

  const role = isOperator(canonicalAddress, chain) ? 'operator' : 'user';
  const nowSeconds = Math.floor(Date.now() / 1000);
  const token = await signSessionJwt(canonicalAddress, role, nowSeconds);
  setSessionCookie(res, token, SESSION_TTL_SECONDS);

  return sendJson(res, 200, {
    ok: true,
    session: {
      address: chain === 'solana' ? canonicalAddress : getAddress(canonicalAddress),
      chain,
      role,
      issuedAt: nowSeconds,
      expiresAt: nowSeconds + SESSION_TTL_SECONDS,
    },
  });
}

function safeParse(value) {
  try { return JSON.parse(value); } catch { return {}; }
}
