// api/genesis/bots.js — user bot lifecycle: create (spawn), status, delete.
//
// MODEL ("incorruptible core, per-user execution"):
//   - Users connect a wallet and spawn THEIR OWN paper bot. The strategy
//     catalog, engine, gates and risk rules are OURS — users only choose
//     from the validated menu and set size within hard limits.
//   - Bot state is namespaced by ownerHash = sha256(addr).slice(0,16).
//   - Paper only. live_mode=false is structurally enforced here.
import { sendJson, sendMethodNotAllowed } from '../_lib/http.js';
import { requireSession } from '../_lib/sessionAuth.js';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, readdirSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dir, '..', '..', 'data');
const BOTS_DIR = join(DATA, 'bots');

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

export function ownerHashFor(address) {
  return createHash('sha256').update(String(address).toLowerCase()).digest('hex').slice(0, 16);
}

function botDir(ownerHash) {
  return join(BOTS_DIR, ownerHash);
}

function botStatePath(ownerHash, pair, tf) {
  return join(botDir(ownerHash), `${pair}_${tf}.json`);
}

function readJson(p) {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

/** Atomic write: temp + rename so a crash never leaves a half-file. */
function atomicWrite(p, obj) {
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(obj, null, 2));
  renameSync(tmp, p);
}

function countUserBots(ownerHash) {
  const dir = botDir(ownerHash);
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter(f => f.endsWith('.json')).length;
}

async function handler(req, res) {
  const session = requireSession(req, res);
  if (!session) return;
  const ownerHash = ownerHashFor(session.address);

  const url = new URL(req.url, `http://${req.headers.host}`);

  // ---- POST /api/genesis/bots — spawn my bot ----
  if (req.method === 'POST') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try {
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
        if (countUserBots(ownerHash) >= MAX_BOTS_PER_USER) {
          return sendJson(res, 400, { ok: false, error: 'bot_limit_reached', limit: MAX_BOTS_PER_USER });
        }
        const path_ = botStatePath(ownerHash, pair, tf);
        if (existsSync(path_)) {
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
          createdAt: new Date().toISOString(),
          params,
        };
        atomicWrite(path_, state);
        sendJson(res, 201, { ok: true, bot: state, note: 'PAPER bot spawned. Virtual capital only.' });
      } catch (e) {
        sendJson(res, 500, { ok: false, error: e.message });
      }
    });
    return;
  }

  // ---- GET /api/genesis/bots — list MY bots (+ catalog for the UI) ----
  if (req.method === 'GET') {
    const dir = botDir(ownerHash);
    const bots = existsSync(dir)
      ? readdirSync(dir).filter(f => f.endsWith('.json')).map(f => readJson(join(dir, f))).filter(Boolean)
      : [];
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
    const path_ = botStatePath(ownerHash, pair, tf);
    if (!existsSync(path_)) return sendJson(res, 404, { ok: false, error: 'not_found' });
    const st = readJson(path_);
    if (st) { st.archived = true; st.archivedAt = new Date().toISOString(); atomicWrite(path_, st); }
    sendJson(res, 200, { ok: true, archived: true });
    return;
  }

  sendMethodNotAllowed(res, 'GET, POST, DELETE');
}

export default handler;
