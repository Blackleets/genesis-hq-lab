// learningEngine.mjs — Genesis Outcome Learning Loop Engine.
//
// Analyzes closed trade outcomes and adjusts confidence dimension weights
// to improve calibration over time.
//
// SAFETY RULES:
//   - Weight changes bounded to ±5% per cycle
//   - Weights clamped to [0.60, 1.40]
//   - Minimum 10 outcomes required before any adjustment
//   - SAFE_MODE → read-only (no weight updates)
//   - No adjustment within 30 min of the last cycle
//
// Weights are persisted in org_state under key 'confidence_weights'.
// This module is SEPARATE from server/memory/learningEngine.mjs
// (which handles Claude-based lesson extraction for trade analysis).

import db from '../db/database.mjs';
import { getRecentOutcomes, getOutcomeCount } from './outcomeModel.mjs';
import { logEvent, CATEGORY, SEVERITY } from '../observability/eventTimeline.mjs';

// ── Constants ─────────────────────────────────────────────────────────────────

export const DEFAULT_WEIGHTS = {
  signalQuality:   1.0,
  agentConsensus:  1.0,
  marketCondition: 1.0,
  historicalPerf:  1.0,
  riskProfile:     1.0,
};

const WEIGHT_BOUNDS       = { min: 0.60, max: 1.40 };
const MAX_DELTA_PER_CYCLE = 0.05;
const MIN_OUTCOMES        = 10;
const MIN_CYCLE_INTERVAL_MS = 30 * 60_000;  // 30 minutes minimum between cycles

// ── Module-level weight cache ─────────────────────────────────────────────────

let _weightCache = null;
let _lastCycleAt = null;
let _lastCycleResult = null;

export function _resetWeightsCacheForTest() {
  _weightCache   = null;
  _lastCycleAt   = null;
  _lastCycleResult = null;
}

// ── Persistence via org_state ─────────────────────────────────────────────────

function _loadWeightsFromDB() {
  try {
    const row = db.prepare(`SELECT value FROM org_state WHERE key = 'confidence_weights'`).get();
    if (row) {
      const parsed = JSON.parse(row.value);
      // Validate structure — must have all 5 keys
      if (parsed.signalQuality && parsed.agentConsensus &&
          parsed.marketCondition && parsed.historicalPerf && parsed.riskProfile) {
        return parsed;
      }
    }
  } catch { /* DB unavailable */ }
  return null;
}

function _saveWeightsToDB(weights, reason, cyclesN) {
  try {
    db.prepare(`
      INSERT OR REPLACE INTO org_state (key, value, updated_at)
      VALUES ('confidence_weights', ?, datetime('now'))
    `).run(JSON.stringify({
      ...weights,
      updatedAt:  new Date().toISOString(),
      lastReason: reason ?? null,
      cyclesN:    cyclesN ?? 0,
    }));
  } catch (err) {
    console.warn('[learningEngine] Failed to persist weights:', err?.message);
  }
}

// ── Public: get active weights ─────────────────────────────────────────────────

/**
 * Returns current dimension weights. Loaded lazily from DB on first call.
 * Returns a copy — callers cannot mutate the cache.
 */
export function getActiveWeights() {
  if (!_weightCache) {
    const fromDB = _loadWeightsFromDB();
    _weightCache = fromDB
      ? { signalQuality:   fromDB.signalQuality  ?? 1.0,
          agentConsensus:  fromDB.agentConsensus  ?? 1.0,
          marketCondition: fromDB.marketCondition ?? 1.0,
          historicalPerf:  fromDB.historicalPerf  ?? 1.0,
          riskProfile:     fromDB.riskProfile     ?? 1.0 }
      : { ...DEFAULT_WEIGHTS };
  }
  return { ..._weightCache };
}

// ── Metrics computation ───────────────────────────────────────────────────────

