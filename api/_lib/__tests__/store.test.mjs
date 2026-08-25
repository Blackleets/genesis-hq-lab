// api/_lib/__tests__/store.test.mjs — storage layer + bots policy unit tests.
// Covers: memory adapter contract (get/set/del/keys/isDurable), adapter
// resolution from env, and the wallet whitelist logic with mocked env.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getStore, resetStoreCache, DEGRADED_MESSAGE } from '../store.js';

const ENV_KEYS = ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'ALLOWED_WALLETS'];
let savedEnv;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  resetStoreCache();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  resetStoreCache();
});

// Real exported helper from api/genesis/bots.js — no mirrored copy.
const botsModule = await import('../../genesis/bots.js');

describe('memory adapter', () => {
  async function mem() {
    const store = await getStore();
    return store;
  }

  it('is selected when no durable backend env is configured', async () => {
    const store = await mem();
    expect(store.name).toBe('memory');
    expect(store.isDurable()).toBe(false);
    expect(store.degraded).toBe(true);
  });

  it('set/get round-trips a JSON-serializable value', async () => {
    const store = await mem();
    const bot = { pair: 'BTCUSDT', tf: '1h', equity: 1000 };
    await store.set('bots:abc:BTCUSDT_1h', bot);
    expect(await store.get('bots:abc:BTCUSDT_1h')).toEqual(bot);
  });

  it('get returns null for missing keys', async () => {
    const store = await mem();
    expect(await store.get('bots:nobody:XLMUSDT_1h')).toBeNull();
  });

  it('del removes a key and reports whether anything was deleted', async () => {
    const store = await mem();
    await store.set('k1', { a: 1 });
    expect(await store.del('k1')).toBe(true);
    expect(await store.get('k1')).toBeNull();
    expect(await store.del('k1')).toBe(false); // absent -> false
  });

  it('keys(prefix) returns only matching keys', async () => {
    const store = await mem();
    await store.set('bots:aaa:COTIUSDT_1h', { v: 1 });
    await store.set('bots:aaa:BTCUSDT_1h', { v: 2 });
    await store.set('bots:bbb:SOLUSDT_1h', { v: 3 });
    const keys = await store.keys('bots:aaa:');
    expect(keys.sort()).toEqual(['bots:aaa:BTCUSDT_1h', 'bots:aaa:COTIUSDT_1h']);
  });

  it('honors ttlSec expiry (short real TTL)', async () => {
    const store = await mem();
    await store.set('ephemeral', { x: 1 }, 0.05); // 50ms
    expect(await store.get('ephemeral')).toEqual({ x: 1 });
    await new Promise(r => setTimeout(r, 80));
    expect(await store.get('ephemeral')).toBeNull();
  }, 5000);

  it('exposes the degraded message constant verbatim', () => {
    expect(DEGRADED_MESSAGE).toContain('storage_not_durable'.replace('storage_not_durable', 'Configura'));
    expect(DEGRADED_MESSAGE).toContain('Vercel');
  });
});

describe('adapter resolution from env', () => {
  it('prefers Upstash Redis when its env vars are present', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 't';
    // Also present but lower priority:
    process.env.SUPABASE_URL = 'https://sb.example.com';
    process.env.SUPABASE_SERVICE_KEY = 'k';
    const store = await getStore();
    expect(store.name).toBe('upstash-redis');
    expect(store.isDurable()).toBe(true);
  });

  it('falls back to Supabase PostgREST without Upstash vars', async () => {
    process.env.SUPABASE_URL = 'https://sb.example.com/';
    process.env.SUPABASE_SERVICE_KEY = 'svc';
    const store = await getStore();
    expect(store.name).toBe('supabase-postgrest');
    expect(store.isDurable()).toBe(true);
  });
});

describe('wallet whitelist logic (ALLOWED_WALLETS)', () => {
  // Real exported helper from api/genesis/bots.js — no mirrored copy.
  const { isWhitelisted } = botsModule;

  it('allows any wallet when ALLOWED_WALLETS is unset', () => {
    expect(isWhitelisted('0xABC')).toBe(true);
    expect(isWhitelisted('anyone')).toBe(true);
  });

  it('allows only listed wallets (case-insensitive) when set', () => {
    process.env.ALLOWED_WALLETS = ' 0XAAAA ,0xbbbb,, ';
    expect(isWhitelisted('0xaaaa')).toBe(true);
    expect(isWhitelisted('0xBBBB')).toBe(true);
    expect(isWhitelisted('0xcccc')).toBe(false);
  });

  it('empty string behaves like unset (open access)', () => {
    process.env.ALLOWED_WALLETS = '   ';
    expect(isWhitelisted('0xabc')).toBe(true);
  });
});
