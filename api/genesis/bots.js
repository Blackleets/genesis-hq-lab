// api/genesis/bots.js — user bot lifecycle: create (spawn), status, delete.
//
// MODEL ("incorruptible core, per-user execution"):
//   - Users connect a wallet and spawn THEIR OWN paper bot. The strategy
//     catalog, engine, gates and risk rules are OURS — users only choose
//     from the validated menu and set size within hard limits.
//   - Bot state is namespaced by ownerHash = sha256(addr).slice(0,16).
//   - Paper only. live_mode=false is structurally enforced here.
//
// STORAGE (durable layer, see api/_lib/store.js): bots live under keys
//   bots:<ownerHash>:<PAIR>_<TF>
// backed by Upstash Redis or Supabase in production. The old data/bots/
// writeFileSync approach was REMOVED on purpose: Vercel's filesystem is
// read-only/ephemeral, so user bots never actually persisted there. When no
// durable backend is configured this handler returns 503 storage_not_durable
// rather than pretending to save into a Map that dies with the lambda.
//
// WALLET WHITELIST (honest decision): if ALLOWED_WALLETS is set (lowercase,
// comma-separated), only those addresses may spawn bots (403
// wallet_not_whitelisted). If it is NOT set, spawning is open to any
// authenticated session. We do not fake an allowlist when none exists —
// absence of the env var is a deliberate open-door policy the operator can
// close at any time by setting the variable.
import { sendJson, sendMethodNotAllowed } from '../_lib/http.js';
import { requireSession, ownerHashFor } from '../_lib/sessionAuth.js';
import { getStore, DEGRADED_MESSAGE } from '../_lib/store.js';

export const STRATEGY_CATALOG = {
  meanReversion: {
    label: 'Mean Reversion (validated 6-gate family)',
    fixedParams: { rsiPeriod: 14, rsiLow: 31, rsiHigh: 71, bbPeriod: 22, bbMult: 10, slMult: 2.7, tpMult: 2.5, atrMinPct: 0.004 },
    editable: ['slMult', 'tpMult'],
    limits: { slMult: [1.5, 3.0], tpMult: [1.5, 3.0] },
  },
  volumeProfile: {
    label: 'Volume Profile Reversion',
    fixedParams: { vwapLookback: 40, devPct: 0.006, adxMax: 37 },
    editable: ['slMult', 'tpMult'],
    limits: { slMult: [1.2, 3.0], tpMult: [1.5, 3.0] },
  },
};

