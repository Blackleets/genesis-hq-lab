const DEFAULT_BASE = 'https://swgixcbwyhxttnmrglbk.supabase.co/functions/v1/genesis-fallback';

function remoteBase() {
  return process.env.GENESIS_SUPABASE_FALLBACK_URL
    || process.env.SUPABASE_FALLBACK_URL
    || DEFAULT_BASE;
}

export async function fetchRemoteFallback(route, params = {}) {
  const url = new URL(remoteBase());
  url.searchParams.set('route', route);
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  const res = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`remote_supabase_fallback_${res.status}`);
  return res.json();
}
