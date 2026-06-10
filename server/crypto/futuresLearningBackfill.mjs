import db from '../db/database.mjs';
import { analyzeClosedTrade } from '../memory/learningEngine.mjs';
import { createOutcomeRecord, saveOutcome } from '../learning/outcomeModel.mjs';
import { nanoid } from '../utils.mjs';

const FUTURES_TYPES_SQL = `('crypto_futures_breakout_short_micro','crypto_futures_breakout_short','crypto_futures_breakout_short_alt','crypto_futures_breakout_long')`;

export async function backfillMissingFuturesLessons(limit = 6) {
  const rows = db.prepare(`
    SELECT *
    FROM trades
    WHERE status = 'closed'
      AND trade_type IN ${FUTURES_TYPES_SQL}
      AND lesson_id IS NULL
    ORDER BY closed_at DESC
    LIMIT ?
  `).all(Math.max(1, Math.min(limit, 20)));

  let generated = 0;
  for (const trade of rows) {
    try {
      const lesson = await analyzeClosedTrade(trade);
      if (lesson?.id) generated++;
    } catch {
      // Best-effort only. Never break the desk snapshot on lesson backfill.
    }
  }

  return {
    scanned: rows.length,
    generated,
  };
}

export function backfillMissingFuturesOutcomes(limit = 12) {
  const rows = db.prepare(`
    SELECT t.*
    FROM trades t
    LEFT JOIN trade_outcomes o ON o.trade_id = t.id
    WHERE t.status = 'closed'
      AND t.trade_type IN ${FUTURES_TYPES_SQL}
      AND o.trade_id IS NULL
    ORDER BY t.closed_at DESC
    LIMIT ?
  `).all(Math.max(1, Math.min(limit, 50)));

  let generated = 0;
  for (const trade of rows) {
    try {
      saveOutcome(createOutcomeRecord(trade));
      generated++;
    } catch {
      // Best-effort only. Never break the desk snapshot on outcome backfill.
    }
  }

  return {
    scanned: rows.length,
    generated,
  };
}

export function promoteFuturesTimeoutLossLessons(limit = 12) {
  const rows = db.prepare(`
    SELECT
      t.id AS trade_id,
      t.asset_pair,
      t.market_category,
      t.entry_price,
      t.exit_reason,
      l.id AS lesson_id,
      l.category,
      l.severity,
      l.signal_wrong
    FROM trades t
    JOIN lessons l ON l.trade_id = t.id
    WHERE t.status = 'closed'
      AND t.trade_type IN ${FUTURES_TYPES_SQL}
      AND COALESCE(t.pnl, 0) < 0
      AND t.exit_reason = 'timeout'
      AND l.severity = 'info'
    ORDER BY t.closed_at DESC
    LIMIT ?
  `).all(Math.max(1, Math.min(limit, 20)));

  let promoted = 0;
  let patternsCreated = 0;

  for (const row of rows) {
    db.prepare(`
      UPDATE lessons
      SET severity = 'warning', category = 'timing'
      WHERE id = ?
    `).run(row.lesson_id);
    promoted++;

    const price = Number(row.entry_price ?? 0);
    const category = row.market_category ?? 'crypto';
    const minPrice = Math.max(0, price - 0.1);
    const maxPrice = Math.min(price + 0.1, price + 0.1);
    const hash = `${category}_${minPrice.toFixed(1)}_${maxPrice.toFixed(1)}`;
    const existing = db.prepare(`SELECT id FROM mistake_patterns WHERE pattern_hash = ?`).get(hash);
    if (!existing) {
      db.prepare(`
        INSERT OR IGNORE INTO mistake_patterns
          (id, pattern_hash, pattern_desc, category, conditions, lesson_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        `mp-${nanoid()}`,
        hash,
        `${row.asset_pair ?? 'unknown_pair'} timeout loss - breakout follow-through failed before target.`,
        category,
        JSON.stringify({
          category,
          min_price: minPrice,
          max_price: maxPrice,
          signal_description: row.signal_wrong ?? 'timeout_loss',
          exit_reason: row.exit_reason,
          pair: row.asset_pair ?? null,
        }),
        row.lesson_id,
      );
      patternsCreated++;
    }
  }

  return {
    scanned: rows.length,
    promoted,
    patternsCreated,
  };
}
