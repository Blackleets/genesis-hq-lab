// globalRiskEngine.mjs — Genesis Global Risk Orchestrator.
//
// Aggregates risk signals from all subsystems into a single SYSTEM_RISK_SCORE (0-100).
//
// Dimension maxes (sum = 100):
//   Execution Risk     0-25
//   Financial Risk     0-30
//   Decision Risk      0-20
//   Infrastructure     0-15
//   Learning Risk      0-10
//
// Risk bands:
//   HEALTHY   0-24
//   WATCH    25-49
//   ELEVATED 50-69
//   HIGH_RISK 70-84
//   CRITICAL  85-100  → GLOBAL_SAFE_MODE activated
//
// FAIL-SAFE: if this engine throws, isGlobalSafeMode() returns true.
// Never allow trading when system risk is unknown.

import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import db from '../db/database.mjs';
import { getReconciliationStatus } from '../memory/reconciliationEngine.mjs';
import { getTreasury } from '../trading/treasury.mjs';
import { getConfidenceDiagnostics } from '../intelligence/confidenceEngine.mjs';
import { detectStalePositions, getPnLFreshness } from '../memory/pnlEngine.mjs';
import { getLearningDiagnostics } from '../learning/learningEngine.mjs';
import { logEvent, CATEGORY, SEVERITY } from '../observability/eventTimeline.mjs';

const __dir     = dirname(fileURLToPath(import.meta.url));
const LOGS_DIR  = join(__dir, '..', '..', 'logs');
const RISK_LOG  = join(LOGS_DIR, 'risk_events.log');
const HB_PATH   = join(__dir, '..', '..', 'data', 'memory', 'agent_heartbeat.json');

// ── Risk bands ────────────────────────────────────────────────────────────────

export const RISK_BANDS = {
  HEALTHY:   { min: 0,  max: 24  },
  WATCH:     { min: 25, max: 49  },
  ELEVATED:  { min: 50, max: 69  },
  HIGH_RISK: { min: 70, max: 84  },
  CRITICAL:  { min: 85, max: 100 },
};

const SAFE_MODE_THRESHOLD       = 85;
const SAFE_MODE_CLEAR_THRESHOLD = 79;  // hysteresis: won't clear until score drops below 80

// ── Module state ──────────────────────────────────────────────────────────────

let _score         = 0;
let _band          = 'HEALTHY';
let _safeMode      = false;
let _activeFlags   = [];
let _lastRefreshAt = null;
let _engineFailed  = false;
let _dimensions    = {};

export function _resetGlobalRiskForTest() {
  _score         = 0;
  _band          = 'HEALTHY';
  _safeMode      = false;
  _activeFlags   = [];
  _lastRefreshAt = null;
  _engineFailed  = false;
  _dimensions    = {};
}

// ── Event logging ─────────────────────────────────────────────────────────────

function logRiskEvent(event, data = {}) {
  try {
    if (!existsSync(LOGS_DIR)) mkdirSync(LOGS_DIR, { recursive: true });
    const entry = `\n[${new Date().toISOString()}] [RISK:${event}] ${JSON.stringify(data)}`;
    appendFileSync(RISK_LOG, entry, 'utf8');
  } catch { /* never throw in logger */ }
  console.log(`[globalRisk] ${event}`, Object.keys(data).length ? JSON.stringify(data) : '');
}

// ── Band classification ───────────────────────────────────────────────────────

function classifyBand(score) {
  for (const [name, band] of Object.entries(RISK_BANDS)) {
    if (score >= band.min && score <= band.max) return name;
  }
  return 'CRITICAL';
}

// ── Dimension 1: Execution Risk (0-25) ───────────────────────────────────────

export function scoreExecutionRisk() {
  let pts = 0;
  const flags = [];

  try {
    const recon = getReconciliationStatus();
    if (recon.status === 'degraded') {
      pts += 20;
      flags.push(`RECON_DEGRADED: ${(recon.issues ?? []).length} issue(s) unresolved`);
    } else if (recon.status === 'recovering') {
      pts += 8;
      flags.push(`RECON_RECOVERING: ${recon.orphanCount} orphan(s), $${(recon.unresolvedExposure ?? 0).toFixed(2)} exposure`);
    }
  } catch {
    pts += 10;
    flags.push('RECON_UNAVAILABLE: reconciliation status could not be read');
  }

  try {
    const stale = detectStalePositions(48);
    if (stale.length > 3) {
      pts += 8;
      flags.push(`STALE_POSITIONS: ${stale.length} positions open >48h`);
    } else if (stale.length > 0) {
      pts += 4;
      flags.push(`STALE_POSITIONS: ${stale.length} position(s) open >48h`);
    }
  } catch { /* safe — skip stale check */ }

  try {
    const freshness = getPnLFreshness();
    if (freshness.fresh === false) {
      pts += 3;
      flags.push('PNL_STALE: no trade settled in >24h');
    }
  } catch { /* safe */ }

  return { score: Math.min(pts, 25), flags };
}

// ── Dimension 2: Financial Risk (0-30) ───────────────────────────────────────

