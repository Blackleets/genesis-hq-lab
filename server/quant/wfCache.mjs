// wfCache.mjs — persists walk-forward results in org_state (key-value DB table).
//
// Walk-forward runs are expensive (2-3s, Binance API calls) so results are cached.
// The validation gate reads the cache synchronously — never triggers a live run.
// A background runner or the /api/quant/wf/run endpoint writes new results here.

import db from '../db/database.mjs';

const WF_KEY           = 'quant_wf_latest';
const DEFAULT_MAX_AGE  = 24; // hours before cache is considered stale

export function getWfCache() {
  try {
    const row = db.prepare(`SELECT value, updated_at FROM org_state WHERE key = ?`).get(WF_KEY);
    if (!row) return null;
    const result = JSON.parse(row.value);
    return { ...result, cachedAt: row.updated_at };
  } catch {
    return null;
  }
}

export function setWfCache(result) {
  const value = JSON.stringify(result);
  db.prepare(`
    INSERT OR REPLACE INTO org_state (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
  `).run(WF_KEY, value);
}

export function isWfCacheStale(maxAgeHours = DEFAULT_MAX_AGE) {
  try {
    const row = db.prepare(`SELECT updated_at FROM org_state WHERE key = ?`).get(WF_KEY);
    if (!row) return true;
    const ageMs = Date.now() - new Date(row.updated_at).getTime();
    return ageMs > maxAgeHours * 3_600_000;
  } catch {
    return true;
  }
}

export function clearWfCache() {
  db.prepare(`DELETE FROM org_state WHERE key = ?`).run(WF_KEY);
}
