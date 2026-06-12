// runWalkForward.mjs — async runner that executes the walk-forward and caches results.
//
// NOT called from the validation gate (too slow — 2-3s + Binance API).
// Called by: GET /api/quant/wf/run (fire-and-forget endpoint)
//            or a scheduled background job.

import { runBreakoutWalkForward } from '../crypto/backtest/breakoutWalkForward.mjs';
import { setWfCache } from './wfCache.mjs';

let _running = false;

export function isWfRunning() {
  return _running;
}

/**
 * Run the full walk-forward validation and cache the result.
 * Returns the result object on success, throws on failure.
 */
export async function executeWalkForward({ pairs, windows } = {}) {
  if (_running) throw new Error('Walk-forward already in progress');
  _running = true;

  const startedAt = new Date().toISOString();
  try {
    const result = await runBreakoutWalkForward({ pairs, windows });
    const cached = {
      ...result,
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - new Date(startedAt).getTime(),
    };
    setWfCache(cached);
    return cached;
  } finally {
    _running = false;
  }
}
