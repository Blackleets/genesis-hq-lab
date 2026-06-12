// learningEngine — the core of Genesis HQ's intelligence.
// For every closed trade, answers:
//   1. Why did we fail?
//   2. What signal was wrong?
//   3. What should change?
//   4. What new rule should be created?
//
// This is what makes agents improve. Without this, memory is just storage.

import db, { tx } from '../db/database.mjs';
import { nanoid } from '../utils.mjs';

const CLAUDE_API = 'https://api.anthropic.com/v1/messages';

// ─── Call Claude Haiku ───────────────────────────────────────────────────────

async function ask(systemPrompt, userPrompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const res = await fetch(CLAUDE_API, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
    signal: AbortSignal.timeout(25000),
  });

  if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.content?.[0]?.text ?? '';
}

function parseJSON(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

function deterministicLesson(trade, evidence = []) {
  const won = (trade.pnl ?? 0) > 0;
  const isFutures = String(trade.trade_type ?? '').startsWith('crypto_futures_');
  const exitReason = trade.exit_reason ?? 'unknown_exit';
  const pair = trade.asset_pair ?? trade.market_question ?? 'unknown_market';
  const side = trade.outcome ?? 'UNKNOWN';
  const confidence = trade.confidence ?? 0;

  if (won) {
    return {
      lesson_text: `${pair} ${side} worked when the setup reached ${exitReason}; keep the same profile but only under matching market structure.`,
      why_failed: 'null',
      signal_wrong: 'null',
      what_change: 'null',
      new_rule: isFutures
        ? `Repeat ${pair} ${side} futures entries only when the same breakout/risk structure is present.`
        : `Repeat ${pair} ${side} only when the same signal stack is present.`,
      category: 'pattern',
      severity: 'info',
    };
  }

  const category = exitReason === 'stop_loss'
    ? 'timing'
    : exitReason === 'timeout'
      ? isFutures ? 'timing' : 'signal'
      : confidence >= 0.8
        ? 'confidence'
        : 'pattern';

  const signalWrong = evidence.find((item) => typeof item === 'string' && item.includes('REGIME'))
    ?? evidence.find((item) => typeof item === 'string')
    ?? exitReason;

  const whatChange = exitReason === 'stop_loss'
    ? 'Reduce aggression on this profile and require cleaner breakout structure before entry.'
    : exitReason === 'timeout'
      ? 'Treat this setup as weak follow-through and avoid holding the same pattern without expansion.'
      : 'Require stronger confirmation before reusing this setup.';

  return {
    lesson_text: `${pair} ${side} failed via ${exitReason}; this pattern needs stricter gating before the next entry.`,
    why_failed: `Closed with ${exitReason} after a losing ${isFutures ? 'futures' : 'trade'} entry.`,
    signal_wrong: signalWrong,
    what_change: whatChange,
    new_rule: isFutures
      ? `If ${pair} ${side} futures closes negative by ${exitReason}, tighten the profile until fresh winners repair the edge.`
      : `If the setup loses by ${exitReason}, demand stronger confirmation before re-entry.`,
    category,
    severity: exitReason === 'stop_loss' || (isFutures && exitReason === 'timeout') ? 'warning' : 'info',
  };
}

// ─── Analyze a closed trade and extract a lesson ─────────────────────────────

export async function analyzeClosedTrade(trade) {
  const won = (trade.pnl ?? 0) > 0;
  const evidence = typeof trade.evidence === 'string' ? JSON.parse(trade.evidence) : (trade.evidence ?? []);

  const systemPrompt = `You are the learning system for Genesis HQ, an autonomous AI trading company.
Your job is to extract SPECIFIC, ACTIONABLE lessons from closed trades.
Never write generic lessons. Every lesson must reference the specific conditions of this trade.
Only respond with valid JSON. No markdown, no explanation.`;

  const userPrompt = `CLOSED TRADE:
Market: "${trade.market_question ?? trade.marketQuestion}"
Category: ${trade.market_category ?? trade.marketCategory ?? 'unknown'}
We predicted: ${trade.outcome} @ ${((trade.entry_price ?? trade.entryPrice)*100).toFixed(1)}%
Actual outcome: ${trade.resolved_outcome ?? trade.resolvedOutcome ?? 'unknown'}
Result: ${won ? 'WIN' : 'LOSS'} | PnL: $${(trade.pnl ?? 0).toFixed(2)}
Capital risked: $${(trade.capital_used ?? trade.capitalUsed ?? 0).toFixed(2)}
Our confidence: ${((trade.confidence ?? 0)*100).toFixed(0)}%
Our reasoning: "${trade.reason}"
Evidence we used: ${evidence.join(', ')}

${won ? 'ANALYZE THIS WIN:' : 'ANALYZE THIS LOSS (mandatory):'}
${won
  ? 'What made this prediction correct? What pattern should we repeat?'
  : 'Why did we fail? What signal was misleading? What should we never do again?'
}

Respond with this exact JSON:
{
  "lesson_text": "One clear sentence about what was learned",
  "why_failed": "${won ? 'null' : 'Specific reason this prediction was wrong'}",
  "signal_wrong": "${won ? 'null' : 'Which signal or data point was misleading'}",
  "what_change": "${won ? 'null' : 'What to do differently next time'}",
  "new_rule": "One concrete actionable rule for future decisions",
  "category": "market_selection | timing | confidence | signal | position_size | pattern",
  "severity": "${won ? 'info' : 'warning'}"
}`;

  try {
    let parsed = null;
    if (process.env.ANTHROPIC_API_KEY) {
      const raw = await ask(systemPrompt, userPrompt);
      parsed = parseJSON(raw);
    } else {
      parsed = deterministicLesson(trade, evidence);
    }
    if (!parsed?.lesson_text) parsed = deterministicLesson(trade, evidence);
    if (!parsed?.lesson_text) return null;

    const id = `lesson-${nanoid()}`;
    const tradeId = trade.id;
    const agentId = trade.agent_id ?? trade.agentId ?? 'market-agent-1';

    tx(() => {
      db.prepare(`
        INSERT INTO lessons
          (id, trade_id, agent_id, source_type, why_failed, signal_wrong, what_change,
           new_rule, lesson_text, category, severity, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        id, tradeId, agentId,
        won ? 'trade_win' : 'trade_loss',
        parsed.why_failed === 'null' ? null : parsed.why_failed,
        parsed.signal_wrong === 'null' ? null : parsed.signal_wrong,
        parsed.what_change === 'null' ? null : parsed.what_change,
        parsed.new_rule,
        parsed.lesson_text,
        parsed.category,
        parsed.severity ?? (won ? 'info' : 'warning'),
      );

      // Link trade to lesson
      db.prepare('UPDATE trades SET lesson_id = ? WHERE id = ?').run(id, tradeId);

      // Index in FTS
      db.prepare(`
        INSERT INTO memory_fts(content, category, source_id, source_table)
        VALUES (?, ?, ?, 'lessons')
      `).run(
        `${parsed.lesson_text} ${parsed.why_failed ?? ''} ${parsed.new_rule}`,
        parsed.category,
        id
      );

      // If it's a loss, auto-create a mistake pattern to prevent repetition
      if (!won && parsed.severity !== 'info') {
        createMistakePattern(trade, parsed, id);
      }

      // Auto-promote to operating rule if critical
      if (parsed.severity === 'critical' || (!won && parsed.category === 'hard_constraint')) {
        db.prepare(`
          INSERT OR IGNORE INTO operating_rules
            (id, rule_text, rule_type, scope, priority, source, source_id, created_at)
          VALUES (?, ?, 'soft_preference', 'prediction_markets', 4, 'lesson', ?, datetime('now'))
        `).run(`rule-${nanoid()}`, parsed.new_rule, id);
      }
    });

    console.log(`[learningEngine] Lesson: ${parsed.lesson_text}`);
    return { id, ...parsed };
  } catch (err) {
    try {
      const parsed = deterministicLesson(trade, evidence);
      const id = `lesson-${nanoid()}`;
      const tradeId = trade.id;
      const agentId = trade.agent_id ?? trade.agentId ?? 'market-agent-1';
      tx(() => {
        db.prepare(`
          INSERT INTO lessons
            (id, trade_id, agent_id, source_type, why_failed, signal_wrong, what_change,
             new_rule, lesson_text, category, severity, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(
          id, tradeId, agentId,
          won ? 'trade_win' : 'trade_loss',
          parsed.why_failed === 'null' ? null : parsed.why_failed,
          parsed.signal_wrong === 'null' ? null : parsed.signal_wrong,
          parsed.what_change === 'null' ? null : parsed.what_change,
          parsed.new_rule,
          parsed.lesson_text,
          parsed.category,
          parsed.severity ?? (won ? 'info' : 'warning'),
        );
        db.prepare('UPDATE trades SET lesson_id = ? WHERE id = ?').run(id, tradeId);
      });
      console.warn('[learningEngine] Claude unavailable, used deterministic lesson fallback');
      return { id, ...parsed, fallback: true };
    } catch {
      console.error('[learningEngine] analyzeClosedTrade error:', err.message);
      return null;
    }
  }
}

// ─── Create a mistake pattern from a loss ────────────────────────────────────

function createMistakePattern(trade, lesson, lessonId) {
  const category = trade.market_category ?? trade.marketCategory ?? 'general';
  const price = trade.entry_price ?? trade.entryPrice ?? 0.5;
  // Create a price range bucket (±0.1)
  const conditions = {
    category,
    min_price: Math.max(0, price - 0.1),
    max_price: Math.min(1, price + 0.1),
    signal_description: lesson.signal_wrong ?? 'unknown',
  };

  const hash = `${category}_${conditions.min_price.toFixed(1)}_${conditions.max_price.toFixed(1)}`;

  // Only create if pattern doesn't already exist
  const existing = db.prepare('SELECT id FROM mistake_patterns WHERE pattern_hash = ?').get(hash);
  if (existing) {
    // Increment trigger count
    db.prepare('UPDATE mistake_patterns SET triggered_count = triggered_count + 1 WHERE pattern_hash = ?').run(hash);
    return;
  }

  db.prepare(`
    INSERT OR IGNORE INTO mistake_patterns
      (id, pattern_hash, pattern_desc, category, conditions, lesson_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    `mp-${nanoid()}`,
    hash,
    `${category} market at ${(price*100).toFixed(0)}% range — previously lost: ${lesson.signal_wrong ?? 'unknown signal'}`,
    category,
    JSON.stringify(conditions),
    lessonId,
  );

  console.log(`[learningEngine] Mistake pattern registered: ${hash}`);
}

// ─── Retrieve relevant context for a decision ────────────────────────────────
// This is the KEY function — called BEFORE every trade decision

export function getDecisionContext(category, priceMin, priceMax) {
  // Atomic SELECT + UPDATE so times_retrieved stays consistent under concurrent writes
  const lessons = tx(() => {
    const results = db.prepare(`
      SELECT id, lesson_text, new_rule, category, severity,
             times_prevented_loss, times_retrieved
      FROM lessons
      WHERE deprecated = 0
        AND (category = ? OR category = 'all' OR ? = 'general')
      ORDER BY
        CASE severity WHEN 'critical' THEN 3 WHEN 'warning' THEN 2 WHEN 'info' THEN 1 ELSE 0 END DESC,
        times_prevented_loss DESC,
        times_retrieved DESC,
        created_at DESC
      LIMIT 8
    `).all(category, category);

    if (results.length > 0) {
      const placeholders = results.map(() => '?').join(', ');
      db.prepare(
        `UPDATE lessons SET times_retrieved = times_retrieved + 1 WHERE id IN (${placeholders})`
      ).run(...results.map(l => l.id));
    }
    return results;
  });

  // Active hard rules
  const rules = db.prepare(`
    SELECT rule_text, rule_type, priority
    FROM operating_rules
    WHERE active = 1
      AND (scope = 'prediction_markets' OR scope = 'all')
    ORDER BY priority ASC, rule_type = 'hard_constraint' DESC
    LIMIT 10
  `).all();

  // Active mistake patterns for this category+price range
  const patterns = db.prepare(`
    SELECT pattern_desc, conditions, triggered_count
    FROM mistake_patterns
    WHERE active = 1 AND category = ?
    ORDER BY triggered_count DESC
    LIMIT 5
  `).all(category);

  // Agent skill level
  const agent = db.prepare(`
    SELECT level, skill_market_selection, skill_timing, skill_signal_reading,
           skill_pattern_recog, calibration_score, total_trades, wins, losses
    FROM agent_profiles WHERE id = 'market-agent-1'
  `).get();

  return { lessons, rules, patterns, agent };
}

// ─── Full-text search across all memory ──────────────────────────────────────

export function searchMemory(query, limit = 10) {
  return db.prepare(`
    SELECT f.content, f.category, f.source_table, f.source_id,
           rank
    FROM memory_fts f
    WHERE memory_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `).all(query, limit);
}

// ─── Save founder instruction as a lesson ────────────────────────────────────

export function saveFounderFeedback(instruction, context = '') {
  const id = `lesson-founder-${nanoid()}`;
  tx(() => {
    db.prepare(`
      INSERT INTO lessons
        (id, trade_id, agent_id, source_type, lesson_text, new_rule, category, severity, validated, created_at)
      VALUES (?, NULL, 'ceo-agent', 'founder', ?, ?, 'strategy', 'critical', 1, datetime('now'))
    `).run(id, `Founder instruction: ${instruction}`, instruction);

    db.prepare(`
      INSERT OR IGNORE INTO operating_rules
        (id, rule_text, rule_type, scope, priority, source, source_id, created_at)
      VALUES (?, ?, 'hard_constraint', 'all', 1, 'founder', ?, datetime('now'))
    `).run(`rule-founder-${nanoid()}`, instruction, id);
  });
  return id;
}
