// api/crypto/executions.js — serves the live-trader audit trail (executions.json)
// for the frontend. On Vercel there is no persistent disk, so it falls back to
// fetching the live Gist (updated by the funding-paper bot every ~9 min) when
// the local file is absent. NO secrets are exposed here.
import { sendJson, sendMethodNotAllowed } from '../_lib/http.js';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));

// Gist holding the live executions.json (id is public, content is the bot feed).
const GIST_ID = '15c0ce3456373348038271520d641324';
const GIST_RAW = `https://gist.githubusercontent.com/Blackleets/${GIST_ID}/raw/executions.json`;

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendMethodNotAllowed(res);
  try {
    const file = join(__dir, '..', '..', 'data', 'executions.json');
    if (existsSync(file)) {
      const data = JSON.parse(readFileSync(file, 'utf8'));
      return sendJson(res, 200, { ok: true, ...data, source: 'live-file' });
    }
    // Fallback: live Gist (real bot data pushed by the cron bot).
    try {
      const r = await fetch(GIST_RAW, { cache: 'no-store' });
      if (r.ok) {
        const data = await r.json();
        return sendJson(res, 200, { ok: true, ...data, source: 'live-gist' });
      }
    } catch (g) { /* fall through to empty */ }
    return sendJson(res, 200, {
      ok: true,
      mode: 'empty',
      trades: [],
      start: 10000,
      updatedAt: Date.now(),
      source: 'empty',
      note: 'no gist, no local file. honest empty. no sample fills.',
    });
  } catch (e) {
    return sendJson(res, 500, { ok: false, error: 'executions_read_failed' });
  }
}
