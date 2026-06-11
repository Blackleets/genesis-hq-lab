// eventTimeline.mjs — canonical append-only operator event stream.
// Every meaningful system decision is logged here so operators can answer WHY.
//
// Design:
//   - synchronous (better-sqlite3) — never blocks callers
//   - append-only — events are never updated or deleted
//   - queryable by category, severity, subsystem, time range
//   - logEvent() swallows errors so it never kills the caller

import db from '../db/database.mjs';
import { randomBytes } from 'node:crypto';

// ── Constants ─────────────────────────────────────────────────────────────────

export const CATEGORY = {
  TRADING:    'TRADING',
  CONFIDENCE: 'CONFIDENCE',
  LEARNING:   'LEARNING',
  RISK:       'RISK',
  SYSTEM:     'SYSTEM',
  EXECUTION:  'EXECUTION',  // Phase 6A engine execution events
  SCAN:       'SCAN',       // Phase 6A market scanning events
  PREDICTION: 'PREDICTION', // Prediction Markets module
};

export const SEVERITY = {
  INFO:     'INFO',
  WARNING:  'WARNING',
  HIGH:     'HIGH',
  CRITICAL: 'CRITICAL',
};

// Alert events that must always be surfaced to the operator
export const CRITICAL_REASONS = new Set([
  'SAFE_MODE_ACTIVATED',
  'RECONCILIATION_DEGRADED',
  'EXECUTION_STALE',
  'ORPHAN_POSITIONS_FOUND',
  'UNKNOWN_EXPOSURE',
  'TREASURY_DEGRADED',
  'ENGINE_FAILURE',
  'GLOBAL_SAFE_MODE_ACTIVATED',
]);

// ── Prepared statement (lazy init to survive module ordering) ─────────────────

let _insert = null;
function insertStmt() {
  if (!_insert) {
    _insert = db.prepare(
      `INSERT OR IGNORE INTO operator_events (id, ts, category, severity, subsystem, reason, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
  }
  return _insert;
}

// ── Core API ──────────────────────────────────────────────────────────────────

/**
 * Log a single operator event. Never throws.
 *
 * @param {object} opts
 * @param {string} opts.category   — CATEGORY constant
 * @param {string} opts.severity   — SEVERITY constant
 * @param {string} opts.subsystem  — e.g. 'workflow', 'confidence'
 * @param {string} opts.reason     — human-readable one-liner
 * @param {object} [opts.metadata] — arbitrary JSON context
 * @returns {string} event id
 */
export function logEvent({ category, severity, subsystem, reason, metadata = {} }) {
  const ts  = new Date().toISOString();
  const id  = `${ts}-${subsystem}-${randomBytes(3).toString('hex')}`;
  try {
    insertStmt().run(id, ts, category, severity, subsystem, reason, JSON.stringify(metadata));
  } catch (err) {
    console.warn('[eventTimeline] logEvent failed:', err?.message);
  }
  return id;
}

/**
 * Query the timeline with optional filters.
 *
 * @param {object} [opts]
 * @param {number}  [opts.limit=100]
 * @param {string}  [opts.category]  — filter by category
 * @param {string}  [opts.severity]  — filter by severity
 * @param {string}  [opts.subsystem] — filter by subsystem
 * @param {string}  [opts.since]     — ISO 8601 lower bound (inclusive)
 * @returns {Array}
 */
export function getTimeline({ limit = 100, category = null, severity = null, subsystem = null, since = null } = {}) {
  let sql    = `SELECT * FROM operator_events WHERE 1=1`;
  const args = [];
  if (category)  { sql += ` AND category = ?`;  args.push(category); }
  if (severity)  { sql += ` AND severity = ?`;  args.push(severity); }
  if (subsystem) { sql += ` AND subsystem = ?`; args.push(subsystem); }
  if (since)     { sql += ` AND ts >= ?`;        args.push(since); }
  sql += ` ORDER BY ts DESC LIMIT ?`;
  args.push(limit);
  try {
    return db.prepare(sql).all(...args).map(parseRow);
  } catch {
    return [];
  }
}

/** Most recent N events across all categories. */
export function getRecentEvents(limit = 20) {
  return getTimeline({ limit });
}

/**
 * Active warnings — HIGH + CRITICAL events in the last hour.
 * Deduplicated by reason to avoid noise.
 */
export function getActiveWarnings() {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const rows  = db.prepare(`
    SELECT * FROM operator_events
    WHERE severity IN ('HIGH', 'CRITICAL') AND ts >= ?
    ORDER BY ts DESC LIMIT 50
  `).all(since);
  // Deduplicate by reason, keep latest
  const seen = new Set();
  return rows.filter(r => {
    if (seen.has(r.reason)) return false;
    seen.add(r.reason);
    return true;
  }).map(parseRow);
}

/**
 * The most common block reason in the last 24 hours.
 */
export function getTopFailureReason() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  try {
    const row = db.prepare(`
      SELECT reason, COUNT(*) AS cnt
      FROM operator_events
      WHERE category = 'TRADING' AND reason LIKE 'BLOCKED%' AND ts >= ?
      GROUP BY reason ORDER BY cnt DESC LIMIT 1
    `).get(since);
    return row ? `${row.reason} (×${row.cnt})` : null;
  } catch {
    return null;
  }
}

/**
 * Count of TRADING/BLOCKED events since a given ISO timestamp (default: last 24h).
 */
export function countBlockedTrades(since = null) {
  const cutoff = since ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  try {
    return db.prepare(`
      SELECT COUNT(*) AS cnt FROM operator_events
      WHERE category = 'TRADING' AND reason LIKE 'BLOCKED%' AND ts >= ?
    `).get(cutoff)?.cnt ?? 0;
  } catch {
    return 0;
  }
}

/**
 * System-level summary: why is Genesis not trading right now?
 */
export function getCurrentBlockers() {
  const since = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // last 30 min
  const rows  = db.prepare(`
    SELECT DISTINCT reason FROM operator_events
    WHERE category IN ('TRADING', 'RISK', 'CONFIDENCE')
      AND severity IN ('HIGH', 'CRITICAL')
      AND ts >= ?
    ORDER BY ts DESC LIMIT 10
  `).all(since);
  return rows.map(r => r.reason);
}

// ── Internal helper ───────────────────────────────────────────────────────────

function parseRow(row) {
  return {
    ...row,
    metadata: tryParse(row.metadata),
  };
}

function tryParse(str) {
  try { return JSON.parse(str); } catch { return {}; }
}
