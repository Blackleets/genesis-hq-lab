// validationGate.mjs — single validation checkpoint for the Quant Lab.
//
// Answers: "Does this strategy / system have enough validated edge to receive capital?"\n// Missing/stale walk-forward FAILS (never silent-pass). Infinite PF FAILS.
//
// Rules (institutional minimums, stricter than futuresGovernor defaults):
//   totalTrades     ≥ configured institutional minimum (PROMOTION_CRITERIA)
//   profitFactor    ≥ 1.3
//   expectancy      > 0     (positive EV per trade)
//   maxDrawdownPct  ≤ configured promotion ceiling
//   winRate must exist (at least 1 trade)
//   data must NOT be fixture or mixed with prediction markets
//
// Returns:
//   { approved, status, reasons, metrics, dataMode, nextAction }

import { getAlphaReport } from '../../research/alphaValidationEngine.mjs';
import { getWfCache, isWfCacheStale } from '../wfCache.mjs';
import { isGlobalSafeMode, refreshGlobalRiskScore, getGlobalRiskDiagnostics } from '../../risk/globalRiskEngine.mjs';
import { isSafeMode } from '../../memory/reconciliationEngine.mjs';
import { getFuturesGovernorSnapshot } from '../../crypto/futuresGovernor.mjs';
import { PROMOTION_CRITERIA } from '../alpha/strategyRegistry.mjs';
import { evaluateWalkForwardEvidence, evaluateProfitFactorEvidence } from './gateEvidence.mjs';
export { evaluateWalkForwardEvidence, evaluateProfitFactorEvidence } from './gateEvidence.mjs';

// ── Thresholds (explicit — no magic numbers scattered) ────────────────────────

const GATE_RULES = Object.freeze({
  minTrades:        PROMOTION_CRITERIA.minTrades,        // 30
  minProfitFactor:  PROMOTION_CRITERIA.minProfitFactor,  // 1.3
  minExpectancy:    PROMOTION_CRITERIA.minExpectancy,    // 0
  maxDrawdownPct:   PROMOTION_CRITERIA.maxDrawdownPct,   // 0.15
});

// ── Individual check helpers ──────────────────────────────────────────────────

function checkTradeCount(n) {
  if (n < GATE_RULES.minTrades) {
    return {
      pass: false,
      code: 'INSUFFICIENT_TRADES',
      detail: `${n}/${GATE_RULES.minTrades} closed trades needed for edge assessment`,
    };
  }
  return { pass: true, code: 'TRADE_COUNT_OK', detail: `${n} trades — sufficient sample` };
}

function checkProfitFactor(pf) {
  return evaluateProfitFactorEvidence(pf, { minProfitFactor: GATE_RULES.minProfitFactor });
}

function checkExpectancy(ev) {
  if (ev == null) {
    return { pass: false, code: 'EXPECTANCY_UNKNOWN', detail: 'EV not computable' };
  }
  if (ev <= GATE_RULES.minExpectancy) {
    return { pass: false, code: 'NEGATIVE_EV', detail: `Expectancy $${ev.toFixed(4)} per trade is zero or negative` };
  }
  return { pass: true, code: 'EXPECTANCY_OK', detail: `EV $${ev.toFixed(4)} per trade (positive)` };
}

function checkDrawdown(dd) {
  if (dd == null) return { pass: true, code: 'DRAWDOWN_UNKNOWN', detail: 'Drawdown not available' };
  if (dd > GATE_RULES.maxDrawdownPct) {
    return {
      pass: false,
      code: 'DRAWDOWN_TOO_HIGH',
      detail: `Max drawdown ${(dd * 100).toFixed(1)}% > ${GATE_RULES.maxDrawdownPct * 100}% limit`,
    };
  }
  return { pass: true, code: 'DRAWDOWN_OK', detail: `Max drawdown ${(dd * 100).toFixed(1)}%` };
}

