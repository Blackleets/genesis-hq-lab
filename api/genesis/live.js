// api/genesis/live.js — Quant Lab paper bots + treasury state for the Vercel
// frontend. Vercel has no persistent disk, so it reads the state files from the
// repo snapshot if present; otherwise returns honest empty state (no theater).
// The local backend (server/index.mjs) serves the same shape from live files.
import { sendJson, sendMethodNotAllowed } from '../_lib/http.js';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dir, '..', '..', 'data');

function tryRead(f) {
  const p = join(DATA, f);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendMethodNotAllowed(res);
  const files = existsSync(DATA)
    ? readdirSync(DATA).filter(f => f.startsWith('genesis_live_state_') && f.endsWith('.json'))
    : [];
  const bots = files.map(f => ({ ...(tryRead(f) || {}), pair: f.replace('genesis_live_state_', '').replace('.json', '') }));
  // Fallback: Gist feed pushed by the hourly bot (same mechanism as executions)
  let source = bots.length ? 'repo-files' : 'empty';
  if (!bots.length) {
    try {
      const r = await fetch('https://gist.githubusercontent.com/Blackleets/15c0ce3456373348038271520d641324/raw/executions.json', { cache: 'no-store' });
      if (r.ok) {
        const gist = await r.json();
        return sendJson(res, 200, { ok: true, bots: [], bot: null, treasury: null, gistFeed: gist, source: 'gist-fallback', updatedAt: new Date().toISOString() });
      }
    } catch { /* fall through to empty */ }
    source = 'no-state-yet';
  }
  sendJson(res, 200, {
    ok: true,
    bots,
    bot: bots[0] ?? null,
    treasury: tryRead('genesis_treasury_state.json'),
    source,
    updatedAt: new Date().toISOString(),
  });
}