const ALLOWED_PAIRS = new Set(['COTIUSDT', 'XLMUSDT', 'BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
const MAX_BOTS_PER_USER = 3;
const INITIAL_PAPER_USD = 1000; // virtual, zero real dollars

function botKey(ownerHash, pair, tf) {
  return `bots:${ownerHash}:${pair}_${tf}`;
}

// Exported for tests + reuse: the honest whitelist policy. If ALLOWED_WALLETS
// is set (lowercase, comma-separated), only those addresses may spawn bots.
// If it is NOT set, spawning is open to any authenticated session — we do not
// fake an allowlist when none exists; unsetting the var is a deliberate
// open-door policy the operator can close by setting it.
function parseWhitelist() {
  const raw = process.env.ALLOWED_WALLETS;
  if (!raw || !raw.trim()) return null;
  return new Set(raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
}

export function isWhitelisted(address) {
  const wl = parseWhitelist();
  if (!wl) return true; // documented policy: unset env = free access
  return wl.has(String(address).toLowerCase());
}

/** Count only ACTIVE (non-archived) bots — archived ones must not eat slots. */
async function countUserBots(store, ownerHash) {
  const keys = await store.keys(`bots:${ownerHash}:`);
  let count = 0;
  for (const k of keys) {
    const st = await store.get(k);
    if (st && !st.archived) count++;
  }
  return count;
}

async function listUserBots(store, ownerHash, includeArchived) {
  const keys = await store.keys(`bots:${ownerHash}:`);
  const out = [];
  for (const k of keys) {
    const st = await store.get(k);
    if (!st) continue;
    if (st.archived && !includeArchived) continue;
    out.push(st);
  }
  return out;
}

async function handler(req, res) {
  const session = requireSession(req, res);
  if (!session) return;
  const ownerHash = ownerHashFor(session.address);

  const url = new URL(req.url, `http://${req.headers.host}`);
  const store = await getStore();

  // ---- POST /api/genesis/bots — spawn my bot ----
  if (req.method === 'POST') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', async () => {
      try {
        // DURABILITY GATE — refuse to fake a write we cannot keep.
        // In-memory storage survives only until this lambda instance dies;
        // telling the user their bot "spawned" would be a lie.
        if (!store.isDurable()) {
          return sendJson(res, 503, { ok: false, error: 'storage_not_durable', message: DEGRADED_MESSAGE });
        }

        // Whitelist gate (see header comment for the honest policy).
        if (!isWhitelisted(session.address)) {
          return sendJson(res, 403, { ok: false, error: 'wallet_not_whitelisted' });
        }

        const input = JSON.parse(body || '{}');
        const pair = String(input.pair || '').toUpperCase();
        const kind = String(input.kind || '');
        const tf = '1h'; // fixed for now — one honest timeframe
        const overrides = input.params && typeof input.params === 'object' ? input.params : {};

        if (!ALLOWED_PAIRS.has(pair)) {
          return sendJson(res, 400, { ok: false, error: 'pair_not_allowed', allowed: [...ALLOWED_PAIRS] });
        }
        const spec = STRATEGY_CATALOG[kind];
        if (!spec) {
          return sendJson(res, 400, { ok: false, error: 'unknown_strategy', available: Object.keys(STRATEGY_CATALOG) });
        }

        // FIX SLOTS BUG: only active bots consume the limit; archived ones don't.
        if ((await countUserBots(store, ownerHash)) >= MAX_BOTS_PER_USER) {
          return sendJson(res, 400, { ok: false, error: 'bot_limit_reached', limit: MAX_BOTS_PER_USER });
        }

        const key = botKey(ownerHash, pair, tf);
        // A previously ARCHIVED bot frees its pair/tf slot but still occupies
        // the key — resurrecting overwrites the archive intentionally.
        const existing = await store.get(key);
        if (existing && !existing.archived) {
          return sendJson(res, 409, { ok: false, error: 'bot_already_exists' });
        }

        // Merge params: fixed base + ONLY editable keys clamped to our limits.
        const params = { ...spec.fixedParams };
        for (const [k, v] of Object.entries(overrides)) {
          if (!spec.editable.includes(k)) continue;
          const [min, max] = spec.limits[k] || [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY];
          const num = Number(v);
          if (!Number.isFinite(num)) continue;
          params[k] = Math.min(max, Math.max(min, num));
        }
        const state = {
          pair, tf, kind,
          equity: INITIAL_PAPER_USD,
          initialEquity: INITIAL_PAPER_USD,
          position: null, trades: [], log: [], equityCurve: [],
          ownerHash,
          mode: 'paper',           // structural: this system cannot place real orders
          liveMode: false,         // golden rule, explicit
          createdAt: existing?.createdAt || new Date().toISOString(),
          params,
        };
        await store.set(key, state);
        sendJson(res, 201, { ok: true, bot: state, note: 'PAPER bot spawned. Virtual capital only.' });
      } catch (e) {
        sendJson(res, 500, { ok: false, error: e.message });
      }
    });
    return;
  }

  // ---- GET /api/genesis/bots — list MY bots (+ catalog for the UI) ----
  if (req.method === 'GET') {
    const includeArchived = url.searchParams.get('includeArchived') === '1';
    const bots = await listUserBots(store, ownerHash, includeArchived);
    sendJson(res, 200, {
      ok: true,
      bots,
      catalog: STRATEGY_CATALOG,
      allowedPairs: [...ALLOWED_PAIRS],
      limits: { maxBotsPerUser: MAX_BOTS_PER_USER, initialPaperUsd: INITIAL_PAPER_USD },
    });
    return;
  }

  // ---- DELETE /api/genesis/bots?pair=X&tf=1h — archive my own bot ----
  if (req.method === 'DELETE') {
    const pair = (url.searchParams.get('pair') || '').toUpperCase();
    const tf = url.searchParams.get('tf') || '1h';
    if (!pair) return sendJson(res, 400, { ok: false, error: 'pair_required' });
    const key = botKey(ownerHash, pair, tf);
    const st = await store.get(key);
    if (!st) return sendJson(res, 404, { ok: false, error: 'not_found' });
    st.archived = true;
    st.archivedAt = new Date().toISOString();
    await store.set(key, st);
    sendJson(res, 200, { ok: true, archived: true });
    return;
  }

  sendMethodNotAllowed(res, 'GET, POST, DELETE');
}

export default handler;
