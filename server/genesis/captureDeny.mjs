// server/genesis/captureDeny.mjs
// Paper-only name denylist. Earn-the-right-to-quote: a session that filled
// and lost money cannot be re-quoted until a cooldown elapses.
// Never invents symbols. Empty / missing file = no denies.
// I/O is for the CLI worker. Vercel must not write.

import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_DENY_PATH = 'data/capture-deny.json';
export const DENY_MS = 6 * 60 * 60 * 1000; // 6 hours

function asMap(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [sym, e] of Object.entries(raw)) {
    if (!sym || typeof sym !== 'string' || !e || typeof e !== 'object') continue;
    const until = +e.until;
    if (!Number.isFinite(until)) continue;
    const pnl = +e.pnl;
    out[sym] = { pnl: Number.isFinite(pnl) ? pnl : 0, until };
  }
  return out;
}

export function pruneExpired(map, now = Date.now()) {
  const src = map && typeof map === 'object' ? map : {};
  const out = {};
  for (const [sym, e] of Object.entries(src)) {
    if (!e || !Number.isFinite(+e.until) || +e.until <= now) continue;
    out[sym] = { pnl: Number.isFinite(+e.pnl) ? +e.pnl : 0, until: +e.until };
  }
  return out;
}

export function isDenied(map, symbol, now = Date.now()) {
  if (!symbol || typeof symbol !== 'string') return false;
  const e = map && map[symbol];
  if (!e) return false;
  const until = +e.until;
  return Number.isFinite(until) && until > now;
}

/** After a session with fills: if netPnl < 0, deny that symbol for ttlMs. */
export function recordNegativeSession(map, session, now = Date.now(), ttlMs = DENY_MS) {
  const next = pruneExpired(map, now);
  const sym = session && typeof session.symbol === 'string' ? session.symbol : '';
  const fills = session && Array.isArray(session.fills) ? session.fills.length : 0;
  const pnl = session && Number.isFinite(+session.netPnl) ? +session.netPnl : 0;
  if (!sym || fills < 1 || !(pnl < 0)) return next;
  next[sym] = { pnl, until: now + ttlMs };
  return next;
}

export function loadDeny(filePath = DEFAULT_DENY_PATH, now = Date.now()) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw || !String(raw).trim()) return {};
    return pruneExpired(asMap(JSON.parse(raw)), now);
  } catch {
    return {};
  }
}

export function saveDeny(map, filePath = DEFAULT_DENY_PATH, now = Date.now()) {
  if (!filePath) return;
  const pruned = pruneExpired(map, now);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(pruned, null, 2) + '\n');
}