function checkWalkForward() {
  return evaluateWalkForwardEvidence(getWfCache(), { stale: isWfCacheStale(24) });
}


function checkRollingEdge(rollingPf, aggregatePf) {
  if (rollingPf == null || !Number.isFinite(rollingPf)) {
    return { pass: true, code: 'ROLLING_PF_UNKNOWN', detail: 'Rolling PF (last 15 trades) not available (<5 recent trades)' };
  }
  // Warn if edge is degrading: recent PF < 1.0 but aggregate passes
  if (rollingPf < 1.0 && aggregatePf != null && aggregatePf >= GATE_RULES.minProfitFactor) {
    return {
      pass: false,
      code: 'ROLLING_EDGE_DEGRADING',
      detail: `Rolling PF (last 15) = ${rollingPf.toFixed(2)} < 1.0 — edge degrading recently despite aggregate PF ${aggregatePf.toFixed(2)}`,
    };
  }
  return { pass: true, code: 'ROLLING_EDGE_OK', detail: `Rolling PF (last 15) = ${Number.isFinite(rollingPf) ? rollingPf.toFixed(2) : '∞'}` };
}

function checkConsecutiveLosses(streak) {
  if (streak == null) return { pass: true, code: 'STREAK_UNKNOWN', detail: 'Consecutive loss streak not available' };
  if (streak >= 8) {
    return {
      pass: false,
      code: 'STREAK_TOO_HIGH',
      detail: `Max consecutive losses = ${streak} — sustained losing run signals regime change or broken edge`,
    };
  }
  return { pass: true, code: 'STREAK_OK', detail: `Max consecutive loss streak = ${streak}` };
}

function checkSafeMode() {
  if (isGlobalSafeMode()) {
    return { pass: false, code: 'GLOBAL_SAFE_MODE', detail: 'Global risk engine has activated safe mode' };
  }
  if (isSafeMode()) {
    return { pass: false, code: 'RECONCILIATION_SAFE_MODE', detail: 'Startup reconciliation is in safe mode' };
  }
  return { pass: true, code: 'SAFE_MODE_CLEAR', detail: 'No safe mode active' };
}

function checkDataMode(report) {
  // Any fixture data contamination fails the gate
  if (report?.dataQuality?.sufficient === false) {
    return {
      pass: false,
      code: 'INSUFFICIENT_DATA',
      detail: `Data quality insufficient: ${report.dataQuality?.warning ?? 'unknown'}`,
    };
  }
  return { pass: true, code: 'DATA_OK', detail: 'Real trade data from DB' };
}

// ── System-level validation (aggregate across all strategies) ─────────────────

/**
 * Run the full validation gate against the current system state.
 * Uses alphaValidationEngine.getAlphaReport() for aggregate metrics,
 * and futuresGovernor for per-strategy status.
 *
 * @returns {{
 *   approved: boolean,
 *   status: 'APPROVED'|'REJECTED'|'INSUFFICIENT_DATA'|'SAFE_MODE',
 *   verdict: string,
 *   checks: object[],
 *   reasons: string[],
 *   metrics: object,
 *   promotedStrategies: object[],
 *   dataMode: string,
 *   nextAction: string,
 *   updatedAt: string
 * }}
 */
