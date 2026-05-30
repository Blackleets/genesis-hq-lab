// signalExtractor — turns raw headlines into scored signals. NO AI required.
// Uses keyword + sentiment heuristics to gauge directional momentum.
// Stores signals in the SQLite `signals` table for later accuracy tracking.

import db, { tx } from '../db/database.mjs';
import { nanoid } from '../utils.mjs';

// Sentiment lexicons (lightweight — no NLP dependency)
const BULLISH = ['surge', 'soar', 'win', 'wins', 'rally', 'gain', 'gains', 'rise', 'rises', 'jump',
  'boost', 'record', 'breakthrough', 'approve', 'approved', 'lead', 'leads', 'favorite', 'strong',
  'beat', 'beats', 'up', 'high', 'bullish', 'momentum', 'advance'];

const BEARISH = ['plunge', 'crash', 'lose', 'loses', 'loss', 'fall', 'falls', 'drop', 'decline',
  'slump', 'fail', 'fails', 'reject', 'rejected', 'weak', 'miss', 'misses', 'down', 'low',
  'bearish', 'collapse', 'concern', 'risk', 'warning', 'doubt', 'investigation', 'arrest'];

/**
 * Score a list of headlines into a single directional signal.
 * @returns { sentiment, strength, sample } | null
 */
export function scoreHeadlines(headlines) {
  if (!headlines || headlines.length === 0) return null;

  let bull = 0;
  let bear = 0;
  let freshness = 0;

  for (const h of headlines) {
    const text = (h.title ?? '').toLowerCase();
    const words = text.split(/\W+/);
    for (const w of words) {
      if (BULLISH.includes(w)) bull++;
      if (BEARISH.includes(w)) bear++;
    }
    // Recency weight: news < 6h old counts more
    if (h.ageHours != null && h.ageHours <= 6) freshness++;
    // Engagement weight (HN points / Reddit score)
    if ((h.points ?? h.score ?? 0) > 20) { bull += 0.5; }
  }

  const total = bull + bear;
  if (total === 0) {
    return { sentiment: 'neutral', strength: 0.3, bull, bear, freshness, count: headlines.length };
  }

  const sentiment = bull > bear ? 'bullish' : bear > bull ? 'bearish' : 'neutral';
  // Strength: how lopsided + how fresh + how much volume
  const lopsided = Math.abs(bull - bear) / total;
  const volumeBoost = Math.min(0.2, headlines.length / 50);
  const freshBoost  = Math.min(0.2, freshness / 10);
  const strength = Math.min(0.95, 0.4 + lopsided * 0.4 + volumeBoost + freshBoost);

  return { sentiment, strength: Math.round(strength * 100) / 100, bull, bear, freshness, count: headlines.length };
}

/** Persist a signal to the database. */
export function saveSignal({ source, text, category, confidence }) {
  const id = `sig-${nanoid()}`;
  tx(() => {
    db.prepare(`
      INSERT INTO signals (id, source, signal_text, category, confidence, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(id, source, text, category, confidence);
  });
  return id;
}

/** Get recent signals for a category (used in decision context). */
export function getRecentSignals(category, limit = 5) {
  return db.prepare(`
    SELECT id, source, signal_text, category, confidence, created_at
    FROM signals
    WHERE (category = ? OR category = 'general')
      AND created_at > datetime('now', '-2 days')
    ORDER BY created_at DESC, confidence DESC
    LIMIT ?
  `).all(category, limit);
}

/** Mark whether a signal proved correct (called when linked trade closes). */
export function markSignalOutcome(signalId, correct) {
  db.prepare(`UPDATE signals SET proved_correct = ? WHERE id = ?`).run(correct ? 1 : 0, signalId);
}

/** Aggregate signal accuracy for reporting. */
export function getSignalAccuracy() {
  const row = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN proved_correct = 1 THEN 1 ELSE 0 END) AS correct
    FROM signals WHERE proved_correct IS NOT NULL
  `).get();
  return {
    total:   row?.total ?? 0,
    correct: row?.correct ?? 0,
    rate:    row?.total > 0 ? row.correct / row.total : null,
  };
}
