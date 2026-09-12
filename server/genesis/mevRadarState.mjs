// mevRadarState.mjs
// Cross-process heartbeat for the autonomous MEV SHADOW radar.
// This is observation state only. It cannot sign, submit, or authorize transactions.

import db from '../db/database.mjs';

let ready = false;

function ensureTable() {
  if (ready) return;
  db.prepare(`
    CREATE TABLE IF NOT EXISTS mev_shadow_heartbeat (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      status TEXT NOT NULL,
      provider_configured INTEGER NOT NULL DEFAULT 0,
      block_number TEXT,
      routes_scanned INTEGER NOT NULL DEFAULT 0,
      observations_recorded INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      data_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();
  ready = true;
}

export function writeMevRadarHeartbeat(payload = {}) {
  ensureTable();
  const now = new Date().toISOString();
  const row = {
    status: String(payload.status ?? 'idle'),
    providerConfigured: payload.providerConfigured === true ? 1 : 0,
    blockNumber: payload.blockNumber == null ? null : String(payload.blockNumber),
    routesScanned: Math.max(0, Number(payload.routesScanned) || 0),
    observationsRecorded: Math.max(0, Number(payload.observationsRecorded) || 0),
    error: payload.error ? String(payload.error).slice(0, 500) : null,
    dataJson: JSON.stringify({ ...payload, updatedAt: now }),
    updatedAt: now,
  };

  db.prepare(`
    INSERT INTO mev_shadow_heartbeat (
      id, status, provider_configured, block_number, routes_scanned,
      observations_recorded, error, data_json, updated_at
    ) VALUES (1, @status, @providerConfigured, @blockNumber, @routesScanned,
      @observationsRecorded, @error, @dataJson, @updatedAt)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      provider_configured = excluded.provider_configured,
      block_number = excluded.block_number,
      routes_scanned = excluded.routes_scanned,
      observations_recorded = excluded.observations_recorded,
      error = excluded.error,
      data_json = excluded.data_json,
      updated_at = excluded.updated_at
  `).run(row);

  return { ...payload, updatedAt: now };
}

export function readMevRadarHeartbeat() {
  ensureTable();
  const row = db.prepare(`SELECT * FROM mev_shadow_heartbeat WHERE id = 1`).get();
  if (!row) {
    return {
      status: 'idle',
      providerConfigured: Boolean(process.env.GENESIS_MEV_RPC_URL?.trim()),
      blockNumber: null,
      routesScanned: 0,
      observationsRecorded: 0,
      error: null,
      updatedAt: null,
    };
  }

  let data = {};
  try { data = JSON.parse(row.data_json || '{}'); } catch { data = {}; }
  return {
    ...data,
    status: row.status,
    providerConfigured: row.provider_configured === 1,
    blockNumber: row.block_number,
    routesScanned: row.routes_scanned,
    observationsRecorded: row.observations_recorded,
    error: row.error,
    updatedAt: row.updated_at,
  };
}
