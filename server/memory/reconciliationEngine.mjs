// reconciliationEngine.mjs — startup position reconciliation for Genesis HQ.
//
// Runs once at boot to verify all open positions match known market state.
// If reconciliation fails or is incomplete, enters SAFE_EXECUTION_MODE which
// blocks new trades until the operator reviews and explicitly clears.
//
// Design principles:
//   - Fail safe: network errors → degraded (not silent skip)
//   - Non-destructive: never modify positions without market confirmation
//   - Persistent: state stored in org_state so diagnostics survive restarts
//   - Testable: getStatusFn is injectable for unit tests

import db from '../db/database.mjs';
import { getMarketStatus } from '../marketScanner.mjs';
import { closeTrade, getOpenTrades } from './tradingMemory.mjs';
import { settleTradeCapital } from '../trading/treasury.mjs';
import { analyzeClosedTrade } from './learningEngine.mjs';
import { updateAfterTrade } from './agentScoring.mjs';
import { processMarketResolution } from './decisionAccuracyEngine.mjs';

// ── Status constants ──────────────────────────────────────────────────────────

export const RECONCILIATION_STATUS = {
  HEALTHY:    'healthy',    // all positions verified, no issues
  RECOVERING: 'recovering', // positions exist but all are verified-open (nominal)
  DEGRADED:   'degraded',   // network failures or conflicts — safe mode active
};

// ── Module-level state cache ──────────────────────────────────────────────────
// Loaded lazily from org_state on first access, updated after each reconciliation.

let _state = null;

const DEFAULT_STATE = {
  status: RECONCILIATION_STATUS.HEALTHY,
  recoveredPositions: 0,
  orphanCount: 0,
  unresolvedExposure: 0,
  lastRun: null,
  elapsedMs: null,
  issues: [],
};

function _loadStateFromDB() {
  try {
    const row = db.prepare(`SELECT value FROM org_state WHERE key = 'reconciliation_status'`).get();
    if (row) return JSON.parse(row.value);
  } catch { /* DB unavailable */ }
  return null;
}

function _saveStateToDB(state) {
  try {
    db.prepare(`
      INSERT OR REPLACE INTO org_state (key, value, updated_at)
      VALUES ('reconciliation_status', ?, datetime('now'))
    `).run(JSON.stringify(state));
  } catch (err) {
    console.warn('[reconciliation] Failed to persist state to org_state:', err?.message);
  }
}

// ── Public accessors ──────────────────────────────────────────────────────────

export function getReconciliationStatus() {
  if (!_state) _state = _loadStateFromDB() ?? { ...DEFAULT_STATE };
  return _state;
}

/** Returns true when DEGRADED — used by riskManager to block new trades. */
export function isSafeMode() {
  return getReconciliationStatus().status === RECONCILIATION_STATUS.DEGRADED;
}

/**
 * Operator override — clears degraded state after manual review.
 * Called via POST /api/reconciliation/clear.
 */
export function clearSafeMode() {
  const current = getReconciliationStatus();
  _state = { ...current, status: RECONCILIATION_STATUS.HEALTHY, clearedAt: new Date().toISOString() };
  _saveStateToDB(_state);
  console.log('[reconciliation] SAFE_MODE cleared by operator — trading resumed');
  return _state;
}

/** Test-only: reset module cache to simulate a server restart. */
export function _resetReconciliationCacheForTest() {
  _state = null;
}

// ── Startup reconciliation ────────────────────────────────────────────────────

/**
 * Run once at startup before the first trading cycle.
 *
 * @param {Function} getStatusFn  - injectable for tests (defaults to real getMarketStatus)
 * @param {Function} getTradesFn  - injectable for tests (defaults to real getOpenTrades)
 * @returns {Promise<object>} reconciliation state
 */