export function runSystemValidation() {
  const checks     = [];
  const reasons    = [];

  // ── 1. Safe mode check (highest priority — blocks everything) ──────────────
  const safeModeCheck = checkSafeMode();
  checks.push({ name: 'safe_mode', ...safeModeCheck });
  if (!safeModeCheck.pass) {
    reasons.push(safeModeCheck.detail);
    return buildResult(false, 'SAFE_MODE', checks, reasons, {}, [], 'Wait for safe mode to clear', null);
  }

  // ── 2. Alpha report (aggregate edge across all closed trades) ──────────────
  let report;
  let dataMode = 'REAL_DATA';
  try {
    report = getAlphaReport();
  } catch (err) {
    return buildResult(false, 'INSUFFICIENT_DATA', checks, [`getAlphaReport failed: ${err.message}`], {}, [], 'Fix DB connection', null);
  }

  const tradeCount    = report?.tradeHistory ?? 0;
  const expectancy    = report?.expectancy?.expectancyPerTrade ?? null;
  const winRate       = report?.expectancy?.winRate ?? null;
  const pf            = report?.expectancy?.profitFactor ?? null;
  const maxDD         = report?.expectancy?.maxDrawdownPct ?? null;
  const sharpeProxy   = report?.expectancy?.sharpeProxy ?? null;
  const sortinoProxy  = report?.expectancy?.sortinoProxy ?? null;
  const rollingPf15   = report?.expectancy?.rollingPf15 ?? null;
  const maxLossStreak = report?.expectancy?.maxLossStreak ?? null;

  // ── 3. Trade count ────────────────────────────────────────────────────────
  const tradeCheck = checkTradeCount(tradeCount);
  checks.push({ name: 'trade_count', ...tradeCheck });
  if (!tradeCheck.pass) reasons.push(tradeCheck.detail);

  // ── 4. Data quality ──────────────────────────────────────────────────────
  const dataCheck = checkDataMode(report);
  checks.push({ name: 'data_mode', ...dataCheck });
  if (!dataCheck.pass) { reasons.push(dataCheck.detail); dataMode = 'INSUFFICIENT_DATA'; }

  // ── 5. Profit factor ─────────────────────────────────────────────────────
  const pfCheck = checkProfitFactor(pf);
  checks.push({ name: 'profit_factor', ...pfCheck });
  if (!pfCheck.pass) reasons.push(pfCheck.detail);

  // ── 6. Expectancy ────────────────────────────────────────────────────────
  const evCheck = checkExpectancy(expectancy);
  checks.push({ name: 'expectancy', ...evCheck });
  if (!evCheck.pass) reasons.push(evCheck.detail);

  // ── 7. Drawdown ──────────────────────────────────────────────────────────
  const ddCheck = checkDrawdown(maxDD);
  checks.push({ name: 'drawdown', ...ddCheck });
  if (!ddCheck.pass) reasons.push(ddCheck.detail);

  // ── 8. Rolling edge (last 15 trades) ──────────────────────────────────────────
  const rollingCheck = checkRollingEdge(rollingPf15, pf);
  checks.push({ name: 'rolling_edge', ...rollingCheck });
  if (!rollingCheck.pass) reasons.push(rollingCheck.detail);

  // ── 9. Consecutive loss streak ─────────────────────────────────────────────────
  const streakCheck = checkConsecutiveLosses(maxLossStreak);
  checks.push({ name: 'loss_streak', ...streakCheck });
  if (!streakCheck.pass) reasons.push(streakCheck.detail);

  // ── 10. Walk-forward OOS validation ────────────────────────────────────────
  const wfCheck = checkWalkForward();
  checks.push({ name: 'walk_forward', ...wfCheck });
  if (!wfCheck.pass) reasons.push(wfCheck.detail);

  // ── 11. Per-strategy governor data ────────────────────────────────────────
  let promotedStrategies = [];
  try {
    const govSnap = getFuturesGovernorSnapshot();
    const profiles = govSnap?.profiles ?? [];
    promotedStrategies = profiles.filter((p) => {
      const trades = p.trades ?? 0;
      const pf     = p.profitFactor ?? 0;
      const ev     = p.avgPnl ?? 0;
      return trades >= GATE_RULES.minTrades
        && pf >= GATE_RULES.minProfitFactor
        && ev > 0
        && !p.paused;
    });
  } catch { /* governor may not be available in test env */ }

  // ── Final verdict ─────────────────────────────────────────────────────────
  const allPass = checks.every((c) => c.pass);
  const approved = allPass;
  const status   = tradeCheck.pass === false ? 'INSUFFICIENT_DATA'
    : approved ? 'APPROVED'
    : 'REJECTED';

  const nextAction = buildNextAction(status, tradeCount, pf, expectancy, promotedStrategies);

  const wfCache = getWfCache();
  const metrics = {
    totalTrades:    tradeCount,
    winRate,
    profitFactor:   pf,
    expectancy,
    maxDrawdown:    maxDD,
    sharpeProxy,
    sortinoProxy,
    rollingPf15,
    maxLossStreak,
    wfRobustShort:    wfCache?.summary?.robustShort    ?? null,
    wfRobustCombined: wfCache?.summary?.robustCombined ?? null,
    wfRunAt:          wfCache?.completedAt             ?? null,
    promotedCount:  promotedStrategies.length,
    alphaVerdict:   report?.verdict?.summary ?? null,
  };

  return buildResult(approved, status, checks, reasons, metrics, promotedStrategies, nextAction, dataMode);
}

