// schedulerHeartbeat.mjs — cross-process heartbeat for the execution scheduler.
//
// The scheduler (executionScheduler) runs in the AGENT process; /api/crypto/diagnostics
// is served by the SERVER process. In-memory status never crosses that boundary, so the
// UI heartbeat showed FAST/MID/SLOW OFFLINE even while the loops were running. This
// module persists the scheduler status + scan snapshot to the SHARED SQLite file so the
// server process can read the agent process's real state.
//
// Isolated, additive table — no change to execution logic.

import db from '../db/database.mjs';

let _ready = false;
function ensureTable() {
  if (_ready) return;
  try {
    db.prepare(`CREATE TABLE IF NOT EXISTS engine_heartbeat (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT,
      updated_at TEXT
    )`).run();
    _ready = true;
  } catch { /* non-fatal — heartbeat is best-effort */ }
}

/** Persist the latest scheduler status + scan snapshot (called by the agent process). */
export function writeHeartbeat(payload) {
  try {
    ensureTable();
    const json = JSON.stringify({ ...payload, writtenAt: new Date().toISOString() });
    db.prepare(`INSERT INTO engine_heartbeat (id, data, updated_at) VALUES (1, ?, ?)
                ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`)
      .run(json, new Date().toISOString());
  } catch { /* never block the scheduler */ }
}

/** Read the latest heartbeat (called by the server process's diagnostics route). */
export function readHeartbeat() {
  try {
    ensureTable();
    const row = db.prepare(`SELECT data, updated_at FROM engine_heartbeat WHERE id = 1`).get();
    if (!row?.data) return null;
    const parsed = JSON.parse(row.data);
    return { ...parsed, updatedAt: row.updated_at };
  } catch {
    return null;
  }
}
