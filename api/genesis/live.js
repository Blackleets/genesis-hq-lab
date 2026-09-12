// api/genesis/live.js — Quant Lab paper bots + treasury state for the Vercel
// frontend. Vercel has no persistent disk, so it reads the state files from the
// repo snapshot if present; otherwise returns honest empty state (no theater).
// The local backend (server/index.mjs) serves the same shape from live files.
//
// MULTI-TENANT (wallet auth): this endpoint requires a valid Bearer session.
// Bot states may carry an `ownerHash` field (sha256 of the owner's lowercase
// address, truncated to 16 hex chars — never the raw address). Users see ONLY
// bots whose ownerHash matches their own wallet; the operator role sees all
// bots (read-only audit view). Legacy states without ownerHash are treated as
// operator-owned: only the operator sees them, users get an honest empty list.
import { sendJson, sendMethodNotAllowed } from '../_lib/http.js';
import { requireSession, tenantFilter, ownerHashFor } from '../_lib/sessionAuth.js';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dir, '..', '..', 'data');
const BOTS_DIR = join(DATA, 'bots'); // namespaced layout: data/bots/<ownerHash16>/<PAIR>_<TF>.json

function tryRead(f) {
  const p = join(DATA, f);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

function tryReadPath(p) {
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

// Collect bot states from both layouts:
// - legacy flat files: data/genesis_live_state_<PAIR>_<TF>.json (no ownerHash)
// - namespaced dirs:   data/bots/<ownerHash16>/<PAIR>_<TF>.json (ownerHash on state)
function loadBots() {
  const bots = [];
  if (existsSync(DATA)) {
    for (const f of readdirSync(DATA)) {
      if (f.startsWith('genesis_live_state_') && f.endsWith('.json')) {
        const st = tryRead(f);
        if (st) bots.push({ ...st, pair: f.replace('genesis_live_state_', '').replace('.json', '') });
      }
    }
  }
  if (existsSync(BOTS_DIR)) {
    for (const dir of readdirSync(BOTS_DIR)) {
      const sub = join(BOTS_DIR, dir);
      let files = [];
      try { files = existsSync(sub) ? readdirSync(sub) : []; } catch { files = []; }
      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        const st = tryReadPath(join(sub, f));
        if (!st) continue;
        bots.push({ ...st, pair: f.replace(/\.json$/, ''), ownerHash: st.ownerHash || dir });
      }
    }
  }
  return bots;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendMethodNotAllowed(res);
  const session = await requireSession(req, res);
  if (!session) return; // 401 sent

  const filter = tenantFilter(session); // null => operator sees everything
  const isOperator = filter === null;

  // Tenant filtering happens BEFORE anything else touches the response: a user
  // must never receive bytes owned by another wallet.
  const myHash = isOperator ? null : ownerHashFor(session.address);
  const allBots = loadBots();
  // Tenant filtering happens BEFORE anything else touches the response: a user
  // must never receive bytes owned by another wallet. Bots without ownerHash
  // are legacy operator-owned data -> users see an honest empty list.
  const visibleBots = isOperator ? allBots : allBots.filter(b => b.ownerHash && b.ownerHash === myHash);

  let source = visibleBots.length ? 'repo-files' : 'empty';
  // Fallback: Gist feed pushed by the hourly bot (same mechanism as executions).
  // This is OPERATOR fleet data -> only served to the operator role.
  if (!visibleBots.length && isOperator) {
    try {
      const r = await fetch('https://gist.githubusercontent.com/Blackleets/15c0ce3456373348038271520d641324/raw/executions.json', { cache: 'no-store' });
      if (r.ok) {
        const gist = await r.json();
        return sendJson(res, 200, { ok: true, bots: [], bot: null, treasury: tryRead('genesis_treasury_state.json'), gistFeed: gist, source: 'gist-fallback', updatedAt: new Date().toISOString() });
      }
    } catch { /* fall through to empty */ }
    source = 'no-state-yet';
  }

  sendJson(res, 200, {
    ok: true,
    bots: visibleBots,
    bot: visibleBots[0] ?? null,
    // Treasury paper-capital numbers belong to the operator; users get null.
    treasury: isOperator ? tryRead('genesis_treasury_state.json') : null,
    source,
    updatedAt: new Date().toISOString(),
  });
}
