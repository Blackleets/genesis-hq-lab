// api/_lib/authNonceRemote.js — secretless bridge to the dedicated Supabase auth gateway.
// Production authentication does not depend on process memory, Vercel env secrets,
// or Vercel OIDC. The gateway verifies wallet signatures and stores only hashed
// opaque session capabilities in Supabase.

const DEFAULT_EDGE_URL =
  'https://swgixcbwyhxttnmrglbk.supabase.co/functions/v1/genesis-auth-nonce';

function edgeUrl() {
  return String(process.env.GENESIS_AUTH_NONCE_EDGE_URL || DEFAULT_EDGE_URL).replace(/\/+$/, '');
}

async function callEdge(body) {
  const response = await fetch(edgeUrl(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  });
  const payload = await response.json().catch(() => null);
  return {
    available: true,
    status: response.status,
    body: payload ?? { ok: false, error: `auth_gateway_http_${response.status}` },
  };
}

export async function issueRemoteAuthChallenge({ address, chain }) {
  return callEdge({ action: 'issue', address, chain });
}

export async function verifyRemoteAuthChallenge({ address, chain, signature, nonce }) {
  return callEdge({ action: 'verify', address, chain, signature, nonce });
}

export async function getRemoteAuthSession(token) {
  return callEdge({ action: 'session', token });
}

export async function revokeRemoteAuthSession(token) {
  return callEdge({ action: 'logout', token });
}
