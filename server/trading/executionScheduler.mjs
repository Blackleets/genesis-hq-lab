// executionScheduler.mjs — tiered execution loop orchestrator for Phase 6A.
//
// Three independent loops:
//
//   FAST  (5 seconds)   — crypto scalping (scalpingEngine)
//   MID   (30 seconds)  — event alpha / prediction markets (eventAlphaEngine)
//   SLOW  (5 minutes)   — swing trades (swingEngine) — aligned with existing agentRunner tick
//
// Safety guarantees:
//   - Each engine has a _running lock — overlapping executions impossible
//   - isGlobalSafeMode() + isSafeMode() are checked inside each engine (not here)
//   - REAL_TRADING is never enabled here — paper only by design
//   - Errors are caught and logged; they never crash the main process
//
// Capital allocation (in-memory, dynamic):
//   FAST_ALPHA:   40% ± adjustment (bounds: 15%–60%)
//   SWING:        30% ± adjustment (bounds: 15%–60%)
//   EVENT_ALPHA:  30% ± adjustment (bounds: 15%–60%)
//
// Allocation rebalances after every 10 closed trades if one engine outperforms
// by more than 15% win-rate difference.

import { runScalpingCycle } from '../strategies/scalpingEngine.mjs';
import { runSwingCycle } from '../strategies/swingEngine.mjs';
import { runEventAlphaCycle } from '../strategies/eventAlphaEngine.mjs';
import { monitorPositions, getTrainingMetrics } from './positionMonitor.mjs';
import { logEvent, CATEGORY, SEVERITY } from '../observability/eventTimeline.mjs';
import db from '../db/database.mjs';

const FAST_INTERVAL_MS  =  5 * 1000;   // 5 seconds
const MID_INTERVAL_MS   = 30 * 1000;   // 30 seconds
const SLOW_INTERVAL_MS  =  5 * 60 * 1000; // 5 minutes

const TRAINING_MODE = ['1', 'true', 'yes'].includes((process.env.TRAINING_MODE ?? '').toLowerCase());

// ── Capital allocation state ──────────────────────────────────────────────────

const ALLOC_BOUNDS = { min: 0.15, max: 0.60 };

let _allocation = {
  fast_alpha:   0.40,
  swing:        0.30,
  event_alpha:  0.30,
};

let _lastRebalanceCount = 0;  // total closed trades at last rebalance

function clampAllocation(v) {
  return Math.max(ALLOC_BOUNDS.min, Math.min(ALLOC_BOUNDS.max, v));
}

/** Rebalance allocations based on engine win rates. */
function rebalanceAllocations() {
  try {
    const metrics = getTrainingMetrics();
    if (metrics.closed - _lastRebalanceCount < 10) return; // only rebalance after 10 new closes
    _lastRebalanceCount = metrics.closed;

    // Get win rates per engine
    const rates = {};
    for (const e of metrics.byType) {
      if (e.trades >= 5) rates[e.tradeType] = e.winRate ?? 0;
    }

    // Map trade_type to allocation key
    const typeToKey = { scalp_v2: 'fast_alpha', swing_v1: 'swing', 'event-alpha': 'event_alpha' };
    const keys = Object.keys(_allocation);

    // If any engine outperforms by 15%+ → shift 5% toward it
    for (const [type, rate] of Object.entries(rates)) {
      const key = typeToKey[type];
      if (!key) continue;
      const others = keys.filter(k => k !== key);
      const avgOther = others.reduce((s, k) => s + (rates[typeToKey[k]] ?? 0), 0) / others.length;
      if (rate - avgOther > 0.15) {
        const delta = 0.05;
        _allocation[key] = clampAllocation(_allocation[key] + delta);
        // Reduce others proportionally
        const reduce = delta / others.length;
        for (const k of others) {
          _allocation[k] = clampAllocation(_allocation[k] - reduce);
        }
        logEvent(CATEGORY.EXECUTION, SEVERITY.INFO, 'scheduler',
          `ALLOCATION REBALANCE: ${key} → ${(_allocation[key]*100).toFixed(0)}% (outperforming by ${((rate-avgOther)*100).toFixed(0)}%)`,
          { allocation: { ..._allocation } });
      }
    }
  } catch { /* rebalance failure is non-fatal */ }
}

// ── Engine running locks ──────────────────────────────────────────────────────

const _running = {
  fast: false,
  mid:  false,
  slow: false,
  monitor: false,
};

// ── Tick counters and timing ──────────────────────────────────────────────────

const _stats = {
  fastTicks:  0,
  midTicks:   0,
  slowTicks:  0,
  monitorTicks: 0,
  errors:     { fast: 0, mid: 0, slow: 0 },
  lastFastAt:  null,
  lastMidAt:   null,
  lastSlowAt:  null,
  startedAt:   null,
};

let _timers = [];
let _started = false;

// ── Individual engine runners ─────────────────────────────────────────────────

