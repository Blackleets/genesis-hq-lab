// mistakePrevention — vetoes trades that match known failure patterns.
// This is where agents actually stop repeating mistakes.
// A veto is NOT a skip — it's a hard block with a logged reason.

import db, { tx } from '../db/database.mjs';

// ─── Check if a proposed trade should be vetoed ──────────────────────────────

export function checkVeto(proposal) {
  const { category, yesPrice, noPrice, volumeTotal, daysToClose } = proposal;
  const intendedPrice = proposal.outcome === 'YES' ? yesPrice : noPrice;

  const vetoes = [];

  // 1. Check mistake patterns in database
  const patterns = db.prepare(`
    SELECT id, pattern_desc, conditions, triggered_count, lesson_id
    FROM mistake_patterns
    WHERE active = 1 AND category = ?
  `).all(category ?? 'general');

  for (const pattern of patterns) {
    let conditions;
    try { conditions = JSON.parse(pattern.conditions); } catch { continue; }

    const priceMatch = intendedPrice >= conditions.min_price &&
                       intendedPrice <= conditions.max_price;

    if (priceMatch) {
      vetoes.push({
        type: 'mistake_pattern',
        reason: `Pattern match: ${pattern.pattern_desc}`,
        pattern_id: pattern.id,
        severity: 'warning',
      });
      // Increment pattern trigger count
      db.prepare('UPDATE mistake_patterns SET triggered_count = triggered_count + 1, last_triggered = datetime("now") WHERE id = ?')
        .run(pattern.id);
      // Credit the source lesson — this veto prevented a potential repeat mistake
      if (pattern.lesson_id) {
        db.prepare('UPDATE lessons SET times_prevented_loss = times_prevented_loss + 1 WHERE id = ?')
          .run(pattern.lesson_id);
      }
    }
  }

  // 2. Check hard operating rules (rule violations)
  const hardRules = db.prepare(`
    SELECT id, rule_text FROM operating_rules
    WHERE active = 1 AND rule_type = 'hard_constraint'
      AND (scope = 'prediction_markets' OR scope = 'all')
  `).all();

  // Rule: min liquidity
  if (volumeTotal < 5000) {
    const rule = hardRules.find(r => r.rule_text.toLowerCase().includes('liquidity'));
    vetoes.push({
      type: 'rule_violation',
      reason: `Low liquidity: $${volumeTotal} < $5000 minimum`,
      rule_id: rule?.id ?? 'rule-liquidity',
      severity: 'warning',
    });
  }

  // Rule: max horizon
  if (daysToClose > 45) {
    vetoes.push({
      type: 'rule_violation',
      reason: `Market closes in ${daysToClose} days — exceeds 45-day maximum`,
      rule_id: 'rule-horizon',
      severity: 'warning',
    });
  }

  // Rule: extreme prices (near-certain outcomes have no edge)
  if (intendedPrice > 0.92) {
    vetoes.push({
      type: 'rule_violation',
      reason: `Entry price ${(intendedPrice*100).toFixed(1)}% too high — near certainty means tiny upside`,
      rule_id: 'rule-confidence',
      severity: 'info',
    });
  }
  if (intendedPrice < 0.05) {
    vetoes.push({
      type: 'rule_violation',
      reason: `Entry price ${(intendedPrice*100).toFixed(1)}% too low — likely losing bet`,
      rule_id: 'rule-confidence',
      severity: 'info',
    });
  }

  // 3. Check if we already have an open trade on this exact market
  const existing = db.prepare(`
    SELECT id FROM trades WHERE market_id = ? AND status = 'open'
  `).get(proposal.marketId);

  if (existing) {
    vetoes.push({
      type: 'duplicate',
      reason: `Already have an open trade on this market (${existing.id})`,
      severity: 'critical',
    });
  }

  // 4. Check max open trades
  const openCount = db.prepare(`SELECT COUNT(*) AS cnt FROM trades WHERE status = 'open'`).get();
  if (openCount.cnt >= 5) {
    vetoes.push({
      type: 'limit',
      reason: `Max open trades reached (${openCount.cnt}/5) — wait for resolution`,
      severity: 'critical',
    });
  }

  // ── Decision ────────────────────────────────────────────────────────────────

  const criticals = vetoes.filter(v => v.severity === 'critical');
  const warnings  = vetoes.filter(v => v.severity === 'warning');

  return {
    vetoed:   criticals.length > 0,          // hard block
    flagged:  warnings.length > 0,            // soft warning (can proceed but noted)
    vetoes,
    summary:  vetoes.map(v => v.reason).join(' | ') || null,
  };
}

// ─── Log a vetoed decision ────────────────────────────────────────────────────

export function logVeto(proposal, vetoResult) {
  // Store as a "vetoed" trade so we can track false positives
  tx(() => {
    db.prepare(`
      INSERT OR IGNORE INTO trades
        (id, agent_id, market_id, market_source, market_question, market_category,
         outcome, entry_price, shares, capital_used, confidence, reason, evidence,
         status, opened_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, 'vetoed', datetime('now'))
    `).run(
      `veto-${Date.now()}`,
      proposal.agentId ?? 'market-agent-1',
      proposal.marketId ?? 'unknown',
      proposal.marketSource ?? 'polymarket',
      proposal.marketQuestion ?? 'unknown',
      proposal.marketCategory ?? 'general',
      proposal.outcome ?? 'YES',
      proposal.entryPrice ?? 0.5,
      proposal.confidence ?? 0,
      vetoResult.summary ?? 'Vetoed by mistake prevention',
      JSON.stringify(proposal.evidence ?? []),
    );
  });
}

// ─── Mark a pattern as false positive (human review) ────────────────────────

export function markFalsePositive(patternId) {
  db.prepare(`
    UPDATE mistake_patterns
    SET false_positive = false_positive + 1
    WHERE id = ?
  `).run(patternId);

  // If false positive rate > 70%, deactivate the pattern
  const pattern = db.prepare('SELECT * FROM mistake_patterns WHERE id = ?').get(patternId);
  if (pattern) {
    const total = pattern.triggered_count || 1;
    const fpRate = pattern.false_positive / total;
    if (fpRate > 0.7 && total >= 5) {
      db.prepare('UPDATE mistake_patterns SET active = 0 WHERE id = ?').run(patternId);
      console.log(`[mistakePrevention] Pattern ${patternId} deactivated (false positive rate: ${(fpRate*100).toFixed(0)}%)`);
    }
  }
}

// ─── Get veto statistics ─────────────────────────────────────────────────────

export function getVetoStats() {
  return {
    totalVetoed: db.prepare(`SELECT COUNT(*) AS cnt FROM trades WHERE status = 'vetoed'`).get()?.cnt ?? 0,
    activePatterns: db.prepare(`SELECT COUNT(*) AS cnt FROM mistake_patterns WHERE active = 1`).get()?.cnt ?? 0,
    topPatterns: db.prepare(`
      SELECT pattern_desc, triggered_count, false_positive
      FROM mistake_patterns WHERE active = 1
      ORDER BY triggered_count DESC LIMIT 5
    `).all(),
  };
}
