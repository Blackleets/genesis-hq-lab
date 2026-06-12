// wfScheduler.mjs — background walk-forward auto-scheduler.
//
// Triggers a walk-forward run automatically when:
//   1. The WF cache is stale (>WF_MAX_AGE_HOURS, default 24h), AND
//   2. There are enough closed trades to be worth running (≥ WF_MIN_TRADES, default 30)
//
// Runs on startup (with a short delay to let DB settle) and then every
// WF_CHECK_INTERVAL_MIN minutes thereafter.
//
// This ensures the gate always has fresh OOS evidence without requiring
// manual endpoint calls.

import db from '../db/database.mjs';
import { isWfCacheStale } from './wfCache.mjs';
import { executeWalkForward, isWfRunning } from './runWalkForward.mjs';

const CHECK_INTERVAL_MIN = Number(process.env.WF_CHECK_INTERVAL_MIN  ?? 60);  // how often to check
const MAX_AGE_HOURS      = Number(process.env.WF_MAX_AGE_HOURS        ?? 24);  // stale threshold
const MIN_TRADES         = Number(process.env.WF_MIN_TRADES_GATE       ?? 30);  // min closed trades
const STARTUP_DELAY_MS   = 45_000; // wait 45s after boot before first check

function countClosedTrades() {
  try {
    const row = db.prepare(`SELECT COUNT(*) as n FROM trades WHERE status = 'closed'`).get();
    return row?.n ?? 0;
  } catch {
    return 0;
  }
}

async function maybeRunWalkForward(reason) {
  if (isWfRunning()) {
    console.log('[wfScheduler] Walk-forward already running — skipping');
    return;
  }

  const stale  = isWfCacheStale(MAX_AGE_HOURS);
  const trades = countClosedTrades();

  if (!stale) {
    console.log(`[wfScheduler] Cache fresh (< ${MAX_AGE_HOURS}h) — skip (${reason})`);
    return;
  }

  if (trades < MIN_TRADES) {
    console.log(`[wfScheduler] Only ${trades}/${MIN_TRADES} closed trades — skip WF (${reason})`);
    return;
  }

  console.log(`[wfScheduler] Triggering walk-forward (${reason}) — ${trades} closed trades, cache stale`);
  try {
    const result = await executeWalkForward();
    const { summary } = result;
    console.log(
      `[wfScheduler] Walk-forward complete — robustCombined=${summary?.robustCombined} ` +
      `robustShort=${summary?.robustShort} windows=${summary?.totalJudged} ` +
      `durationMs=${result.durationMs}`
    );
  } catch (err) {
    console.error('[wfScheduler] Walk-forward failed:', err.message);
  }
}

let _started = false;
let _timer   = null;

export function startWfScheduler() {
  if (_started) return;
  _started = true;

  // Startup check: slight delay so DB migrations and position monitor settle first
  setTimeout(() => {
    maybeRunWalkForward('startup').catch(() => {});
  }, STARTUP_DELAY_MS);

  // Periodic check
  const intervalMs = CHECK_INTERVAL_MIN * 60_000;
  _timer = setInterval(() => {
    maybeRunWalkForward('scheduled').catch(() => {});
  }, intervalMs);

  console.log(
    `[wfScheduler] Started — checks every ${CHECK_INTERVAL_MIN}min, ` +
    `stale threshold ${MAX_AGE_HOURS}h, min trades ${MIN_TRADES}, ` +
    `startup delay ${STARTUP_DELAY_MS / 1000}s`
  );
}

export function stopWfScheduler() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
  _started = false;
}

export function getWfSchedulerStatus() {
  return {
    started:          _started,
    checkIntervalMin: CHECK_INTERVAL_MIN,
    maxAgeHours:      MAX_AGE_HOURS,
    minTrades:        MIN_TRADES,
    closedTrades:     countClosedTrades(),
    cacheStale:       isWfCacheStale(MAX_AGE_HOURS),
    running:          isWfRunning(),
  };
}
