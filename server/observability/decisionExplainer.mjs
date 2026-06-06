// decisionExplainer.mjs — per-trade decision explanation generator.
//
// Answers two questions for every trade:
//   WHY did Genesis trade?
//   WHY did Genesis NOT trade?
//
// Reads from: trades, team_memory, trade_outcomes (existing tables, read-only).
// No network calls, no Claude — purely from stored evidence.

import db from '../db/database.mjs';

// ── Executed trade explanation ────────────────────────────────────────────────

/**
 * Build a full explanation for an executed (or closed) trade.
 * Returns null if the trade is not found.
 *
 * @param {string} tradeId
 * @returns {object|null}
 */
export function buildDecisionExplanation(tradeId) {
  const trade = db.prepare(`SELECT * FROM trades WHERE id = ?`).get(tradeId);
  if (!trade) return null;

  // Load the debate record from team_memory (best match by market_id)
  const debate = db.prepare(`
    SELECT * FROM team_memory
    WHERE topic LIKE ? OR topic LIKE ?
    ORDER BY created_at DESC LIMIT 1
  `).get(`%${trade.market_id}%`, `%${(trade.market_question ?? '').slice(0, 30)}%`);

  // Load outcome if trade is closed
  const outcome = db.prepare(
    `SELECT * FROM trade_outcomes WHERE trade_id = ?`
  ).get(tradeId);

  // Parse stored arrays
  const evidence       = tryParseArr(trade.evidence);
  const lessonsApplied = tryParseArr(trade.lessons_applied);

  // Split evidence into positive / negative signals heuristically
  const positiveSignals = evidence.filter(e => !isNegativeSignal(e));
  const negativeSignals = evidence.filter(e => isNegativeSignal(e));

  const confidence     = trade.confidence ?? 0;
  const confidenceBand = approximateBand(confidence);

  // Risk score — stored in evidence as "Risk score: N/100"
  const riskLine  = evidence.find(e => e.startsWith('Risk score:'));
  const riskScore = riskLine ? parseInt(riskLine.replace('Risk score:', '').trim(), 10) : null;

  // Kelly fraction — stored in evidence as "Kelly fraction: N%"
  const kellyLine     = evidence.find(e => e.startsWith('Kelly fraction:'));
  const kellyFraction = kellyLine ? kellyLine.replace('Kelly fraction:', '').trim() : null;

  const learningImpact = lessonsApplied.length > 0
    ? `${lessonsApplied.length} lesson(s) consulted during decision`
    : 'No prior lessons applied to this trade';

  const finalReason = debate?.decision_made
    ?? debate?.summary
    ?? trade.reason
    ?? 'No debate record found';

  return {
    tradeId,
    marketId:        trade.market_id,
    marketQuestion:  trade.market_question,
    marketSource:    trade.market_source,
    outcome:         trade.outcome,
    status:          trade.status,
    // Confidence
    confidenceScore: Math.round(confidence * 100),
    confidenceBand,
    // Signals
    positiveSignals,
    negativeSignals,
    blockedReasons:  [],
    // Risk
    riskScore,
    kellyFraction,
    // Learning
    learningImpact,
    lessonsCount:    lessonsApplied.length,
    // Debate
    arbiterVerdict: debate?.summary ?? null,
    finalReason,
    // Result
    pnl:             trade.pnl ?? null,
    openedAt:        trade.opened_at,
    closedAt:        trade.closed_at ?? null,
    resolvedOutcome: trade.resolved_outcome ?? null,
    outcomeResult:   outcome?.outcome_result ?? null,
    pnlPct:          outcome?.pnl_pct ?? null,
  };
}

// ── Blocked trade explanation ─────────────────────────────────────────────────

/**
 * Build an explanation for a trade that was BLOCKED before execution.
 * Call this immediately after the blocking step is determined.
 *
 * @param {object} opts
 * @param {object}  opts.market          — market object from scanner
 * @param {string}  opts.stepFailed      — 'veto' | 'debate' | 'confidence' | 'risk' | 'capital'
 * @param {object}  [opts.vetoResult]    — from checkVeto()
 * @param {object}  [opts.debateResult]  — from runDebate()
 * @param {object}  [opts.confidenceResult] — from computeConfidence()
 * @param {object}  [opts.riskCheck]     — from preTradeCheck()
 * @returns {object}
 */
export function buildBlockExplanation({
  market,
  stepFailed,
  vetoResult,
  debateResult,
  confidenceResult,
  riskCheck,
}) {
  const blockedReasons = [];

  if (stepFailed === 'veto' && vetoResult) {
    blockedReasons.push(`BLOCKED_VETO: ${vetoResult.summary ?? 'mistake pattern matched'}`);
  }
  if (stepFailed === 'debate') {
    const reason = debateResult?.skipReason ?? 'low conviction or insufficient edge';
    blockedReasons.push(`BLOCKED_DEBATE_SKIP: ${reason}`);
  }
  if (stepFailed === 'confidence' && confidenceResult) {
    const why = confidenceResult.noTradeReason ?? confidenceResult.band;
    blockedReasons.push(
      `BLOCKED_CONFIDENCE: ${confidenceResult.score}/100 (${confidenceResult.band}) — ${why}`
    );
    // Also surface the top negative signals from the explanation
    const negs = confidenceResult.explanation?.negatives ?? [];
    for (const n of negs.slice(0, 2)) blockedReasons.push(`  ↳ ${n}`);
  }
  if (stepFailed === 'risk' && riskCheck) {
    for (const err of (riskCheck.errors ?? [])) {
      blockedReasons.push(`BLOCKED_RISK: ${err}`);
    }
  }
  if (stepFailed === 'capital') {
    blockedReasons.push(`BLOCKED_CAPITAL: insufficient capital or reservation failed`);
  }

  const confidence     = debateResult?.confidence ?? 0;
  const confidenceBand = approximateBand(confidence);

  return {
    tradeId:        null,
    marketId:       market?.id ?? null,
    marketQuestion: market?.question ?? null,
    marketSource:   market?.source ?? null,
    outcome:        debateResult?.outcome ?? null,
    status:         'blocked',
    confidenceScore: Math.round(confidence * 100),
    confidenceBand,
    positiveSignals: debateResult?.bull?.evidence ?? [],
    negativeSignals: debateResult?.bear?.evidence ?? [],
    blockedReasons,
    riskScore:      riskCheck?.riskScore ?? null,
    kellyFraction:  null,
    learningImpact: 'N/A — trade blocked before execution',
    lessonsCount:   0,
    arbiterVerdict: debateResult?.arbiterSummary ?? null,
    finalReason:    blockedReasons[0] ?? 'Trade blocked before execution',
    pnl:            null,
    openedAt:       new Date().toISOString(),
    closedAt:       null,
    resolvedOutcome: null,
    outcomeResult:  null,
    pnlPct:         null,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function approximateBand(confidence) {
  if (confidence >= 0.82) return 'HIGH_CONVICTION';
  if (confidence >= 0.75) return 'GOOD_SETUP';
  if (confidence >= 0.65) return 'CAUTION';
  if (confidence >= 0.50) return 'LOW_CONFIDENCE';
  return 'BLOCK';
}

function isNegativeSignal(evidence) {
  const lower = evidence.toLowerCase();
  return lower.includes('risk') || lower.includes('warn') || lower.includes('low') ||
         lower.includes('kelly') || lower.includes('drawdown') || lower.includes('stale');
}

function tryParseArr(val) {
  if (Array.isArray(val)) return val;
  try { const p = JSON.parse(val); return Array.isArray(p) ? p : []; }
  catch { return []; }
}
