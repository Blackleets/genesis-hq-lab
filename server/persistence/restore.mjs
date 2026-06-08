#!/usr/bin/env node
// restore.mjs — pre-start hybrid-persistence restore.
//
// Runs ONCE before the server/agent processes start. If SQLite is empty/stale (e.g.
// after an ephemeral-disk wipe) and Postgres holds durable state, it repopulates
// SQLite from Postgres so Genesis boots with its accumulated trades/learning intact.
//
// Always exits 0 — a restore failure must never block the app from starting.

import { getDbMode, isReplicationEnabled, restoreFromPg } from './dbReplicator.mjs';

const start = Date.now();
try {
  if (!isReplicationEnabled()) {
    console.log(`[restore] mode=${getDbMode()} — nothing to restore (sqlite mode or no DATABASE_URL).`);
    process.exit(0);
  }
  console.log(`[restore] mode=${getDbMode()} — checking durable state in Supabase…`);
  const res = await restoreFromPg();
  if (res.ok) {
    console.log(`[restore] ${res.restored > 0 ? `restored ${res.restored} durable rows from Postgres` : `local DB fresh (${res.reason ?? 'ok'})`} in ${((Date.now() - start) / 1000).toFixed(1)}s`);
  } else {
    console.warn(`[restore] skipped — ${res.reason}. Genesis will start on local SQLite.`);
  }
} catch (err) {
  console.warn('[restore] error (non-fatal):', err?.message);
}
process.exit(0);
