// tradeHistory.mjs — Trade story data for the chart storytelling overlay.
// Returns full per-trade fields already persisted in the trades table. Read-only.

import db from '../db/database.mjs';

// exit_reason → a coarse "kind" used by the client to pick marker color/text.
export function exitKind(exitReason) {
  switch (exitReason) {
    case 'take_profit':         return 'TP';
    case 'stop_loss':           return 'SL';
    case 'timeout':             return 'TIMEOUT';
    case 'confidence_collapse': return 'CONFIDENCE';
    case null:
    case undefined:             return null;
    default:                    return 'EXIT';
  }
}

function parseEvidence(raw) {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * Recent crypto trade stories, newest first.
 * @param {object} [opts]
 * @param {number} [opts.limit=40]
 * @param {string} [opts.pair]  — optional asset_pair filter (e.g. 'BTCUSDT')
 */
export function getTradeStories({ limit = 40, pair = null } = {}) {
  let sql = `
    SELECT id, asset_pair, outcome, entry_price, exit_price, target_price, stop_price,
           pnl, confidence, reason, evidence, exit_reason, opened_at, closed_at, status
    FROM trades
    WHERE trade_type IN ('crypto_scalp','scalp_v2','swing_v1')`;
  const args = [];
  if (pair) { sql += ` AND asset_pair = ?`; args.push(pair); }
  sql += ` ORDER BY COALESCE(closed_at, opened_at) DESC LIMIT ?`;
  args.push(Math.min(120, Math.max(1, limit)));

  let rows = [];
  try {
    rows = db.prepare(sql).all(...args);
  } catch {
    return [];
  }

  return rows.map(r => ({
    id:           r.id,
    pair:         r.asset_pair ?? '',
    side:         r.outcome === 'SHORT' ? 'SHORT' : 'LONG',
    entry_price:  r.entry_price,
    exit_price:   r.exit_price ?? null,
    target_price: r.target_price ?? null,
    stop_price:   r.stop_price ?? null,
    pnl:          r.pnl ?? null,
    confidence:   r.confidence ?? 0,
    reason:       r.reason ?? '',
    evidence:     parseEvidence(r.evidence),
    exit_reason:  r.exit_reason ?? null,
    exit_kind:    exitKind(r.exit_reason),
    opened_at:    r.opened_at,
    closed_at:    r.closed_at ?? null,
    status:       r.status ?? 'open',
  }));
}