export function scoreFinancialRisk() {
  let pts = 0;
  const flags = [];

  try {
    const treasury = getTreasury();
    const dd = treasury.drawdownPct ?? 0;

    if (dd > 0.15) {
      pts += 25;
      flags.push(`DRAWDOWN_CRITICAL: ${(dd * 100).toFixed(1)}% from peak`);
    } else if (dd > 0.10) {
      pts += 18;
      flags.push(`DRAWDOWN_HIGH: ${(dd * 100).toFixed(1)}% from peak`);
    } else if (dd > 0.05) {
      pts += 10;
      flags.push(`DRAWDOWN_MODERATE: ${(dd * 100).toFixed(1)}% from peak`);
    } else if (dd > 0.02) {
      pts += 5;
    }

    // Exposure concentration — open trades near limit
    const openCount = db.prepare(`SELECT COUNT(*) AS n FROM trades WHERE status = 'open'`).get()?.n ?? 0;
    if (openCount >= 5) {
      pts += 5;
      flags.push('MAX_EXPOSURE: open trade limit reached (5/5)');
    } else if (openCount >= 4) {
      pts += 2;
    }
  } catch (err) {
    pts += 10;
    flags.push(`TREASURY_UNAVAILABLE: ${err?.message}`);
  }

  return { score: Math.min(pts, 30), flags };
}

// ── Dimension 3: Decision Risk (0-20) ────────────────────────────────────────

export function scoreDecisionRisk() {
  let pts = 0;
  const flags = [];

  try {
    const diag = getConfidenceDiagnostics();

    if (diag.samplesInWindow < 3) {
      // Insufficient data — neutral, system just started
      return { score: 0, flags };
    }

    const avg = diag.averageScore ?? 50;
    if (avg < 30) {
      pts += 15;
      flags.push(`LOW_CONFIDENCE_AVG: avg score ${avg.toFixed(0)}/100`);
    } else if (avg < 50) {
      pts += 8;
      flags.push(`BELOW_AVG_CONFIDENCE: avg score ${avg.toFixed(0)}/100`);
    }

    // No-trade frequency
    const total = diag.samplesInWindow;
    const blocked = diag.blockedTrades ?? 0;
    const noTradeRate = total > 0 ? blocked / total : 0;
    if (noTradeRate > 0.80) {
      pts += 5;
      flags.push(`HIGH_NO_TRADE_RATE: ${(noTradeRate * 100).toFixed(0)}% blocked`);
    } else if (noTradeRate > 0.60) {
      pts += 2;
    }
  } catch {
    // Confidence engine not yet initialized — neutral
  }

  return { score: Math.min(pts, 20), flags };
}

// ── Dimension 4: Infrastructure Risk (0-15) ──────────────────────────────────

export function scoreInfrastructureRisk() {
  let pts = 0;
  const flags = [];

  // DB health
  try {
    const tableCount = db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'`).get()?.n ?? 0;
    if (tableCount < 5) {
      pts += 10;
      flags.push(`DB_INCOMPLETE: only ${tableCount} tables — schema may be corrupt`);
    }
  } catch (err) {
    pts += 15;
    flags.push(`DB_FAILED: ${err?.message}`);
    return { score: Math.min(pts, 15), flags };
  }

  // Agent runner liveness (heartbeat file)
  try {
    if (existsSync(HB_PATH)) {
      const hb = JSON.parse(readFileSync(HB_PATH, 'utf8'));
      const msSince = Date.now() - new Date(hb.lastTickAt).getTime();
      if (msSince > 10 * 60_000) {
        pts += 10;
        flags.push(`AGENT_STALLED: last tick ${Math.round(msSince / 60000)} min ago`);
      }
    }
    // If heartbeat file doesn't exist: agent never started — minor flag
  } catch {
    pts += 3;
    flags.push('AGENT_HEARTBEAT_UNREADABLE');
  }

  return { score: Math.min(pts, 15), flags };
}

// ── Dimension 5: Learning Risk (0-10) ────────────────────────────────────────

export function scoreLearningRisk() {
  let pts = 0;
  const flags = [];

  try {
    const diag = getLearningDiagnostics();

    // Too few outcomes for reliable calibration
    if ((diag.totalTradesAnalyzed ?? 0) < 5) {
      pts += 2;
      // Not a flag worth surfacing — just system is new
    }

    // Recent accuracy below acceptable minimum
    if (diag.recentAccuracy !== null && diag.recentAccuracy < 35) {
      pts += 6;
      flags.push(`LOW_WIN_RATE: recent accuracy ${diag.recentAccuracy}%`);
    }

    // Calibration cycle making large adjustments (instability signal)
    const changes = diag.lastCycleChanges ?? {};
    if (Object.keys(changes).length > 3) {
      pts += 3;
      flags.push(`WEIGHT_INSTABILITY: ${Object.keys(changes).length} weight adjustments in last cycle`);
    }
  } catch {
    // Learning engine not yet active — neutral
  }

  return { score: Math.min(pts, 10), flags };
}

// ── Full system risk computation ──────────────────────────────────────────────