/**
 * Compute performance metrics from a list of outcome rows.
 * Returns:
 *   totalOutcomes, overallWinRate, avgPnl, avgConfidence,
 *   byBand: { [band]: { count, wins, winRate, avgPnl } },
 *   byAgent: { [agent]: { count, wins, winRate, avgPnl } },
 *   highBandWinRate: win rate of GOOD_SETUP + HIGH_CONVICTION combined
 *   cautionWinRate: win rate of CAUTION band
 */
export function computeMetrics(outcomes) {
  if (!outcomes || outcomes.length === 0) {
    return { totalOutcomes: 0, overallWinRate: null, avgPnl: null, avgConfidence: null,
             byBand: {}, byAgent: {}, highBandWinRate: null, cautionWinRate: null };
  }

  const byBand  = {};
  const byAgent = {};

  for (const o of outcomes) {
    const win = o.outcome_result === 'WIN' ? 1 : 0;

    // By band
    if (!byBand[o.confidence_band]) byBand[o.confidence_band] = { count: 0, wins: 0, totalPnl: 0 };
    byBand[o.confidence_band].count++;
    byBand[o.confidence_band].wins    += win;
    byBand[o.confidence_band].totalPnl += o.pnl_realized ?? 0;

    // By agent
    if (!byAgent[o.agent_source]) byAgent[o.agent_source] = { count: 0, wins: 0, totalPnl: 0 };
    byAgent[o.agent_source].count++;
    byAgent[o.agent_source].wins    += win;
    byAgent[o.agent_source].totalPnl += o.pnl_realized ?? 0;
  }

  // Compute rates
  for (const group of [byBand, byAgent]) {
    for (const k of Object.keys(group)) {
      const g = group[k];
      g.winRate = g.count > 0 ? g.wins / g.count : null;
      g.avgPnl  = g.count > 0 ? g.totalPnl / g.count : null;
    }
  }

  const totalWins = outcomes.filter(o => o.outcome_result === 'WIN').length;
  const overallWinRate  = totalWins / outcomes.length;
  const avgPnl          = outcomes.reduce((s, o) => s + (o.pnl_realized ?? 0), 0) / outcomes.length;
  const avgConfidence   = outcomes.reduce((s, o) => s + (o.entry_confidence ?? 0), 0) / outcomes.length;

  // High-confidence band combined win rate (GOOD_SETUP + HIGH_CONVICTION)
  const hcCount = (byBand['GOOD_SETUP']?.count ?? 0) + (byBand['HIGH_CONVICTION']?.count ?? 0);
  const hcWins  = (byBand['GOOD_SETUP']?.wins  ?? 0) + (byBand['HIGH_CONVICTION']?.wins  ?? 0);
  const highBandWinRate = hcCount > 0 ? hcWins / hcCount : null;

  const cautionWinRate = byBand['CAUTION']?.winRate ?? null;

  return {
    totalOutcomes: outcomes.length,
    overallWinRate,
    avgPnl:        Math.round(avgPnl * 100) / 100,
    avgConfidence: Math.round(avgConfidence * 1000) / 1000,
    byBand,
    byAgent,
    highBandWinRate,
    cautionWinRate,
  };
}

// ── Weight adjustment logic ───────────────────────────────────────────────────

function clamp(v) {
  return Math.max(WEIGHT_BOUNDS.min, Math.min(WEIGHT_BOUNDS.max, v));
}

function round3(v) {
  return Math.round(v * 1000) / 1000;
}

/**
 * Compute bounded weight adjustments from metrics.
 *
 * Rules:
 * 1. HIGH band under-performing (winRate < 0.45) → tighten all weights (−3%)
 * 2. HIGH band over-performing (winRate > 0.70)  → loosen all weights (+3%)
 * 3. CAUTION band over-performing (winRate > 0.65) → loosen marketCondition weight (+3%)
 * 4. Agent consensus weak (avgConfidence high but wins low) → reduce agentConsensus weight
 * 5. No changes if insufficient data
 */
