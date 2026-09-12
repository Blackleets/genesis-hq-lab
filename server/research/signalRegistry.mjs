// signalRegistry.mjs — Central registry for trading signals from research
// Aggregates signals from multiple sources: market data, ML models, manual research

import db, { tx } from '../db/database.mjs';
import { nanoid } from '../utils.mjs';

// Signal sources
export const SIGNAL_SOURCES = {
  market_data: 'market_data',      // volume, price action, technicals
  sentiment: 'sentiment',           // news, social media
  model_prediction: 'model_prediction', // ML predictions
  manual_research: 'manual_research',   // human research
  event_alpha: 'event_alpha',       // scheduled events
};

/**
 * Register a new signal for use in trading decisions
 * Called by research modules, market analyzers, and manual entry
 */
export function registerSignal(source, signalText, category, confidence, metadata = {}) {
  if (!SIGNAL_SOURCES.hasOwnProperty(source)) {
    throw new Error(`unknown signal source: ${source}`);
  }

  if (confidence < 0 || confidence > 1) {
    throw new Error(`confidence must be 0-1, got ${confidence}`);
  }

  const id = `signal-${nanoid()}`;
  const now = new Date().toISOString();

  try {
    tx(() => {
      // Insert into signals table
      db.prepare(`
        INSERT INTO signals (id, source, signal_text, category, confidence, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, source, signalText, category, confidence, now);

      // Index in FTS for search
      db.prepare(`
        INSERT INTO memory_fts (content, category, source_id, source_table)
        VALUES (?, ?, ?, 'signals')
      `).run(signalText, category, id);

      console.log(`[signal] registered: ${category} from ${source} (conf=${(confidence*100).toFixed(0)}%)`);
    });

    return { id, source, confidence, category };
  } catch (err) {
    console.error('[signal] Failed to register:', err.message);
    throw err;
  }
}

/**
 * Get active signals (unresolved) in a category
 */
export function getActiveSignals(category = null, limit = 20) {
  let query = `
    SELECT * FROM signals
    WHERE proved_correct IS NULL
  `;
  const params = [];

  if (category) {
    query += ` AND category = ?`;
    params.push(category);
  }

  query += ` ORDER BY created_at DESC LIMIT ?`;
  params.push(limit);

  return db.prepare(query).all(...params);
}

/**
 * Mark a signal as correct or incorrect (after market resolves)
 */
export function resolveSignal(signalId, proved, tradeId = null) {
  try {
    tx(() => {
      db.prepare(`
        UPDATE signals
        SET proved_correct = ?, trade_id = ?
        WHERE id = ?
      `).run(proved ? 1 : 0, tradeId, signalId);

      if (proved) {
        console.log(`[signal] ✓ signal ${signalId} proved correct`);
      } else {
        console.log(`[signal] ✗ signal ${signalId} proved incorrect`);
      }
    });
  } catch (err) {
    console.error('[signal] Failed to resolve:', err.message);
  }
}

/**
 * Get signal accuracy by source
 */
export function getSignalAccuracy(source = null) {
  let query = `
    SELECT
      source,
      COUNT(*) as total,
      SUM(CASE WHEN proved_correct = 1 THEN 1 ELSE 0 END) as correct,
      ROUND(100.0 * SUM(CASE WHEN proved_correct = 1 THEN 1 ELSE 0 END) / COUNT(*), 1) as accuracy_pct
    FROM signals
    WHERE proved_correct IS NOT NULL
  `;

  if (source) {
    query += ` AND source = ?`;
  }

  query += ` GROUP BY source ORDER BY accuracy_pct DESC`;

  const params = source ? [source] : [];
  return db.prepare(query).all(...params);
}

/**
 * Get top confidence signals that proved correct
 */
export function getValidatedSignals(limit = 10) {
  return db.prepare(`
    SELECT * FROM signals
    WHERE proved_correct = 1
    ORDER BY confidence DESC, created_at DESC
    LIMIT ?
  `).all(limit);
}
