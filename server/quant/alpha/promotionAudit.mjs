// promotionAudit.mjs — records strategy status transitions and supports manual overrides.
//
// Why: deriveStatus() in strategyRegistry computes status on every call with no memory.
// When a strategy hits PROMOTED or falls to REJECTED, there's no record and no alert.
//
// This module adds:
//   1. Transition log  — SQLite table of every RESEARCH→PAPER→PROMOTED→REJECTED change
//   2. Manual overrides — freeze a strategy at a specific status (e.g., keep at PAPER)
//   3. Prominent console logs when promotion/demotion occurs

import db from '../../db/database.mjs';

const MAX_HISTORY = 200;

// ── Schema ────────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS strategy_transitions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    strategy_id  TEXT    NOT NULL,
    from_status  TEXT,
    to_status    TEXT    NOT NULL,
    trades       INTEGER,
    profit_factor REAL,
    avg_pnl      REAL,
    win_rate     REAL,
    reason       TEXT,
    recorded_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_strat_trans_id  ON strategy_transitions(strategy_id);
  CREATE INDEX IF NOT EXISTS idx_strat_trans_at  ON strategy_transitions(recorded_at);

  CREATE TABLE IF NOT EXISTS strategy_overrides (
    strategy_id  TEXT PRIMARY KEY,
    status       TEXT NOT NULL,
    reason       TEXT,
    set_by       TEXT,
    set_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ── In-memory cache of last seen status (avoids hammering DB on every registry call) ──

const _lastSeen = new Map(); // strategyId → status

// ── Transition log ────────────────────────────────────────────────────────────

/**
 * Record a status transition if the status has changed since last seen.
 * Call this from getStrategyRegistry() for each strategy.
 */
export function recordStatusIfChanged(strategyId, newStatus, liveData = {}) {
  const prev = _lastSeen.get(strategyId);
  if (prev === newStatus) return; // no change

  const fromStatus = prev ?? null;
  _lastSeen.set(strategyId, newStatus);

  // Log prominently for key transitions
  if (newStatus === 'PROMOTED') {
    console.log(
      `[promotionAudit] 🚀 PROMOTED: ${strategyId} ` +
      `(trades=${liveData.trades} PF=${liveData.profitFactor?.toFixed(2)} ` +
      `WR=${liveData.winRate != null ? (liveData.winRate * 100).toFixed(1) + '%' : 'N/A'})`
    );
  } else if (newStatus === 'REJECTED') {
    console.log(`[promotionAudit] ❌ REJECTED: ${strategyId} (was ${fromStatus}, PF=${liveData.profitFactor?.toFixed(2)})`);
  } else if (fromStatus === 'PROMOTED') {
    console.log(`[promotionAudit] ⬇ DEMOTION: ${strategyId} ${fromStatus}→${newStatus}`);
  }

  try {
    db.prepare(`
      INSERT INTO strategy_transitions
        (strategy_id, from_status, to_status, trades, profit_factor, avg_pnl, win_rate, reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      strategyId,
      fromStatus,
      newStatus,
      liveData.trades    ?? null,
      liveData.profitFactor ?? null,
      liveData.avgPnl    ?? null,
      liveData.winRate   ?? null,
      fromStatus == null
        ? 'first_seen'
        : `${fromStatus}→${newStatus}`,
    );

    // Prune old rows
    db.prepare(`
      DELETE FROM strategy_transitions
      WHERE id NOT IN (
        SELECT id FROM strategy_transitions ORDER BY id DESC LIMIT ?
      )
    `).run(MAX_HISTORY);
  } catch {
    // non-fatal
  }
}

/**
 * Return the N most recent transitions, optionally filtered by strategyId.
 */
export function getTransitionHistory({ strategyId, limit = 50 } = {}) {
  try {
    if (strategyId) {
      return db.prepare(`
        SELECT * FROM strategy_transitions
        WHERE strategy_id = ?
        ORDER BY id DESC LIMIT ?
      `).all(strategyId, limit);
    }
    return db.prepare(`
      SELECT * FROM strategy_transitions
      ORDER BY id DESC LIMIT ?
    `).all(limit);
  } catch {
    return [];
  }
}

// ── Manual overrides ──────────────────────────────────────────────────────────

/**
 * Freeze a strategy at a given status, preventing automatic promotion/demotion.
 * Use this to keep a strategy in PAPER even if it meets PROMOTED criteria,
 * or to temporarily DISABLE without changing env vars.
 */
export function setStatusOverride(strategyId, status, { reason = null, setBy = 'operator' } = {}) {
  db.prepare(`
    INSERT OR REPLACE INTO strategy_overrides (strategy_id, status, reason, set_by, set_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `).run(strategyId, status, reason, setBy);
  console.log(`[promotionAudit] OVERRIDE SET: ${strategyId} → ${status} (${reason ?? 'no reason'})`);
}

/**
 * Remove a manual override, allowing auto-computation to resume.
 */
export function clearStatusOverride(strategyId) {
  db.prepare(`DELETE FROM strategy_overrides WHERE strategy_id = ?`).run(strategyId);
  console.log(`[promotionAudit] OVERRIDE CLEARED: ${strategyId}`);
}

/**
 * Get the active override for a strategy, if any.
 * Returns null if no override is set.
 */
export function getStatusOverride(strategyId) {
  try {
    return db.prepare(`
      SELECT * FROM strategy_overrides WHERE strategy_id = ?
    `).get(strategyId) ?? null;
  } catch {
    return null;
  }
}

/**
 * Get all active overrides.
 */
export function getAllOverrides() {
  try {
    return db.prepare(`SELECT * FROM strategy_overrides ORDER BY set_at DESC`).all();
  } catch {
    return [];
  }
}
