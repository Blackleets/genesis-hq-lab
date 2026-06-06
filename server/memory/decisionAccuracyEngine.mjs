// decisionAccuracyEngine.mjs — deterministic accuracy tracking for agent signals.
//
// When a market resolves, each agent decision for that ticker is compared
// against the actual YES/NO outcome. Results are persisted and accuracy metrics
// are recalculated from the ground-truth agent_decisions table.
//
// Signal → outcome mapping (explicit, no AI):
//   BUY  + YES → WIN   (agent called upside, market confirmed)
//   BUY  + NO  → LOSS  (agent called upside, market rejected)
//   SELL + YES → LOSS  (agent flagged the market, but YES won)
//   SELL + NO  → WIN   (agent flagged the market, NO confirmed)
//
// Metrics (all deterministic):
//   accuracy_score = correct_predictions / total_predictions
//   avg_confidence = mean stated confidence of all resolved signals
//   brier_score    = mean((confidence − actual)²)
//                    0.25 = random, 0.0 = perfect calibration
//
// The performance row is always recomputed from the full decision history —
// never incremented — so no counter drift is possible after any sequence of
// crashes, replays, or duplicate calls.

import db from '../db/database.mjs';
import { resolveDecision } from './decisionLedger.mjs';

// ── Signal → outcome mapping ──────────────────────────────────────────────────
//
// Exported for testing and documentation.

export const OUTCOME_MAP = Object.freeze({
  'BUY:YES':  'WIN',
  'BUY:NO':   'LOSS',
  'SELL:YES': 'LOSS',
  'SELL:NO':  'WIN',
});

export function signalResult(signal, resolvedOutcome) {
  const key = `${signal?.toUpperCase()}:${resolvedOutcome?.toUpperCase()}`;
  return OUTCOME_MAP[key] ?? 'NEUTRAL';
}

// ── Prepared statements ───────────────────────────────────────────────────────

const _getUnresolved = db.prepare(`
  SELECT id, agent_name, signal, confidence
  FROM   agent_decisions
  WHERE  ticker = ? AND outcome IS NULL
`);

// Full recomputation from ground truth — called after every resolution.
// Brier score: (confidence − actual)²  where actual = 1 for WIN, 0 for LOSS.
const _calcStats = db.prepare(`
  SELECT
    COUNT(*)                                                      AS total,
    SUM(CASE WHEN outcome = 'WIN'  THEN 1 ELSE 0 END)            AS correct,
    ROUND(AVG(confidence),          4)                            AS avg_confidence,
    ROUND(AVG(
      CASE WHEN outcome = 'WIN'
        THEN (confidence - 1.0) * (confidence - 1.0)
        ELSE  confidence        *  confidence
      END
    ), 4)                                                         AS brier_score
  FROM agent_decisions
  WHERE agent_name = ? AND outcome IN ('WIN', 'LOSS')
`);

const _upsert = db.prepare(`
  INSERT INTO agent_performance
    (agent_name, total_predictions, correct_predictions,
     accuracy_score, avg_confidence, brier_score, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(agent_name) DO UPDATE SET
    total_predictions   = excluded.total_predictions,
    correct_predictions = excluded.correct_predictions,
    accuracy_score      = excluded.accuracy_score,
    avg_confidence      = excluded.avg_confidence,
    brier_score         = excluded.brier_score,
    updated_at          = excluded.updated_at
`);

const _getAll = db.prepare(`
  SELECT * FROM agent_performance ORDER BY accuracy_score DESC
`);

// ── Core API ──────────────────────────────────────────────────────────────────

/**
 * Resolve all open decisions for a ticker and refresh performance metrics.
 *
 * Called from the learning cycle the moment a trade closes.
 *
 * ticker          — must match agent_decisions.ticker
 * resolvedOutcome — 'YES' or 'NO'  (case-insensitive)
 *
 * Returns { processed: number, agents: string[] }
 */
export function processMarketResolution(ticker, resolvedOutcome) {
  const outcome = resolvedOutcome?.toUpperCase();

  if (outcome !== 'YES' && outcome !== 'NO') {
    console.warn(`[accuracy] unrecognised outcome "${resolvedOutcome}" for ${ticker} — skipping`);
    return { processed: 0, agents: [] };
  }

  const decisions = _getUnresolved.all(ticker);
  if (decisions.length === 0) return { processed: 0, agents: [] };

  const affected = new Set();

  for (const d of decisions) {
    const result = signalResult(d.signal, outcome);
    if (resolveDecision(d.id, result)) {
      affected.add(d.agent_name);
      console.log(`[accuracy] ${d.agent_name} ${d.signal} on ${ticker} → ${result}`);
    }
  }

  for (const agentName of affected) {
    refreshAgentPerformance(agentName);
  }

  return { processed: decisions.length, agents: [...affected] };
}

/**
 * Recalculate and persist accuracy metrics for one agent.
 *
 * Reads agent_decisions (ground truth), writes agent_performance.
 * Always a full recalculation — idempotent and crash-safe.
 * No-op when the agent has no resolved decisions yet.
 */
export function refreshAgentPerformance(agentName) {
  const s = _calcStats.get(agentName);
  if (!s || s.total === 0) return;

  const correct  = s.correct ?? 0;
  const total    = s.total;
  const accuracy = Math.round((correct / total) * 10_000) / 10_000;

  _upsert.run(
    agentName,
    total,
    correct,
    accuracy,
    s.avg_confidence ?? 0,
    s.brier_score    ?? 0.25,
    Date.now(),
  );

  console.log(
    `[accuracy] ${agentName}  ` +
    `${correct}/${total} correct  ` +
    `accuracy=${(accuracy * 100).toFixed(1)}%  ` +
    `brier=${(s.brier_score ?? 0.25).toFixed(3)}`
  );
}

/**
 * All agent performance rows, best accuracy first.
 */
export function getAgentPerformance() {
  return _getAll.all();
}