async function runFast() {
  if (_running.fast) return; // skip if previous tick still running
  _running.fast = true;
  try {
    _stats.fastTicks++;
    _stats.lastFastAt = new Date().toISOString();

    // Position monitor on every fast tick (no momentum check — keeps it fast)
    if (!_running.monitor) {
      _running.monitor = true;
      monitorPositions({ checkMomentum: false }).finally(() => { _running.monitor = false; });
    }

    const result = await runScalpingCycle();
    if (result.executed > 0 || result.blocked) {
      const summary = `FAST: scanned=${result.scanned} qualified=${result.qualified} executed=${result.executed}`;
      console.log(`[scheduler] ${summary}`);
    }
  } catch (err) {
    _stats.errors.fast++;
    console.error('[scheduler] FAST tick error:', err.message);
    logEvent(CATEGORY.EXECUTION, SEVERITY.HIGH, 'scheduler', `FAST loop error: ${err.message}`);
  } finally {
    _running.fast = false;
  }
}

async function runMid() {
  if (_running.mid) return;
  _running.mid = true;
  try {
    _stats.midTicks++;
    _stats.lastMidAt = new Date().toISOString();

    // Position monitor with momentum check on mid tick
    await monitorPositions({ checkMomentum: true });

    const result = await runEventAlphaCycle();
    if (result.executed > 0 || result.evPositive > 0) {
      console.log(`[scheduler] MID: scanned=${result.scanned} qualified=${result.qualified} evPositive=${result.evPositive} executed=${result.executed}`);
    }

    // Rebalance allocations periodically
    rebalanceAllocations();
  } catch (err) {
    _stats.errors.mid++;
    console.error('[scheduler] MID tick error:', err.message);
    logEvent(CATEGORY.EXECUTION, SEVERITY.HIGH, 'scheduler', `MID loop error: ${err.message}`);
  } finally {
    _running.mid = false;
  }
}

async function runSlow() {
  if (_running.slow) return;
  _running.slow = true;
  try {
    _stats.slowTicks++;
    _stats.lastSlowAt = new Date().toISOString();

    const result = await runSwingCycle();
    if (result.executed > 0) {
      console.log(`[scheduler] SLOW: swing executed=${result.executed}`);
    }

    if (TRAINING_MODE) {
      const metrics = getTrainingMetrics();
      console.log(
        `[scheduler][TRAINING] Stats: total=${metrics.total} open=${metrics.open} closed=${metrics.closed} ` +
        `winRate=${metrics.winRate !== null ? (metrics.winRate*100).toFixed(1)+'%' : 'N/A'} ` +
        `pnl=$${metrics.totalPnl.toFixed(2)}`
      );
    }
  } catch (err) {
    _stats.errors.slow++;
    console.error('[scheduler] SLOW tick error:', err.message);
    logEvent(CATEGORY.EXECUTION, SEVERITY.HIGH, 'scheduler', `SLOW loop error: ${err.message}`);
  } finally {
    _running.slow = false;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Start all three execution loops. Safe to call multiple times — idempotent. */
export function startScheduler() {
  if (_started) return;
  _started = true;
  _stats.startedAt = new Date().toISOString();

  // Run FAST immediately, then on interval
  runFast();
  _timers.push(setInterval(runFast, FAST_INTERVAL_MS));

  // Run MID after 10s delay (let fast settle first), then on interval
  setTimeout(() => {
    runMid();
    _timers.push(setInterval(runMid, MID_INTERVAL_MS));
  }, 10_000);

  // Run SLOW after 30s delay (let system warm up), then on interval
  setTimeout(() => {
    runSlow();
    _timers.push(setInterval(runSlow, SLOW_INTERVAL_MS));
  }, 30_000);

  const mode = TRAINING_MODE ? 'TRAINING' : 'PAPER';
  console.log(`[scheduler] ▶ Started (${mode} mode) | FAST=5s MID=30s SLOW=5min | alloc=${JSON.stringify(_allocation)}`);
  logEvent(CATEGORY.EXECUTION, SEVERITY.INFO, 'scheduler',
    `Execution scheduler started (${mode} mode)`,
    { allocation: _allocation, intervals: { fastMs: FAST_INTERVAL_MS, midMs: MID_INTERVAL_MS, slowMs: SLOW_INTERVAL_MS } });
}

/** Stop all loops gracefully. */
export function stopScheduler() {
  for (const t of _timers) clearInterval(t);
  _timers = [];
  _started = false;
  console.log('[scheduler] ■ Stopped');
  logEvent(CATEGORY.EXECUTION, SEVERITY.INFO, 'scheduler', 'Execution scheduler stopped');
}

/** Get current scheduler status for API and truth layer. */
export function getSchedulerStatus() {
  const metrics = (() => {
    try { return getTrainingMetrics(); } catch { return null; }
  })();

  return {
    started: _started,
    startedAt: _stats.startedAt,
    mode: TRAINING_MODE ? 'training' : 'paper',
    allocation: { ..._allocation },
    allocationBounds: ALLOC_BOUNDS,
    intervals: {
      fastMs: FAST_INTERVAL_MS,
      midMs:  MID_INTERVAL_MS,
      slowMs: SLOW_INTERVAL_MS,
    },
    ticks: {
      fast:    _stats.fastTicks,
      mid:     _stats.midTicks,
      slow:    _stats.slowTicks,
    },
    errors: { ..._stats.errors },
    lastRun: {
      fast: _stats.lastFastAt,
      mid:  _stats.lastMidAt,
      slow: _stats.lastSlowAt,
    },
    running: { ..._running },
    training: metrics,
  };
}

/** Force a single FAST tick (useful for testing). */
export async function triggerFast() { return runFast(); }

/** Force a single MID tick. */
export async function triggerMid()  { return runMid(); }

/** Force a single SLOW tick. */
export async function triggerSlow() { return runSlow(); }
