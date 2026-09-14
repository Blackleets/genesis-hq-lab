// api/_lib/telegramRemote.js — owner-session bridge to the Supabase Telegram gateway.
// The user's opaque Genesis session authenticates owner-scoped configuration.
// GitHub OIDC remains isolated to automatic observer dispatch inside the Edge Function.

const DEFAULT_EDGE_URL =
  'https://swgixcbwyhxttnmrglbk.supabase.co/functions/v1/genesis-telegram';

function edgeUrl() {
  return String(process.env.GENESIS_TELEGRAM_EDGE_URL || DEFAULT_EDGE_URL).replace(/\/+$/, '');
}

export async function callTelegramGateway(payload, sessionToken) {
  const token = String(sessionToken || '').trim();
  if (!/^[0-9a-f]{64}$/.test(token)) return { available: false, status: 0, body: null };

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