export function computeSystemRiskScore() {
  const execution     = scoreExecutionRisk();
  const financial     = scoreFinancialRisk();
  const decision      = scoreDecisionRisk();
  const infrastructure = scoreInfrastructureRisk();
  const learning      = scoreLearningRisk();

  const score = Math.min(100,
    execution.score +
    financial.score +
    decision.score +
    infrastructure.score +
    learning.score,
  );

  const band  = classifyBand(score);
  const flags = [
    ...execution.flags,
    ...financial.flags,
    ...decision.flags,
    ...infrastructure.flags,
    ...learning.flags,
  ];

  return {
    score,
    band,
    flags,
    dimensions: {
      execution:     { score: execution.score,      max: 25 },
      financial:     { score: financial.score,      max: 30 },
      decision:      { score: decision.score,       max: 20 },
      infrastructure:{ score: infrastructure.score, max: 15 },
      learning:      { score: learning.score,       max: 10 },
    },
  };
}

// ── Main refresh (called once per tick by agentRunner) ────────────────────────

export async function refreshGlobalRiskScore() {
  const prevBand     = _band;
  const prevSafeMode = _safeMode;

  let result;
  try {
    result = computeSystemRiskScore();
    _engineFailed = false;
  } catch (err) {
    _engineFailed = true;
    _safeMode     = true;
    _band         = 'CRITICAL';
    _score        = 100;
    _activeFlags  = ['ENGINE_FAILED'];
    logRiskEvent('ENGINE_FAILURE', { error: err?.message });
    logEvent({
      category: CATEGORY.RISK, severity: SEVERITY.CRITICAL, subsystem: 'globalRisk',
      reason: `ENGINE_FAILURE: risk engine threw — defaulting to safe mode`,
      metadata: { error: err?.message },
    });
    return { score: 100, band: 'CRITICAL', safeMode: true, flags: ['ENGINE_FAILED'] };
  }

  _score       = result.score;
  _band        = result.band;
  _activeFlags = result.flags;
  _dimensions  = result.dimensions;
  _lastRefreshAt = Date.now();

  // Manage safe mode with hysteresis to prevent flapping
  if (result.score >= SAFE_MODE_THRESHOLD && !_safeMode) {
    _safeMode = true;
    logRiskEvent('GLOBAL_SAFE_MODE_ACTIVATED', { score: result.score, band: result.band, flags: result.flags.slice(0, 3) });
    logEvent({
      category: CATEGORY.RISK, severity: SEVERITY.CRITICAL, subsystem: 'globalRisk',
      reason: `SAFE_MODE_ACTIVATED: system risk score ${result.score}/100 — trading suspended`,
      metadata: { score: result.score, band: result.band, flags: result.flags.slice(0, 3) },
    });
  } else if (result.score <= SAFE_MODE_CLEAR_THRESHOLD && _safeMode) {
    _safeMode = false;
    logRiskEvent('GLOBAL_SAFE_MODE_CLEARED', { score: result.score, band: result.band });
    logEvent({
      category: CATEGORY.RISK, severity: SEVERITY.INFO, subsystem: 'globalRisk',
      reason: `SAFE_MODE_CLEARED: system risk score dropped to ${result.score}/100 — trading resumed`,
      metadata: { score: result.score, band: result.band },
    });
  }

  // Log risk band transitions
  if (prevBand !== result.band) {
    logRiskEvent('RISK_BAND_CHANGE', { from: prevBand, to: result.band, score: result.score });
    const isEscalation = ['HIGH_RISK', 'CRITICAL'].includes(result.band);
    logEvent({
      category: CATEGORY.RISK,
      severity: isEscalation ? SEVERITY.HIGH : SEVERITY.INFO,
      subsystem: 'globalRisk',
      reason: `RISK_BAND_CHANGE: ${prevBand ?? 'UNKNOWN'} → ${result.band} (score ${result.score}/100)`,
      metadata: { from: prevBand, to: result.band, score: result.score, flags: result.flags.slice(0, 3) },
    });
  }

  // Log if flags are new (spike detection)
  if (result.flags.length > 0 && result.score >= 50) {
    logRiskEvent('RISK_SPIKE_DETECTED', { score: result.score, band: result.band, topFlag: result.flags[0] });
  }

  return { ...result, safeMode: _safeMode };
}

// ── Public accessors ──────────────────────────────────────────────────────────

/**
 * Hard gate: returns true if global safe mode is active OR if engine failed.
 * All trading and learning must check this before executing.
 */
export function isGlobalSafeMode() {
  if (_engineFailed) return true;   // fail-safe: unknown risk = block
  return _safeMode;
}

export function getGlobalRiskDiagnostics() {
  if (_engineFailed) {
    return {
      score:         100,
      band:          'CRITICAL',
      safeMode:      true,
      activeFlags:   ['ENGINE_FAILED'],
      dimensions:    {},
      lastRefreshAt: null,
    };
  }

  return {
    score:         _score,
    band:          _band,
    safeMode:      _safeMode,
    activeFlags:   [..._activeFlags],
    dimensions:    { ..._dimensions },
    lastRefreshAt: _lastRefreshAt ? new Date(_lastRefreshAt).toISOString() : null,
  };
}
