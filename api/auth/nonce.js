// api/auth/nonce.js — issue a single-use owner-login nonce.
// Supports EVM personal_sign for legacy surfaces and Solana signMessage for
// Genesis' Solana owner flow. Neither path authorizes transactions.
import { randomBytes } from 'node:crypto';
import { sendJson, sendMethodNotAllowed } from '../_lib/http.js';
import { buildSiwesMessage } from '../_lib/sessions.js';
import { makeRateLimit } from '../_lib/rateLimit.js';
import { getStore } from '../_lib/store.js';
import { issueRemoteAuthChallenge } from '../_lib/authNonceRemote.js';
import { canonicalWalletAddress, isValidSolanaPublicKey } from '../_lib/solanaAuth.js';

export const NONCE_TTL_MS = 5 * 60 * 1000;
export const NONCE_PREFIX = 'genesis:auth:nonce:';

const rateLimit = makeRateLimit({ windowMs: 60_000, max: 10, blockMs: 15 * 60_000 });
export const nonceStore = new Map();

export function canUseProcessLocalNonceStore() {
  return process.env.VERCEL !== '1' && process.env.NODE_ENV !== 'production';
}

export function nonceKey(nonce) {
  return `${NONCE_PREFIX}${nonce}`;
}

function parseChain(value) {
  if (value == null || value === '') return 'evm';
  return value === 'solana' || value === 'evm' ? value : null;
}

function validAddress(address, chain) {
  return chain === 'solana'
    ? isValidSolanaPublicKey(address)
    : /^0x[0-9a-fA-F]{40}$/.test(address);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendMethodNotAllowed(res, 'POST');
  if (!(await rateLimit(req, res))) return;

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const address = String(body.address || '').trim();
  const chain = parseChain(body.chain);
  if (!chain || !validAddress(address, chain)) {
    return sendJson(res, 400, { ok: false, error: 'invalid_address' });
  }

  // Production primary path: Supabase owns nonce generation/persistence.
  // No Vercel secret or durable-store credential is required.
  if (!canUseProcessLocalNonceStore()) {
    try {
      const remote = await issueRemoteAuthChallenge({ address, chain });
      return sendJson(res, remote.status, remote.body);
    } catch {
      return sendJson(res, 503, {
        ok: false,
        error: 'auth_gateway_unavailable',
        message: 'El servicio seguro de autenticación no está disponible temporalmente.',
      });
    }
  }

  // Local/test compatibility path.
  const canonicalAddress = canonicalWalletAddress(address, chain);
  const nonce = randomBytes(16).toString('hex');
  const issuedAtIso = new Date().toISOString();
  const record = {
    addressCanonical: canonicalAddress,
    addressLower: chain === 'evm' ? canonicalAddress : undefined,
    chain,
    issuedAtIso,
    expiresAt: Date.now() + NONCE_TTL_MS,
  };

  try {
    const store = await getStore();
    if (store.isDurable()) {
      await store.set(nonceKey(nonce), record, Math.ceil(NONCE_TTL_MS / 1000));
    } else {
      nonceStore.set(nonce, record);
      for (const [key, value] of nonceStore) if (value.expiresAt < Date.now()) nonceStore.delete(key);
    }
  } catch {
    return sendJson(res, 503, {
      ok: false,
      error: 'auth_store_unavailable',
      message: 'El almacenamiento seguro de autenticación no está disponible.',
    });
  }

  const message = buildSiwesMessage(canonicalAddress, nonce, issuedAtIso);
  return sendJson(res, 200, { ok: true, nonce, message, chain });
}

function safeParse(value) {
  try { return JSON.parse(value); } catch { return {}; }
}
