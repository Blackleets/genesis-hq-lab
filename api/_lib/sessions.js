// api/_lib/sessions.js — shared auth primitives for the wallet (SIWES) flow.
//
// SECURITY INVARIANTS:
// - Zero custody: this module never touches private keys. Only public
//   addresses and off-chain signature verification happen here.
// - The ONLY signature the system ever asks for is the EIP-191 personal_sign
//   of the login nonce message below. Nothing else.
import { randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

export const SESSION_TTL_SECONDS = 24 * 60 * 60; // 24h

let _ephemeralSecret = null;
let _warned = false;

// JWT secret resolution: AUTH_JWT_SECRET env if set, otherwise an ephemeral
// per-process random secret so dev works with zero config. Ephemeral means
// every restart/deploy invalidates sessions — acceptable for dev, WARN loudly.
export function getJwtSecret() {
  const fromEnv = process.env.AUTH_JWT_SECRET;
  if (fromEnv && fromEnv.length >= 16) {
    return new TextEncoder().encode(fromEnv);
  }
  if (!_warned) {
    _warned = true;
    console.warn(
      '[auth] WARNING: AUTH_JWT_SECRET no está definida. Usando un secreto EFÍMERO ' +
      'aleatorio de proceso: las sesiones se invalidan en cada reinicio/deploy y NO ' +
      'debe usarse así en producción. Define AUTH_JWT_SECRET en las env vars.'
    );
  }
  if (!_ephemeralSecret) _ephemeralSecret = new TextEncoder().encode(randomBytes(32).toString('hex'));
  return _ephemeralSecret;
}

// Canonical SIWES-style message. verify.js rebuilds EXACTLY this string to
// check the EIP-191 personal_sign signature, so keep both in sync via this fn.
export const AUTH_DISCLAIMER = 'Solo autenticación. Esta firma NO autoriza transacciones ni transferencias.';

export function buildSiwesMessage(address, nonce, issuedAtIso) {
  return [
    'Genesis HQ Lab — login',
    `Address: ${address}`,
    `Nonce: ${nonce}`,
    `Issued: ${issuedAtIso}`,
    AUTH_DISCLAIMER,
  ].join('\n');
}

// Issue an HS256 JWT for a verified wallet session.
// payload: { sub: lowercase address, role: 'user'|'operator' }
export async function signSessionJwt(sub, role, nowSeconds = Math.floor(Date.now() / 1000)) {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + SESSION_TTL_SECONDS)
    .sign(getJwtSecret());
}

// Verify a JWT; returns payload {sub, role, iat, exp} or null.
export async function verifySessionJwt(token) {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), { algorithms: ['HS256'] });
    if (!payload.sub || !payload.role) return null;
    return payload;
  } catch {
    return null;
  }
}
