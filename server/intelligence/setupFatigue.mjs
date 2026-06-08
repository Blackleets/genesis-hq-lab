// setupFatigue.mjs — Phase 6B.1B: Adaptive Survival Intelligence (DB layer)
//
// DB-backed wrapper around setupFatigueCore.mjs. Adds cache + live queries.
// ADDITIVE ONLY — never touches risk engine, safe mode, caps, Kelly sizing,
// paper execution, TP/SL, or any execution path.
//
// If this module throws, callers receive NEUTRAL state and trading continues.

import db from '../db/database.mjs';
import {
  computeSetupFatigue, applyFatigueToConfidence,
  getHealthBand, getBandModifiers,
} from './setupFatigueCore.mjs';

export {
  wrScore, pfScore, evScore, calibrationScore,
  getHealthScore, getHealthBand, getBandModifiers,
  applyHumilityPenalty, computeSetupFatigue,
  applyFatigueToConfidence, regimeFromEvidence,
} from './setupFatigueCore.mjs';

const WINDOW_DAYS = parseInt(process.env.FATIGUE_WINDOW_DAYS ?? '7',  10);
const MIN_SAMPLES = parseInt(process.env.FATIGUE_MIN_SAMPLES ?? '5',  10);
const CACHE_MS    = 30_000;

let _cache = { at: 0, states: new Map(), all: [] };

function refreshCache() {
  const now = Date.now();
  if (now - _cache.at < CACHE_MS && _cache.at) return _cache;
  let rows = [];
  try {
    rows = db.prepare(`
      SELECT outcome AS side, asset_pair AS pair, pnl, confidence, evidence
      FROM trades
      WHERE trade_type IN ('crypto_scalp','scalp_v2','swing_v1')
        AND status = 'closed' AND pnl IS NOT NULL
        AND closed_at > datetime('now', ?)
      ORDER BY closed_at DESC
    `).all(`-${WINDOW_DAYS} days`);
  } catch { return _cache; }

  const all    = computeSetupFatigue(rows);
  const states = new Map(all.map(s => [s.key, s]));
  _cache = { at: now, states, all };
  return _cache;
}

const NEUTRAL_STATE = {
  healthScore: 50, band: 'NEUTRAL',
  confidenceMultiplier: 1.0, kellyMultiplier: 1.0,
  consecutiveLosses: 0, samples: 0,
};

/** Get the fatigue state for (pair, side, regime). NEUTRAL when insufficient data. */
export function getFatigueState(pair, side, regime) {
  try {
    const key   = `${pair ?? 'UNKNOWN'}_${side}_${regime}`;
    const state = refreshCache().states.get(key);
    if (!state || state.samples < MIN_SAMPLES) return { ...NEUTRAL_STATE, key, pair, side, regime };
    return state;
  } catch {
    return { ...NEUTRAL_STATE };
  }
}

/** All setup states for diagnostics. Safe — returns [] on error. */
export function getAllFatigueStates() {
  try { return refreshCache().all; } catch { return []; }
}

/** Operator-facing summary for /api/crypto/diagnostics. */
export function getFatigueIntelligenceSummary() {
  const all    = getAllFatigueStates();
  const mature = all.filter(s => s.samples >= MIN_SAMPLES);
  const sorted = [...mature].sort((a, b) => a.healthScore - b.healthScore);

  return {
    config: { windowDays: WINDOW_DAYS, minSamples: MIN_SAMPLES, cacheMs: CACHE_MS },
    totalSetups:        all.length,
    matureSetups:       mature.length,
    activeSuppression:  mature.filter(s => s.band === 'TOXIC' || s.band === 'WEAK').length,
    setups:             all,
    worst:              sorted.slice(0, 5),
    best:               [...sorted].reverse().slice(0, 5),
    bySeverity: {
      TOXIC:   mature.filter(s => s.band === 'TOXIC').length,
      WEAK:    mature.filter(s => s.band === 'WEAK').length,
      NEUTRAL: mature.filter(s => s.band === 'NEUTRAL').length,
      GOOD:    mature.filter(s => s.band === 'GOOD').length,
      STRONG:  mature.filter(s => s.band === 'STRONG').length,
    },
  };
}