export async function runStartupReconciliation(
  getStatusFn = getMarketStatus,
  getTradesFn = getOpenTrades,
) {
  const startMs = Date.now();
  console.log('[reconciliation] ── Startup position reconciliation ──────────────');

  const openTrades = getTradesFn();

  if (openTrades.length === 0) {
    const state = {
      ...DEFAULT_STATE,
      status: RECONCILIATION_STATUS.HEALTHY,
      lastRun: new Date().toISOString(),
      elapsedMs: Date.now() - startMs,
    };
    _state = state;
    _saveStateToDB(state);
    console.log('[reconciliation] No open positions — healthy startup');
    return state;
  }

  console.log(`[reconciliation] Found ${openTrades.length} open position(s) — verifying with exchange...`);

  let recovered = 0;
  let orphans   = 0;
  let unresolved = 0;
  let unresolvedCapital = 0;
  const issues = [];
  let hasNetworkFailure = false;
  let hasConflict = false;

  for (const trade of openTrades) {
    // ── Case: Crypto paper trades ────────────────────────────────────────────
    // Crypto positions have no exchange API — managed by manageCryptoPositions().
    // Accept them as active; they will be closed by the 1-min loop.
    if (trade.market_source === 'crypto') {
      const ageHours = (Date.now() - new Date(trade.opened_at).getTime()) / 3_600_000;
      if (ageHours > 48) {
        orphans++;
        reconciliationLog.orphanDetected({ id: trade.id, source: trade.market_source, ageHours: Math.round(ageHours) });
        issues.push({
          type: 'orphan_detected',
          tradeId: trade.id,
          marketId: trade.market_id,
          source: trade.market_source,
          ageHours: Math.round(ageHours),
          message: `Crypto position open for ${Math.round(ageHours)}h — may be orphaned (exceeds 48h threshold)`,
        });
      }
      unresolved++;
      unresolvedCapital += trade.capital_used ?? 0;
      continue;
    }

    // ── Cases A, B, C, D: Prediction market positions ─────────────────────────
    let marketStatus;
    try {
      marketStatus = await getStatusFn(trade.market_source, trade.market_id);
    } catch (err) {
      // Network failure — cannot verify. Must degrade, not silently skip.
      hasNetworkFailure = true;
      unresolved++;
      unresolvedCapital += trade.capital_used ?? 0;
      issues.push({
        type: 'network_failure',
        tradeId: trade.id,
        marketId: trade.market_id,
        source: trade.market_source,
        message: `Exchange unreachable: ${err?.message ?? 'unknown error'}`,
      });
      reconciliationLog.unresolvedExposure(trade.id, trade.capital_used);
      console.warn(`[reconciliation] NETWORK_FAIL: Cannot verify trade ${trade.id} — ${err?.message}`);
      continue;
    }

    // Case A: exchange confirms still open → recover active state
    if (!marketStatus || marketStatus.status === 'open' || marketStatus.status === 'active') {
      console.log(`[reconciliation] ACTIVE: Trade ${trade.id} confirmed open on ${trade.market_source}`);
      unresolved++;
      unresolvedCapital += trade.capital_used ?? 0;
      continue;
    }

    // Case B: exchange says cancelled → expire and refund capital
    if (marketStatus.status === 'cancelled') {
      try {
        db.prepare(`UPDATE trades SET status = 'expired', closed_at = datetime('now') WHERE id = ?`).run(trade.id);
        settleTradeCapital(trade.capital_used, 0);
        recovered++;
        reconciliationLog.orphanRecovered(trade.id, 'cancelled');
        console.log(`[reconciliation] CANCELLED: Trade ${trade.id} — market delisted, capital refunded`);
      } catch (err) {
        console.error(`[reconciliation] Failed to expire cancelled trade ${trade.id}:`, err?.message);
        hasConflict = true;
        issues.push({
          type: 'settlement_failure',
          tradeId: trade.id,
          message: `Could not settle cancelled trade: ${err?.message}`,
        });
      }
      continue;
    }

    // Case B: exchange says resolved → close trade and settle
    if (marketStatus.status === 'resolved' && marketStatus.result) {
      const resolvedOutcome = marketStatus.result.toUpperCase();
      try {
        const closedTrade = closeTrade(trade.id, resolvedOutcome);
        if (closedTrade) {
          settleTradeCapital(trade.capital_used, closedTrade.pnl);
          updateAfterTrade(trade.agent_id ?? 'market-agent-1', closedTrade);
          processMarketResolution(trade.market_id, resolvedOutcome);
          // Lesson extraction is best-effort — Claude may be unavailable
          try {
            await analyzeClosedTrade(closedTrade);
          } catch (lessonErr) {
            console.warn(`[reconciliation] Lesson extraction failed for ${trade.id}: ${lessonErr?.message}`);
          }
          recovered++;
          reconciliationLog.orphanRecovered(trade.id, resolvedOutcome);
          console.log(`[reconciliation] RECOVERED: Trade ${trade.id} | outcome=${resolvedOutcome} | PnL=$${(closedTrade.pnl ?? 0).toFixed(2)}`);
        }
      } catch (err) {
        console.error(`[reconciliation] Failed to close resolved trade ${trade.id}:`, err?.message);
        hasConflict = true;
        issues.push({
          type: 'settlement_failure',
          tradeId: trade.id,
          marketId: trade.market_id,
          resolvedOutcome,
          message: `Could not close resolved trade: ${err?.message}`,
        });
        unresolved++;
        unresolvedCapital += trade.capital_used ?? 0;
      }
      continue;
    }

    // Case D: conflicting or unknown state → log, degrade
    hasConflict = true;
    unresolved++;
    unresolvedCapital += trade.capital_used ?? 0;
    reconciliationLog.mismatch(trade.id, 'open', marketStatus?.status);
    issues.push({
      type: 'conflicting_state',
      tradeId: trade.id,
      marketId: trade.market_id,
      source: trade.market_source,
      marketStatus: marketStatus?.status,
      message: `Market status '${marketStatus?.status}' not actionable — manual review required`,
    });
    console.error(`[reconciliation] CONFLICT: Trade ${trade.id} has unrecognized status '${marketStatus?.status}'`);
  }

  // Determine overall status
  let status;
  if (hasNetworkFailure || hasConflict) {
    status = RECONCILIATION_STATUS.DEGRADED;
  } else if (unresolved > 0 || orphans > 0) {
    // Positions exist but are all verifiable-open → recovering (not degraded)
    status = RECONCILIATION_STATUS.RECOVERING;
  } else {
    status = RECONCILIATION_STATUS.HEALTHY;
  }

  const state = {
    status,
    recoveredPositions: recovered,
    orphanCount: orphans,
    unresolvedExposure: Math.round(unresolvedCapital * 100) / 100,
    lastRun: new Date().toISOString(),
    elapsedMs: Date.now() - startMs,
    issues,
  };

  _state = state;
  _saveStateToDB(state);

  const marker = status === RECONCILIATION_STATUS.DEGRADED ? 'DEGRADED ⚠️' :
                 status === RECONCILIATION_STATUS.RECOVERING ? 'RECOVERING' : 'HEALTHY ✓';
  console.log(
    `[reconciliation] ${marker} | recovered=${recovered} orphans=${orphans} ` +
    `unresolved=${unresolved} ($${unresolvedCapital.toFixed(2)}) | ${Date.now() - startMs}ms`
  );

  if (status === RECONCILIATION_STATUS.DEGRADED) {
    console.error(
      '[reconciliation] SAFE_EXECUTION_MODE active — new trades blocked.\n' +
      '                 Resolve issues and POST /api/reconciliation/clear to resume.'
    );
  }

  return state;
}

// ── Structured log helpers ────────────────────────────────────────────────────

export const reconciliationLog = {
  orphanDetected({ id, source, ageHours }) {
    console.warn(`[reconciliation:orphan_detected] id=${id} source=${source} age=${ageHours}h`);
  },
  orphanRecovered(tradeId, outcome) {
    console.log(`[reconciliation:orphan_recovered] id=${tradeId} outcome=${outcome}`);
  },
  mismatch(tradeId, dbStatus, exchangeStatus) {
    console.error(`[reconciliation:mismatch] id=${tradeId} db=${dbStatus} exchange=${exchangeStatus}`);
  },
  unresolvedExposure(tradeId, capital) {
    console.warn(`[reconciliation:unresolved_exposure] id=${tradeId} capital=$${(capital ?? 0).toFixed(2)}`);
  },
};
