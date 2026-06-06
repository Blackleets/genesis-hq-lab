// outcomeModel.mjs — canonical closed-loop trade outcome records.
//
// Append-only. Records are immutable after creation.
// One record per resolved trade — duplicates silently ignored (INSERT OR IGNORE).
//
// Schema: trade_outcomes (see schema.sql)

import db from '../db/database.mjs';

// ── Band approximation from arbiter confidence float ─────────────────────────
// When the trade was executed we didn't persist the composite score (0-100),
// only the arbiter float. This mapping reconstructs the approximate band.

export function approximateBand(confidence) {
  if (confidence >= 0.82) return 'HIGH_CONVICTION';
  if (confidence >= 0.75) return 'GOOD_SETUP';
  if (confidence >= 0.65) return 'CAUTION';
  if (confidence >= 0.50) return 'LOW_CONFIDENCE';
  return 'BLOCK';
}

// ── Outcome creation ──────────────────────────────────────────────────────────

/**
 * Build an outcome record from a closed trade row.
 * `closedTrade` is the object returned by closeTrade() — all snake_case columns.
 */
export function createOutcomeRecord(closedTrade) {
  const openedAt  = closedTrade.opened_at ? new Date(closedTrade.opened_at).getTime() : Date.now();
  const closedAt  = closedTrade.closed_at ? new Date(closedTrade.closed_at).getTime() : Date.now();
  const durationH = Math.max(0, (closedAt - openedAt) / 3_600_000);

  const pnl      = closedTrade.pnl ?? 0;
  const capital  = closedTrade.capital_used ?? 1;
  const pnlPct   = capital > 0 ? pnl / capital : 0;

  const outcomeResult =
    pnl >  0.01 ? 'WIN' :
    pnl < -0.01 ? 'LOSS' :
                  'NEUTRAL';

  const confidence = closedTrade.confidence ?? 0;
  const band       = approximateBand(confidence);

  return {
    id:              `outcome-${closedTrade.id}`,
    tradeId:         closedTrade.id,
    agentSource:     closedTrade.agent_id   ?? 'market-agent-1',
    marketSource:    closedTrade.market_source  ?? 'unknown',
    marketCategory:  closedTrade.market_category ?? 'general',
    recordedAt:      new Date().toISOString(),
    entryConfidence: confidence,
    confidenceBand:  band,
    pnlRealized:     pnl,
    pnlPct,
    durationHours:   Math.round(durationH * 10) / 10,
    outcomeResult,
    marketSnapshot:  JSON.stringify({
      source:      closedTrade.market_source,
      category:    closedTrade.market_category,
      entryPrice:  closedTrade.entry_price,
      outcome:     closedTrade.outcome,
    }),
  };
}

// ── Persistence ───────────────────────────────────────────────────────────────

export function saveOutcome(outcome) {
  db.prepare(`
    INSERT OR IGNORE INTO trade_outcomes
      (id, trade_id, agent_source, market_source, market_category,
       recorded_at, entry_confidence, confidence_band,
       pnl_realized, pnl_pct, duration_hours, outcome_result, market_snapshot)
    VALUES
      (@id, @tradeId, @agentSource, @marketSource, @marketCategory,
       @recordedAt, @entryConfidence, @confidenceBand,
       @pnlRealized, @pnlPct, @durationHours, @outcomeResult, @marketSnapshot)
  `).run(outcome);
}

// ── Queries ───────────────────────────────────────────────────────────────────

/** Most recent N outcomes, newest first. */
export function getRecentOutcomes(limit = 50) {
  return db.prepare(`
    SELECT * FROM trade_outcomes
    ORDER BY recorded_at DESC
    LIMIT ?
  `).all(limit);
}

/** Outcomes filtered by confidence band. */
export function getOutcomesByBand(band, limit = 30) {
  return db.prepare(`
    SELECT * FROM trade_outcomes
    WHERE confidence_band = ?
    ORDER BY recorded_at DESC
    LIMIT ?
  `).all(band, limit);
}

/** Outcomes filtered by agent. */
export function getOutcomesByAgent(agentSource, limit = 30) {
  return db.prepare(`
    SELECT * FROM trade_outcomes
    WHERE agent_source = ?
    ORDER BY recorded_at DESC
    LIMIT ?
  `).all(agentSource, limit);
}

/** Total recorded outcomes. */
export function getOutcomeCount() {
  return db.prepare(`SELECT COUNT(*) AS n FROM trade_outcomes`).get()?.n ?? 0;
}

/** Outcome count by result type. */
export function getOutcomeSummary() {
  return db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN outcome_result = 'WIN'  THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN outcome_result = 'LOSS' THEN 1 ELSE 0 END) AS losses,
      COALESCE(AVG(pnl_realized), 0) AS avg_pnl,
      COALESCE(AVG(entry_confidence), 0) AS avg_confidence
    FROM trade_outcomes
  `).get() ?? { total: 0, wins: 0, losses: 0, avg_pnl: 0, avg_confidence: 0 };
}
