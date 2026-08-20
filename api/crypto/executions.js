// api/crypto/executions.js — serves the live-trader audit trail (executions.json)
// for the frontend. Reads the file written by server/crypto/backtest/liveTrader.mjs.
// In Vercel, this file is bundled at build time; if absent, returns a sample so
// the UI never breaks. NO secrets are exposed here.
import { sendJson, sendMethodNotAllowed } from '../_lib/http.js';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendMethodNotAllowed(res);
  try {
    const file = join(__dir, '..', '..', 'data', 'executions.json');
    if (existsSync(file)) {
      const data = JSON.parse(readFileSync(file, 'utf8'));
      return sendJson(res, 200, { ok: true, ...data, source: 'live-file' });
    }
    return sendJson(res, 200, {
      ok: true,
      mode: 'sample',
      pairs: 23,
      interval: '4h',
      start: 2300,
      updatedAt: Date.now(),
      trades: [
        { t: Date.now() - 60000, pair: 'SOLUSDT', event: 'OPEN', side: 'SHORT', price: 152.4, live: false, order: 'paper' },
        { t: Date.now() - 30000, pair: 'WIFUSDT', event: 'TP', side: 'LONG', price: 2.13, pnl: 1.85, equity: 101.85, live: false },
      ],
      source: 'sample',
    });
  } catch (e) {
    return sendJson(res, 500, { ok: false, error: 'executions_read_failed' });
  }
}
