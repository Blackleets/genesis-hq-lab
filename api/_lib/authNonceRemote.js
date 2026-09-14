// api/_lib/authNonceRemote.js — Vercel OIDC authenticated fallback for owner-login nonces.
//
// Why this exists:
// - Vercel Functions are ephemeral and cannot safely share process memory.
// - Genesis normally uses the configured durable store (Upstash/Supabase).
// - When that server credential is not configured, production can still persist
//   ONLY short-lived auth challenges through the dedicated Supabase Edge Function.
// - The Edge Function accepts requests only after verifying Vercel's short-lived
//   project OIDC token. No Supabase service key is committed or exposed to Vercel.
//
// This module is auth-only. It is NOT a generic data store and cannot persist
// Telegram credentials, bots, trading state, or execution authority.

const DEFAULT_EDGE_URL =
  'https://swgixcbwyhxttnmrglbk.supabase.co/functions/v1/genesis-auth-nonce';

function edgeUrl() {
  return String(process.env.GENESIS_AUTH_NONCE_EDGE_URL || DEFAULT_EDGE_URL).replace(/\/+$/, '');
}

function vercelOidcToken() {
  return String(process.env.VERCEL_OIDC_TOKEN || '').trim();
}

async function callEdge(body) {
  const token = vercelOidcToken();
  if (!token) return { available: false, body: null };

  const response = await fetch(edgeUrl(), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5_000),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    const code = payload?.error || `http_${response.status}`;
    const error = new Error(`remote_auth_nonce_${code}`);
    error.code = 'remote_auth_nonce_unavailable';
    throw error;
  }
  return { available: true, body: payload };
}

export async function putRemoteAuthNonce(nonce, record) {
  const result = await callEdge({ action: 'put', nonce, record });
  return { available: result.available };
}

export async function takeRemoteAuthNonce(nonce) {
  const result = await callEdge({ action: 'take', nonce });
  return {
    available: result.available,
    record: result.available ? (result.body?.record ?? null) : null,
  };
}
