// decisionLedger.mjs — write-once audit trail for every agent signal decision.
//
// Each row is written once (INSERT OR IGNORE) via a deterministic ID so that
// a crash + restart cannot produce duplicate entries. Outcome is resolved
// exactly once via UPDATE ... WHERE outcome IS NULL.
//
// ID scheme:  "{agentName}:{ticker}:{signal}:{Math.floor(ts / WINDOW_MS)}"
// where WINDOW_MS matches the agent's in-memory cooldown (15 min).
// Same agent + ticker + signal within one window → same ID → second insert is IGNORED.

import db from '../db/database.mjs';

// ── Prepared statements (module-level — compiled once, reused) ────────────────

const _insert = db.prepare(`
  INSERT OR IGNORE INTO agent_decisions
    (id, timestamp, ticker, agent_name, signal, confidence, reasoning_json,
     market_price, market_category, outcome, resolved_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
`);

const _resolve = db.prepare(`
  UPDATE agent_decisions
  SET outcome = ?, resolved_at = ?
  WHERE id = ? AND outcome IS NULL
`);

const _recent = db.prepare(`
  SELECT * FROM agent_decisions
  ORDER BY timestamp DESC
  LIMIT ?
`);

const _stats = db.prepare(`
  SELECT
    agent_name,
    signal,
    COUNT(*)                                              AS total,
    ROUND(AVG(confidence), 3)                             AS avg_confidence,
    SUM(CASE WHEN outcome = 'WIN'     THEN 1 ELSE 0 END) AS wins,
    SUM(CASE WHEN outcome = 'LOSS'    THEN 1 ELSE 0 END) AS losses,
    SUM(CASE WHEN outcome = 'NEUTRAL' THEN 1 ELSE 0 END) AS neutrals,
    SUM(CASE WHEN outcome IS NULL     THEN 1 ELSE 0 END) AS pending
  FROM agent_decisions
  GROUP BY agent_name, signal
  ORDER BY agent_name, signal
`);

// ── Write ─────────────────────────────────────────────────────────────────────

/**
 * Persist a signal decision.
 *
 * entry: { id, timestamp, ticker, agentName, signal, confidence,
 *          reasoning: string[], marketPrice?, marketCategory? }
 *
 * Returns true if the row was inserted (new), false if duplicate (idempotent).
 * Never throws — errors are logged and return false.
 */
export function saveDecision(entry) {
  try {
    const info = _insert.run(
      entry.id,
      entry.timestamp,
      entry.ticker,
      entry.agentName,
      entry.signal,
      entry.confidence,
      JSON.stringify(Array.isArray(entry.reasoning) ? entry.reasoning : []),
      entry.marketPrice    ?? null,
      entry.marketCategory ?? null,
    );
    return info.changes > 0;
  } catch (err) {
    console.error('[decision-ledger] saveDecision error:', err.message);
    return false;
  }
}

// ── Resolve ───────────────────────────────────────────────────────────────────

/**
 * Mark a decision as resolved after its linked trade closes.
 *
 * outcome: 'WIN' | 'LOSS' | 'NEUTRAL'
 *
 * Only writes if outcome is currently NULL — idempotent on repeated calls.
 * Returns true if updated, false if already resolved or ID not found.
 */
export function resolveDecision(id, outcome) {
  try {
    const info = _resolve.run(outcome, Date.now(), id);
    return info.changes > 0;
  } catch (err) {
    console.error('[decision-ledger] resolveDecision error:', err.message);
    return false;
  }
}

// ── Query ─────────────────────────────────────────────────────────────────────

/**
 * Most recent decisions, newest first. Hard cap at 200.
 */
export function getRecentDecisions(limit = 50) {
  return _recent.all(Math.min(limit, 200));
}

/**
 * Aggregated win/loss stats per agent × signal type.
 */
export function getDecisionStats() {
  return _stats.all();
}
