// tradingMemory — all operations on the trades table and related memory.
// This is where paper trades are born, live, and die.

import db, { tx } from '../db/database.mjs';
import { nanoid } from '../utils.mjs';

// ─── Save a new paper trade ───────────────────────────────────────────────────

export function saveTrade(trade) {
  const id = trade.id ?? `trade-${nanoid()}`;
  tx(() => {
    db.prepare(`
      INSERT OR REPLACE INTO trades
        (id, agent_id, market_id, market_source, market_question, market_category,
         outcome, entry_price, shares, capital_used, trade_type, confidence, reason, evidence,
         signals_used, lessons_applied, rules_applied, status, opened_at, days_to_close)
      VALUES
        (@id, @agent_id, @market_id, @market_source, @market_question, @market_category,
         @outcome, @entry_price, @shares, @capital_used, @trade_type, @confidence, @reason, @evidence,
         @signals_used, @lessons_applied, @rules_applied, 'open', @opened_at, @days_to_close)
    `).run({
      id,
      agent_id:        trade.agentId ?? 'market-agent-1',
      market_id:       trade.marketId,
      market_source:   trade.marketSource,
      market_question: trade.marketQuestion,
      market_category: trade.marketCategory ?? 'general',
      outcome:         trade.outcome,
      entry_price:     trade.entryPrice,
      shares:          trade.shares,
      capital_used:    trade.capitalUsed,
      trade_type:      trade.tradeType ?? 'swing',
      confidence:      trade.confidence,
      reason:          trade.reason,
      evidence:        JSON.stringify(trade.evidence ?? []),
      signals_used:    JSON.stringify(trade.signalsUsed ?? []),
      lessons_applied: JSON.stringify(trade.lessonsApplied ?? []),
      rules_applied:   JSON.stringify(trade.rulesApplied ?? []),
      opened_at:       trade.openedAt ?? new Date().toISOString(),
      days_to_close:   trade.daysToClose ?? null,
    });

    // Index in FTS
    db.prepare(`
      INSERT INTO memory_fts(content, category, source_id, source_table)
      VALUES (?, ?, ?, 'trades')
    `).run(`${trade.marketQuestion} ${trade.reason} ${trade.outcome}`, trade.marketCategory ?? 'general', id);
  });
  return id;
}

// ─── Close a trade (market resolved) ─────────────────────────────────────────

export function closeTrade(tradeId, resolvedOutcome) {
  const trade = db.prepare('SELECT * FROM trades WHERE id = ?').get(tradeId);
  if (!trade) return null;

  const won       = trade.outcome === resolvedOutcome;
  const exitPrice = won ? 1.0 : 0.0;
  const pnl       = (exitPrice - trade.entry_price) * trade.shares;
  const closedAt  = new Date().toISOString();

  tx(() => {
    db.prepare(`
      UPDATE trades
      SET status = 'closed', resolved_outcome = ?, exit_price = ?, pnl = ?, closed_at = ?
      WHERE id = ?
    `).run(resolvedOutcome, exitPrice, pnl, closedAt, tradeId);
  });

  return { ...trade, resolvedOutcome, exitPrice, pnl, closedAt };
}

// ─── Get open trades ──────────────────────────────────────────────────────────

export function getOpenTrades() {
  return db.prepare(`
    SELECT * FROM trades WHERE status = 'open' ORDER BY opened_at DESC
  `).all();
}

// ─── Get recent closed trades for analysis ────────────────────────────────────

export function getRecentTrades(limit = 20) {
  return db.prepare(`
    SELECT * FROM trades ORDER BY opened_at DESC LIMIT ?
  `).all(limit);
}

// ─── Get trades by category (for pattern detection) ──────────────────────────

export function getTradesByCategory(category, limit = 10) {
  return db.prepare(`
    SELECT * FROM trades
    WHERE market_category = ? AND status = 'closed'
    ORDER BY closed_at DESC LIMIT ?
  `).all(category, limit);
}

// ─── Win rate stats ───────────────────────────────────────────────────────────

export function getStats(agentId) {
  return db.prepare(`
    SELECT
      COUNT(*)                                           AS total,
      SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END)         AS wins,
      SUM(CASE WHEN pnl <= 0 THEN 1 ELSE 0 END)         AS losses,
      AVG(pnl)                                           AS avg_pnl,
      SUM(pnl)                                           AS total_pnl,
      AVG(confidence)                                    AS avg_confidence,
      AVG(CASE WHEN pnl > 0 THEN confidence ELSE NULL END) AS avg_win_confidence,
      AVG(CASE WHEN pnl <= 0 THEN confidence ELSE NULL END) AS avg_loss_confidence
    FROM trades
    WHERE agent_id = ? AND status = 'closed'
  `).get(agentId);
}

// ─── Find similar past trades (for context injection) ────────────────────────

export function findSimilarTrades(category, priceMin, priceMax, limit = 5) {
  return db.prepare(`
    SELECT id, market_question, outcome, entry_price, confidence, pnl, reason, evidence
    FROM trades
    WHERE market_category = ?
      AND entry_price BETWEEN ? AND ?
      AND status = 'closed'
    ORDER BY closed_at DESC
    LIMIT ?
  `).all(category, priceMin, priceMax, limit);
}

// ─── Calibration score update ─────────────────────────────────────────────────
// How accurate were the agent's stated confidence levels?

export function computeCalibration(agentId) {
  // Group closed trades by confidence bucket, check win rate per bucket
  const rows = db.prepare(`
    SELECT
      ROUND(confidence, 1) AS conf_bucket,
      COUNT(*) AS cnt,
      SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) AS wins
    FROM trades
    WHERE agent_id = ? AND status = 'closed'
    GROUP BY conf_bucket
  `).all(agentId);

  if (rows.length === 0) return 0.5;

  // Calibration = 1 - mean(|stated_confidence - actual_win_rate|) per bucket
  let totalError = 0;
  let totalTrades = 0;
  for (const row of rows) {
    const actualWinRate = row.wins / row.cnt;
    totalError += Math.abs(row.conf_bucket - actualWinRate) * row.cnt;
    totalTrades += row.cnt;
  }
  return totalTrades > 0 ? 1 - (totalError / totalTrades) : 0.5;
}
