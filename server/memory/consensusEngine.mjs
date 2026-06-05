// consensusEngine.mjs — multi-agent consensus for Genesis HQ.
//
// Pipeline position: after Decision Ledger and Accuracy Engine.
//
//   market_update
//     → MarketAnalystAgent   emits signal_generated
//     → Decision Ledger      persists individual decision
//     → AccuracyEngine       tracks per-agent accuracy
//     → ConsensusEngine      aggregates signals → consensus_decision
//
// Core logic (deterministic, no LLM):
//
//   1. VETO SCAN — any BLOCK signal with confidence ≥ vetoThreshold
//      immediately returns HOLD, regardless of all other votes.
//
//   2. WEIGHTED SCORING — each signal contributes:
//        contribution = confidence × weight
//      where weight = agent accuracy_score from agent_performance table
//      (defaults to 0.50 for agents with < minSamples history).
//
//      Bucket mapping:
//        BUY     → buy_score
//        SELL    → sell_score
//        WARNING → sell_score  (partial negative signal)
//        HOLD    → hold_score
//        BLOCK   → handled by veto scan above
//
//   3. DECISION — winner is the bucket with the highest weighted total.
//      Ties always resolve to HOLD (conservative).
//      If max score < minConviction → HOLD (insufficient collective conviction).
//
// Stateful layer:
//   addSignal(ticker, agentName, signal, confidence)  — buffer per ticker
//   resolveConsensus(ticker)                          — compute + persist + clear buffer
//   getPendingSignals(ticker)                         — inspect buffer (tests / debug)
//   clearPending([ticker])                            — test isolation helper
//
// Query layer:
//   getRecentConsensus(limit)      — recent decisions ordered by timestamp DESC
//   getConsensusForTicker(ticker)  — history for a specific ticker

import db from '../db/database.mjs';

// ── Configuration ─────────────────────────────────────────────────────────────

const C = {
  vetoThreshold: 0.80,     // BLOCK at or above this triggers full veto
  minConviction: 0.30,     // winning weighted total must exceed this to avoid HOLD
  defaultWeight: 0.50,     // weight for agents with no reliable accuracy history
  minSamples:    5,        // minimum predictions before accuracy_score is trusted as weight
  windowMs:      15 * 60_000,   // 15-min window bucket for idempotent consensus IDs
};

export const CONSENSUS_DEFAULTS = Object.freeze({ ...C });