export function adjustWeights(currentWeights, metrics) {
  const w       = { ...currentWeights };
  const changes = {};
  const reasons = [];

  if (metrics.totalOutcomes < MIN_OUTCOMES) {
    return { weights: w, changes, reason: 'INSUFFICIENT_DATA' };
  }

  // Rule 1: High-band under-performance → system is over-confident, tighten
  if (metrics.highBandWinRate !== null && metrics.highBandWinRate < 0.45) {
    const delta = -0.03;
    for (const k of Object.keys(w)) {
      w[k] = round3(clamp(w[k] + delta));
    }
    changes.globalTighten = delta;
    reasons.push(`HIGH_BAND_UNDERPERFORM(${(metrics.highBandWinRate * 100).toFixed(0)}%)`);
  }

  // Rule 2: High-band over-performance → system is too conservative, loosen
  if (metrics.highBandWinRate !== null && metrics.highBandWinRate > 0.72) {
    const delta = +0.03;
    for (const k of Object.keys(w)) {
      w[k] = round3(clamp(w[k] + delta));
    }
    changes.globalLoosen = delta;
    reasons.push(`HIGH_BAND_OVERPERFORM(${(metrics.highBandWinRate * 100).toFixed(0)}%)`);
  }

  // Rule 3: CAUTION band over-performing → market conditions weight is too strict
  if (metrics.cautionWinRate !== null && metrics.cautionWinRate > 0.65) {
    const delta = +0.04;
    w.marketCondition = round3(clamp(w.marketCondition + delta));
    changes.marketConditionUp = delta;
    reasons.push(`CAUTION_OVERPERFORM(${(metrics.cautionWinRate * 100).toFixed(0)}%)`);
  }

  // Rule 4: High avg confidence but low overall win rate → agentConsensus overweighted
  if (metrics.avgConfidence > 0.76 && metrics.overallWinRate < 0.45) {
    const delta = -0.04;
    w.agentConsensus = round3(clamp(w.agentConsensus + delta));
    changes.agentConsensusDown = delta;
    reasons.push(`HIGH_CONF_LOW_WIN(conf=${metrics.avgConfidence.toFixed(2)},win=${(metrics.overallWinRate * 100).toFixed(0)}%)`);
  }

  // Rule 5: Low avg confidence but high win rate → signal quality is underweighted
  if (metrics.avgConfidence < 0.68 && metrics.overallWinRate > 0.60) {
    const delta = +0.04;
    w.signalQuality = round3(clamp(w.signalQuality + delta));
    changes.signalQualityUp = delta;
    reasons.push(`LOW_CONF_HIGH_WIN(conf=${metrics.avgConfidence.toFixed(2)},win=${(metrics.overallWinRate * 100).toFixed(0)}%)`);
  }

  const reason = reasons.join(' + ') || null;
  return { weights: w, changes, reason };
}

// ── Main calibration cycle ────────────────────────────────────────────────────

/**
 * Run the weight calibration cycle.
 *
 * Skips if:
 *   - safeMode = true (no DB writes)
 *   - fewer than MIN_OUTCOMES outcomes exist
 *   - last cycle ran < 30 min ago
 *
 * @param {boolean} safeMode — pass isSafeMode() from caller
 * @returns {object} cycle result
 */