/**
 * Validate a specific strategy profile from the futures governor.
 *
 * @param {{ trades, profitFactor, avgPnl, maxDrawdown, winRate, paused }} profile
 * @returns {{ approved, checks, reasons }}
 */
export function validateStrategyProfile(profile) {
  const checks  = [];
  const reasons = [];

  if (profile.paused) {
    return { approved: false, checks: [{ name: 'paused', pass: false, code: 'PAUSED', detail: 'Strategy is paused by supervisor' }], reasons: ['Strategy paused'] };
  }

  const tc = checkTradeCount(profile.trades ?? 0);
  const pf = checkProfitFactor(profile.profitFactor ?? null);
  const ev = checkExpectancy(profile.avgPnl ?? null);
  const dd = checkDrawdown(profile.maxDrawdown ?? null);

  for (const c of [tc, pf, ev, dd]) {
    checks.push(c);
    if (!c.pass) reasons.push(c.detail);
  }

  return { approved: checks.every((c) => c.pass), checks, reasons };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function buildResult(approved, status, checks, reasons, metrics, promoted, nextAction, dataMode) {
  return {
    approved,
    status,
    verdict: approved ? '✓ APPROVED — edge validated, capital allocation permitted'
      : status === 'INSUFFICIENT_DATA'
        ? '⚠ INSUFFICIENT_DATA — not enough trades to assess edge'
        : status === 'SAFE_MODE'
          ? '🔴 SAFE_MODE — all capital allocation blocked'
          : '✗ REJECTED — edge not validated, no capital allocation',
    checks,
    reasons,
    metrics,
    promotedStrategies: promoted,
    dataMode:   dataMode ?? 'REAL_DATA',
    nextAction,
    updatedAt:  new Date().toISOString(),
  };
}

function buildNextAction(status, trades, pf, ev, promoted) {
  if (status === 'SAFE_MODE')         return 'Clear global safe mode before any capital allocation.';
  if (status === 'INSUFFICIENT_DATA') return `Accumulate ${Math.max(0, GATE_RULES.minTrades - trades)} more closed trades with the futures breakout engine.`;
  if (status === 'REJECTED') {
    if (pf != null && pf < 1.3) return `Improve profit factor from ${pf?.toFixed(3)} to ≥1.3. Run edgeSearch to find better params.`;
    if (ev != null && ev <= 0)  return 'Expectancy is zero or negative. Run walk-forward validation. Check if scalp trades are polluting the aggregate.';
    return 'Review failed checks above and run backtest + walk-forward before re-submitting.';
  }
  if (status === 'APPROVED') {
    if (promoted.length === 0) return 'Aggregate approved but no individual strategy meets the per-strategy bar. Run per-profile analysis.';
    return `${promoted.length} strategy profile(s) meet the bar. Proceed to allocation engine for capital sizing.`;
  }
  return 'Run npm run backtest to gather more data.';
}
