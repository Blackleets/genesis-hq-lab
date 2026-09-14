// api/_lib/telegramRemote.js — Vercel OIDC bridge to the Supabase Telegram gateway.
// The gateway owns encrypted-at-rest Telegram persistence and GitHub OIDC dispatch.
// No Supabase service key or Telegram encryption key is required in Vercel.

const DEFAULT_EDGE_URL =
  'https://swgixcbwyhxttnmrglbk.supabase.co/functions/v1/genesis-telegram';

function edgeUrl() {
  return String(process.env.GENESIS_TELEGRAM_EDGE_URL || DEFAULT_EDGE_URL).replace(/\/+$/, '');
}

function vercelOidcToken() {
  return String(process.env.VERCEL_OIDC_TOKEN || '').trim();
}

export async function callTelegramGateway(payload) {
  const token = vercelOidcToken();
  if (!token) return { available: false, status: 0, body: null };

  const response = await fetch(edgeUrl(), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(12_000),
  });
  const body = await response.json().catch(() => null);
  return {
    available: true,
    status: response.status,
    body: body ?? { ok: false, error: `telegram_gateway_http_${response.status}` },
  };
}