// Maps signal name → scoring bucket.  BLOCK is not in the map — handled by veto.
const SIGNAL_BUCKET = Object.freeze({
  BUY:     'buy',
  SELL:    'sell',
  WARNING: 'sell',
  HOLD:    'hold',
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function _r4(n) { return Math.round(n * 10_000) / 10_000; }

function _breakdownEntry(s, agentWeights) {
  const weight       = agentWeights[s.agentName] ?? C.defaultWeight;
  const contribution = _r4(s.confidence * weight);
  return { agentName: s.agentName, signal: s.signal, confidence: s.confidence, weight, contribution };
}

// ── Prepared statements (compiled once at module load) ────────────────────────

const _getWeights = db.prepare(`
  SELECT agent_name, accuracy_score, total_predictions
  FROM   agent_performance
`);

const _save = db.prepare(`
  INSERT OR REPLACE INTO consensus_decisions
    (id, ticker, timestamp, decision, buy_score, sell_score, hold_score,
     vetoed, veto_by, signal_count, breakdown_json, explanation)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const _getRecent = db.prepare(`
  SELECT * FROM consensus_decisions ORDER BY timestamp DESC LIMIT ?
`);

const _getByTicker = db.prepare(`
  SELECT * FROM consensus_decisions WHERE ticker = ? ORDER BY timestamp DESC LIMIT ?
`);

// ── Core (pure) — exported for unit testing ───────────────────────────────────

/**
 * Compute consensus from a list of agent signals and their accuracy weights.
 *
 * signals:      Array of { agentName, signal, confidence }
 * agentWeights: Map of agentName → accuracy_score (0.0–1.0)
 *
 * Returns:
 *   { decision, buyScore, sellScore, holdScore,
 *     vetoed, vetoBy, signalCount, breakdown, explanation }
 */
export function computeConsensus(signals, agentWeights = {}) {
  if (!Array.isArray(signals) || signals.length === 0) {
    return {
      decision: 'HOLD', buyScore: 0, sellScore: 0, holdScore: 0,
      vetoed: false, vetoBy: null, signalCount: 0, breakdown: [],
      explanation: 'No signals provided.',
    };
  }

  // ── Phase 1: Veto scan ────────────────────────────────────────────────────
  // First BLOCK signal at or above the threshold wins immediately.
  for (const s of signals) {
    if (s.signal === 'BLOCK' && s.confidence >= C.vetoThreshold) {
      const weight = agentWeights[s.agentName] ?? C.defaultWeight;
      return {
        decision:    'HOLD',
        buyScore:    0,
        sellScore:   0,
        holdScore:   0,
        vetoed:      true,
        vetoBy:      s.agentName,
        signalCount: signals.length,
        breakdown:   signals.map(sig => _breakdownEntry(sig, agentWeights)),
        explanation: `VETOED by ${s.agentName} — BLOCK @ ${(s.confidence * 100).toFixed(0)}% conf (weight ${weight.toFixed(2)})`,
      };
    }
  }

  // ── Phase 2: Weighted scoring ─────────────────────────────────────────────
  let buyScore = 0, sellScore = 0, holdScore = 0;
  const breakdown = [];

  for (const s of signals) {
    const weight       = agentWeights[s.agentName] ?? C.defaultWeight;
    const contribution = _r4(s.confidence * weight);
    const bucket       = SIGNAL_BUCKET[s.signal] ?? 'hold';

    if      (bucket === 'buy')  buyScore  += contribution;
    else if (bucket === 'sell') sellScore += contribution;
    else                        holdScore += contribution;

    breakdown.push({ agentName: s.agentName, signal: s.signal, confidence: s.confidence, weight, contribution });
  }

  buyScore  = _r4(buyScore);
  sellScore = _r4(sellScore);
  holdScore = _r4(holdScore);

  const maxScore = Math.max(buyScore, sellScore, holdScore);

  // ── Phase 3: Decision ─────────────────────────────────────────────────────
  let decision, explanation;

  if (maxScore < C.minConviction) {
    decision    = 'HOLD';
    explanation = `Insufficient conviction: max=${maxScore.toFixed(4)} < threshold=${C.minConviction}`;
  } else if (buyScore > sellScore && buyScore > holdScore) {
    decision    = 'BUY';
    explanation = `BUY leads — buy=${buyScore.toFixed(4)} sell=${sellScore.toFixed(4)} hold=${holdScore.toFixed(4)}`;
  } else if (sellScore > buyScore && sellScore > holdScore) {
    decision    = 'SELL';
    explanation = `SELL leads — sell=${sellScore.toFixed(4)} buy=${buyScore.toFixed(4)} hold=${holdScore.toFixed(4)}`;
  } else {
    // Tie on any combination → conservative HOLD
    decision    = 'HOLD';
    explanation = `HOLD (tie or HOLD leads) — buy=${buyScore.toFixed(4)} sell=${sellScore.toFixed(4)} hold=${holdScore.toFixed(4)}`;
  }

  return {
    decision, buyScore, sellScore, holdScore,
    vetoed: false, vetoBy: null,
    signalCount: signals.length, breakdown, explanation,
  };
}

// ── Stateful layer ────────────────────────────────────────────────────────────

// Per-ticker pending signal buffer.  Each entry: { agentName, signal, confidence, ts }
// One entry per agent per ticker — a later addSignal for the same agent replaces the earlier.
const _pending = new Map();

/**
 * Buffer a signal from one agent for the given ticker.
 * If the same agent already has a pending signal for the same ticker, it is replaced.
 */
export function addSignal(ticker, agentName, signal, confidence) {
  if (!ticker || !agentName || !signal) return;
  if (!_pending.has(ticker)) _pending.set(ticker, []);

  const list  = _pending.get(ticker);
  const norm  = String(signal).toUpperCase();
  const entry = { agentName, signal: norm, confidence, ts: Date.now() };
  const idx   = list.findIndex(s => s.agentName === agentName);

  if (idx >= 0) list[idx] = entry;   // replace existing signal from this agent
  else          list.push(entry);
}

/**
 * Compute consensus from the pending buffer for the given ticker.
 * Loads live agent weights from agent_performance, persists the result, clears the buffer.
 *
 * Returns the full consensus result object plus { id, ticker }.
 * If the buffer is empty, returns a HOLD with signalCount=0.
 */
export function resolveConsensus(ticker) {
  const rawSignals = _pending.get(ticker) ?? [];

  // Build weight map — only trust agents with enough history
  const weights = {};
  for (const row of _getWeights.all()) {
    if (row.total_predictions >= C.minSamples) {
      weights[row.agent_name] = row.accuracy_score;
    }
  }

  const result = computeConsensus(rawSignals, weights);

  // Idempotent ID: same ticker+window → same row, INSERT OR REPLACE updates it
  const id = `${ticker}:${Math.floor(Date.now() / C.windowMs)}`;

  _save.run(
    id, ticker, Date.now(),
    result.decision,
    result.buyScore, result.sellScore, result.holdScore,
    result.vetoed ? 1 : 0, result.vetoBy ?? null,
    result.signalCount,
    JSON.stringify(result.breakdown),
    result.explanation,
  );

  _pending.delete(ticker);

  console.log(
    `[consensus] ${ticker} → ${result.decision}` +
    ` (${result.signalCount} signal${result.signalCount !== 1 ? 's' : ''})` +
    (result.vetoed ? ` VETOED by ${result.vetoBy}` : '') +
    `  buy=${result.buyScore.toFixed(3)} sell=${result.sellScore.toFixed(3)} hold=${result.holdScore.toFixed(3)}`
  );

  return { ...result, id, ticker };
}

/** Inspect pending signals for a ticker — useful for debugging and tests. */
export function getPendingSignals(ticker) {
  return [...(_pending.get(ticker) ?? [])];
}

/** Remove pending signals.  Pass a ticker to clear one, omit to clear all. */
export function clearPending(ticker) {
  if (ticker !== undefined) _pending.delete(ticker);
  else _pending.clear();
}

// ── Query layer ───────────────────────────────────────────────────────────────

/** Most recent consensus decisions, newest first. */
export function getRecentConsensus(limit = 20) {
  return _getRecent.all(Math.min(limit, 200));
}

/** Consensus history for a specific ticker, newest first. */
export function getConsensusForTicker(ticker, limit = 10) {
  return _getByTicker.all(ticker, Math.min(limit, 50));
}
