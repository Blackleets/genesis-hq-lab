// api/_lib/sessions.js — shared wallet-auth session primitives.
// Owner authentication is off-chain only. A signature can create a scoped
// session, but it can never approve assets, transfer funds or enable LIVE.
import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

export const SESSION_TTL_SECONDS = 24 * 60 * 60;

let _ephemeralSecret = null;
let _warned = false;
let _derivedWarned = false;

function derivedServerSecret() {
  const source =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.GENESIS_SECRET_ENCRYPTION_KEY ||
    process.env.TELEGRAM_CONFIG_ENCRYPTION_KEY ||
    '';
  if (source.length < 16) return null;
  if (!_derivedWarned) {
    _derivedWarned = true;
    console.warn('[auth] AUTH_JWT_SECRET no está definida; usando una clave derivada de un secreto server-only existente.');
  }
  return createHash('sha256').update('genesis-hq-auth-jwt-v1\0').update(source).digest();
}

// AUTH_JWT_SECRET is preferred. In serverless production, falling back to a
// process-local random key would break sessions between /verify and /session,
// so we first derive a stable, namespaced key from an existing server secret.
export function getJwtSecret() {
  const fromEnv = process.env.AUTH_JWT_SECRET;
  if (fromEnv && fromEnv.length >= 16) return new TextEncoder().encode(fromEnv);

  const derived = derivedServerSecret();
  if (derived) return derived;

  if (!_warned) {
    _warned = true;
    console.warn(
      '[auth] WARNING: no hay secreto estable de sesión. Usando un secreto efímero solo apto para desarrollo.'
    );
  }
  if (!_ephemeralSecret) _ephemeralSecret = new TextEncoder().encode(randomBytes(32).toString('hex'));
  return _ephemeralSecret;
}

export const AUTH_DISCLAIMER = 'Solo autenticación. Esta firma NO autoriza transacciones ni transferencias.';

// The message text is deliberately chain-neutral. EVM signs it with EIP-191;
// Solana wallets sign the exact UTF-8 bytes with Ed25519.
export function buildSiwesMessage(address, nonce, issuedAtIso) {
  return [
    'Genesis HQ Lab — login',
    `Address: ${address}`,
    `Nonce: ${nonce}`,
    `Issued: ${issuedAtIso}`,
    AUTH_DISCLAIMER,
  ].join('\n');
}

export async function signSessionJwt(sub, role, nowSeconds = Math.floor(Date.now() / 1000)) {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + SESSION_TTL_SECONDS)
    .sign(getJwtSecret());
}

export async function verifySessionJwt(token) {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), { algorithms: ['HS256'] });
    if (!payload.sub || !payload.role) return null;
    return payload;
  } catch {
    return null;
  }
}
