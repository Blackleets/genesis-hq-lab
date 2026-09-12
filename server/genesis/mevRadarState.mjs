// mevRadarState.mjs
// Cross-process heartbeat + compact public snapshot for the autonomous MEV SHADOW radar.
// This is observation state only. It cannot sign, submit, or authorize transactions.

import db from '../db/database.mjs';

const PUBLIC_STATE_KEY = 'mev_shadow_radar_public';
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

// Store only a compact, non-secret, read-only dashboard payload in the existing
// org_state KV table. The normal DB replication path can mirror this row to
// Supabase without introducing a new schema or exposing RPC credentials.
export function writeMevRadarPublicSnapshot(snapshot = {}) {
  const now = new Date().toISOString();
  const clean = {
    mode: 'SHADOW',
    executionAuthority: false,
    status: snapshot.status ?? 'idle',
    providerConfigured: snapshot.providerConfigured === true,
    chainId: snapshot.chainId ?? null,
    blockNumber: snapshot.blockNumber == null ? null : String(snapshot.blockNumber),
    routesScanned: Math.max(0, Number(snapshot.routesScanned) || 0),
    routesQuoted: Math.max(0, Number(snapshot.routesQuoted) || 0),
    evaluated: Math.max(0, Number(snapshot.evaluated) || 0),
    qualified: Math.max(0, Number(snapshot.qualified) || 0),
    filtered: Math.max(0, Number(snapshot.filtered) || 0),
    theoreticalExpectedNetPnlUsd: Number.isFinite(snapshot.theoreticalExpectedNetPnlUsd)
      ? snapshot.theoreticalExpectedNetPnlUsd
      : null,
    theoreticalStressNetPnlUsd: Number.isFinite(snapshot.theoreticalStressNetPnlUsd)
      ? snapshot.theoreticalStressNetPnlUsd
      : null,
    medianNetEdgeBps: Number.isFinite(snapshot.medianNetEdgeBps) ? snapshot.medianNetEdgeBps : null,
    topRoutes: Array.isArray(snapshot.topRoutes) ? snapshot.topRoutes.slice(0, 8).map((route) => ({
      route: String(route.route ?? ''),
      expectedNetPnlUsd: Number.isFinite(route.expectedNetPnlUsd) ? route.expectedNetPnlUsd : null,
      stressNetPnlUsd: Number.isFinite(route.stressNetPnlUsd) ? route.stressNetPnlUsd : null,
      netEdgeBps: Number.isFinite(route.netEdgeBps) ? route.netEdgeBps : null,
      status: route.status === 'qualified' ? 'qualified' : 'filtered',
      blockers: Array.isArray(route.blockers) ? route.blockers.slice(0, 6).map(String) : [],
      capturedAt: route.capturedAt ?? null,
    })) : [],
    error: snapshot.error ? String(snapshot.error).slice(0, 300) : null,
    updatedAt: now,
    note: 'SHADOW opportunity economics only; not realized account PnL.',
  };

  db.prepare(`
    INSERT INTO org_state (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(PUBLIC_STATE_KEY, JSON.stringify(clean), now);
  return clean;
}

export function readMevRadarPublicSnapshot() {
  const row = db.prepare(`SELECT value, updated_at FROM org_state WHERE key = ?`).get(PUBLIC_STATE_KEY);
  if (!row?.value) return null;
  try {
    return { ...JSON.parse(row.value), stateUpdatedAt: row.updated_at };
  } catch {
    return null;
  }
}

export { PUBLIC_STATE_KEY };
