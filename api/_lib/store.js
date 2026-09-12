// api/_lib/store.js — durable storage layer with swappable adapters.
//
// PROBLEM (audit finding): user bot state was written to data/bots/ via
// writeFileSync. On Vercel serverless the filesystem is read-only/ephemeral:
// every cold start wipes it, so user bots silently vanished in production.
//
// SOLUTION: a single async interface resolved by getStore() from env vars.
// Priority: Upstash Redis REST -> Supabase PostgREST -> in-memory fallback.
// The memory adapter is EXPLICITLY non-durable (isDurable() === false,
// degraded flag): callers must refuse writes rather than pretend to persist.
//
// No new SDKs — both durable adapters are plain fetch against public REST
// APIs, which is what serverless wants anyway.
//
// Interface (all async):
//   get(key)            -> parsed value | null
//   set(key, value, ttlSec?) -> true on success (throws on failure)
//   del(key)            -> true if deleted, false if key was absent
//   keys(prefix)        -> array of matching keys
//   isDurable()         -> bool; false ONLY for the memory fallback

const DEGRADED_MESSAGE =
  'Configura UPSTASH_REDIS_REST_URL+TOKEN o SUPABASE_URL+SERVICE_KEY en Vercel para persistir bots';

let cached = null;

/** Resolve (and memoize per lambda instance) the storage adapter from env. */
export async function getStore() {
  if (cached) return cached;
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    cached = redisAdapter(
      process.env.UPSTASH_REDIS_REST_URL.replace(/\/+$/, ''),
      process.env.UPSTASH_REDIS_REST_TOKEN
    );
  } else if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
    cached = supabaseAdapter(
      process.env.SUPABASE_URL.replace(/\/+$/, ''),
      process.env.SUPABASE_SERVICE_KEY
    );
  } else {
    cached = memoryAdapter();
  }
  return cached;
}

/** Test hook: drop the memoized adapter so env changes take effect. */
export function resetStoreCache() {
  cached = null;
}

export { DEGRADED_MESSAGE };

// ---------------------------------------------------------------------------
// Adapter: Upstash Redis over REST (https://<url>/set|get|del|keys)
// Protocol: POST JSON [arg1, arg2...] -> { result, error }
// ---------------------------------------------------------------------------
function redisAdapter(baseUrl, token) {
  const auth = `Bearer ${token}`;
  async function cmd(...args) {
    const r = await fetch(`${baseUrl}/${args[0]}`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(args.slice(1)),
    });
    if (!r.ok) throw new Error(`upstash_http_${r.status}`);
    const j = await r.json();
    if (j.error) throw new Error(`upstash: ${j.error}`);
    return j.result;
  }
  return {
    name: 'upstash-redis',
    async get(key) {
      const raw = await cmd('get', key);
      if (raw == null) return null;
      try { return JSON.parse(raw); } catch { return raw; } // tolerate plain strings
    },
    async set(key, value, ttlSec) {
      // SET key value [EX ttl] — EX keeps TTL semantics server-side.
      const args = ['set', key, JSON.stringify(value)];
      if (Number.isFinite(ttlSec) && ttlSec > 0) args.push('ex', Math.floor(ttlSec));
      await cmd(...args);
      return true;
    },
    async del(key) {
      const n = await cmd('del', key);
      return Number(n) > 0;
    },
    async keys(prefix) {
      // KEYS is fine at this scale (< thousands of bot keys); SCAN would need
      // cursor state across calls for no real benefit here.
      const out = await cmd('keys', `${prefix}*`);
      return Array.isArray(out) ? out : [];
    },
    isDurable() { return true; },
  };
}

// ---------------------------------------------------------------------------
// Adapter: Supabase PostgREST (table `bots`: key text primary key, value jsonb)
// Requires: create table bots (key text primary key, value jsonb);
// Service key bypasses RLS — never expose it client-side.
// ---------------------------------------------------------------------------
function supabaseAdapter(baseUrl, serviceKey) {
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };
  return {
    name: 'supabase-postgrest',
    async get(key) {
      const r = await fetch(
        `${baseUrl}/rest/v1/bots?select=value&key=eq.${encodeURIComponent(key)}&limit=1`,
        { headers }
      );
      if (!r.ok) throw new Error(`supabase_http_${r.status}`);
      const rows = await r.json();
      return rows.length ? rows[0].value : null;
    },
    async set(key, value, ttlSec) {
      // Upsert on primary key. PostgREST has no row TTL; ttlSec accepted but
      // ignored (bots are permanent until archived/deleted anyway).
      void ttlSec;
      const r = await fetch(`${baseUrl}/rest/v1/bots`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify([{ key, value }]),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => '');
        throw new Error(`supabase_upsert_${r.status}: ${t.slice(0, 200)}`);
      }
      return true;
    },
    async del(key) {
      const r = await fetch(
        `${baseUrl}/rest/v1/bots?key=eq.${encodeURIComponent(key)}`,
        { method: 'DELETE', headers: { ...headers, Prefer: 'return=representation' } }
      );
      if (!r.ok) throw new Error(`supabase_delete_${r.status}`);
      const rows = await r.json().catch(() => []);
      return Array.isArray(rows) && rows.length > 0;
    },
    async keys(prefix) {
      const r = await fetch(
        `${baseUrl}/rest/v1/bots?select=key&key=like.${encodeURIComponent(prefix + '*')}`,
        { headers }
      );
      if (!r.ok) throw new Error(`supabase_keys_${r.status}`);
      const rows = await r.json();
      return rows.map(x => x.key);
    },
    isDurable() { return true; },
  };
}

// ---------------------------------------------------------------------------
// Fallback: in-memory Map. NOT durable by definition — survives only this
// warm lambda invocation. Flagged degraded so handlers can refuse writes.
// ---------------------------------------------------------------------------
function memoryAdapter() {
  const map = new Map();
  const timers = new Map(); // best-effort expiry while the instance lives
  return {
    name: 'memory',
    degraded: true, // explicit honest signal: this adapter loses data
    async get(key) {
      return map.has(key) ? map.get(key) : null;
    },
    async set(key, value, ttlSec) {
      map.set(key, value);
      if (timers.has(key)) clearTimeout(timers.get(key));
      if (Number.isFinite(ttlSec) && ttlSec > 0) {
        timers.set(key, setTimeout(() => { map.delete(key); timers.delete(key); }, ttlSec * 1000));
      }
      return true;
    },
    async del(key) {
      if (timers.has(key)) { clearTimeout(timers.get(key)); timers.delete(key); }
      return map.delete(key);
    },
    async keys(prefix) {
      return [...map.keys()].filter(k => k.startsWith(prefix));
    },
    isDurable() { return false; },
  };
}