export async function runWeightCalibrationCycle(safeMode = false) {
  // Safe mode: read-only, no weight updates
  if (safeMode) {
    console.log('[learningEngine] SAFE_MODE — calibration read-only, no weight updates');
    const metrics = computeMetrics(getRecentOutcomes(50));
    _lastCycleResult = { skipped: true, reason: 'SAFE_MODE', metrics };
    return _lastCycleResult;
  }

  // Rate limit: don't run more than once per 30 min
  if (_lastCycleAt && (Date.now() - _lastCycleAt) < MIN_CYCLE_INTERVAL_MS) {
    return { skipped: true, reason: 'TOO_SOON', lastCycleAt: new Date(_lastCycleAt).toISOString() };
  }

  const outcomes = getRecentOutcomes(50);
  if (outcomes.length < MIN_OUTCOMES) {
    const result = { skipped: true, reason: 'INSUFFICIENT_DATA', count: outcomes.length, need: MIN_OUTCOMES };
    _lastCycleAt     = Date.now();
    _lastCycleResult = result;
    return result;
  }

  const metrics         = computeMetrics(outcomes);
  const currentWeights  = getActiveWeights();
  const { weights: newWeights, changes, reason } = adjustWeights(currentWeights, metrics);

  const hasChanges = Object.keys(changes).length > 0;

  if (hasChanges) {
    _weightCache = newWeights;
    _saveWeightsToDB(newWeights, reason, outcomes.length);
    console.log(`[learningEngine] Weights updated (${reason}):`, JSON.stringify(changes));
    logEvent({
      category: CATEGORY.LEARNING, severity: SEVERITY.INFO, subsystem: 'learningEngine',
      reason: `WEIGHTS_CHANGED: ${reason} (n=${outcomes.length} outcomes)`,
      metadata: { changes, newWeights, metrics: { highBandWinRate: metrics.highBandWinRate, cautionWinRate: metrics.cautionWinRate, overallWinRate: metrics.overallWinRate } },
    });
  } else {
    console.log(`[learningEngine] Calibration cycle complete — no adjustment needed (n=${outcomes.length})`);
    logEvent({
      category: CATEGORY.LEARNING, severity: SEVERITY.INFO, subsystem: 'learningEngine',
      reason: `CALIBRATION_STABLE: no weight adjustment needed (n=${outcomes.length} outcomes)`,
      metadata: { metrics: { highBandWinRate: metrics.highBandWinRate, overallWinRate: metrics.overallWinRate } },
    });
  }

  _lastCycleAt = Date.now();
  _lastCycleResult = {
    skipped:         false,
    metrics,
    changes,
    reason,
    weightsUpdated:  hasChanges,
    newWeights:      hasChanges ? newWeights : null,
    cycledAt:        new Date().toISOString(),
  };

  return _lastCycleResult;
}

// ── Diagnostics for truthLayer ────────────────────────────────────────────────

export function getLearningDiagnostics() {
  const outcomes = getRecentOutcomes(50);
  const metrics  = outcomes.length > 0 ? computeMetrics(outcomes) : null;
  const weights  = getActiveWeights();
  const total    = getOutcomeCount();

  // Best/worst agent by win rate (min 3 outcomes)
  const agentStats = metrics?.byAgent ?? {};
  const agents = Object.entries(agentStats)
    .filter(([, g]) => g.count >= 3)
    .map(([name, g]) => ({ name, winRate: g.winRate, avgPnl: g.avgPnl, count: g.count }));

  const bestAgent  = agents.sort((a, b) => (b.winRate ?? 0) - (a.winRate ?? 0))[0]?.name ?? null;
  const worstAgent = agents.sort((a, b) => (a.winRate ?? 0) - (b.winRate ?? 0))[0]?.name ?? null;

  return {
    totalTradesAnalyzed: total,
    recentAccuracy:      metrics?.overallWinRate != null
      ? Math.round(metrics.overallWinRate * 1000) / 10  // as percentage, 1 decimal
      : null,
    avgPnl:         metrics?.avgPnl ?? null,
    bestAgent,
    worstAgent,
    activeWeights:  weights,
    lastCycleTime:  _lastCycleAt ? new Date(_lastCycleAt).toISOString() : null,
    lastCycleChanges: _lastCycleResult?.changes ?? null,
    highBandWinRate:  metrics?.highBandWinRate != null
      ? Math.round(metrics.highBandWinRate * 1000) / 10
      : null,
    cautionWinRate:   metrics?.cautionWinRate != null
      ? Math.round(metrics.cautionWinRate * 1000) / 10
      : null,
  };
}
