export const PROFIT_RATCHET_AUDIT_VERSION = 'profit_ratchet_edge_v1';
export const WINNER_LOST_MFE_USD = 5;

const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const round = (value, digits = 6) => {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};
const median = (values) => {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
};
const ratio = (numerator, denominator) => Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0
  ? numerator / denominator
  : null;

export function mfeBand(value) {
  const mfe = finite(value);
  if (mfe == null || mfe < 5) return '$0-5';
  if (mfe < 10) return '$5-10';
  if (mfe < 25) return '$10-25';
  if (mfe < 50) return '$25-50';
  if (mfe < 100) return '$50-100';
  return '$100+';
}

export function notionalBand(value) {
  const notional = finite(value);
  if (notional == null || notional <= 0) return 'UNATTRIBUTED';
  if (notional < 500) return '<$500';
  if (notional < 1000) return '$500-1K';
  if (notional < 2500) return '$1K-2.5K';
  return '$2.5K+';
}

export function normalizeRatchetTrade(row) {
  const mfe = Math.max(0, finite(row.mfe_net_usd) ?? 0);
  const realized = finite(row.realized_net_pnl_usd);
  const protectedFloor = Math.max(0, finite(row.max_protected_profit_usd) ?? 0);
  const giveback = realized == null ? null : Math.max(0, mfe - realized);
  const capture = realized == null || mfe <= 0 ? null : realized / mfe;
  const givebackPct = giveback == null || mfe <= 0 ? null : giveback / mfe;
  const protectedEfficiency = realized == null || protectedFloor <= 0 ? null : realized / protectedFloor;
  const exitReason = String(row.exit_reason || 'UNATTRIBUTED');
  const ratchetActivated = row.ratchet_activated === true;
  const ratchetSaveExit = row.ratchet_save_exit === true
    || (realized != null && realized > 0 && ['profit_ratchet', 'profit_ratchet_stop'].includes(exitReason));
  const winnerLost = realized != null && mfe >= WINNER_LOST_MFE_USD && realized <= 0;
  return {
    ...row,
    strategyVersionId: String(row.strategy_version_id || 'UNATTRIBUTED'),
    pair: String(row.asset_pair || 'UNATTRIBUTED').toUpperCase(),
    side: String(row.side || 'UNATTRIBUTED').toUpperCase(),
    regime: String(row.entry_regime || row.activation_regime || row.close_regime || 'UNATTRIBUTED'),
    session: String(row.entry_session || 'UNATTRIBUTED'),
    leverage: finite(row.leverage),
    notionalUsd: finite(row.notional_usd),
    contextStrength: String(row.activation_strength || row.last_strength || row.close_strength || 'UNATTRIBUTED'),
    exitReason,
    mfe,
    maeObserved: finite(row.mae_observed_net_usd),
    realized,
    protectedFloor,
    giveback,
    capture,
    givebackPct,
    protectedEfficiency,
    ratchetActivated,
    ratchetSaveExit,
    winnerLost,
    mfeBand: mfeBand(mfe),
    notionalBand: notionalBand(row.notional_usd),
    closed: Boolean(row.closed_at) && realized != null,
  };
}

export function summarizeRatchetCohort(rows) {
  const normalized = rows.map(normalizeRatchetTrade);
  const closed = normalized.filter((row) => row.closed);
  const mfes = closed.map((row) => row.mfe).filter(Number.isFinite);
  const captures = closed.map((row) => row.capture).filter(Number.isFinite);
  const givebacks = closed.map((row) => row.giveback).filter(Number.isFinite);
  const realized = closed.map((row) => row.realized).filter(Number.isFinite);
  const protectedEfficiencies = closed.map((row) => row.protectedEfficiency).filter(Number.isFinite);
  const activated = closed.filter((row) => row.ratchetActivated);
  const winnerLost = closed.filter((row) => row.winnerLost);
  const ratchetSaveExits = closed.filter((row) => row.ratchetSaveExit);
  const mfePositiveSignificant = closed.filter((row) => row.mfe >= WINNER_LOST_MFE_USD);
  const realizedPnl = realized.reduce((sum, value) => sum + value, 0);

  return {
    trades: normalized.length,
    closed: closed.length,
    realizedPnl: round(realizedPnl, 4),
    expectancy: closed.length ? round(realizedPnl / closed.length, 6) : null,
    avgMfe: round(mean(mfes), 4),
    medianMfe: round(median(mfes), 4),
    avgCaptureEfficiency: round(mean(captures), 6),
    medianCaptureEfficiency: round(median(captures), 6),
    avgGivebackUsd: round(mean(givebacks), 4),
    avgGivebackPctMfe: round(mean(closed.map((row) => row.givebackPct).filter(Number.isFinite)), 6),
    avgProtectedProfitEfficiency: round(mean(protectedEfficiencies), 6),
    winnerLostCount: winnerLost.length,
    winnerLostRate: mfePositiveSignificant.length ? round(winnerLost.length / mfePositiveSignificant.length, 6) : null,
    ratchetActivationCount: activated.length,
    ratchetActivationRate: closed.length ? round(activated.length / closed.length, 6) : null,
    ratchetSaveExits: ratchetSaveExits.length,
    observedRatchetSaveExitRate: activated.length ? round(ratchetSaveExits.length / activated.length, 6) : null,
    counterfactualWithoutRatchet: 'NOT_DEMONSTRABLE_FROM_OBSERVED_PATH',
    significantMfeCount: mfePositiveSignificant.length,
    economicsBasis: 'persisted_net_pnl_no_additional_cost_subtraction',
  };
}

function groupBy(rows, selector) {
  const groups = new Map();
  for (const row of rows) {
    const normalized = normalizeRatchetTrade(row);
    const key = String(selector(normalized) ?? 'UNATTRIBUTED');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return Object.fromEntries([...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, sample]) => [key, summarizeRatchetCohort(sample)]));
}

export function segmentRatchetTrades(rows) {
  return {
    strategyVersion: groupBy(rows, (row) => row.strategyVersionId),
    pair: groupBy(rows, (row) => row.pair),
    side: groupBy(rows, (row) => row.side),
    regime: groupBy(rows, (row) => row.regime),
    session: groupBy(rows, (row) => row.session),
    leverage: groupBy(rows, (row) => row.leverage == null ? 'UNATTRIBUTED' : `${row.leverage}x`),
    notionalSizing: groupBy(rows, (row) => row.notionalBand),
    exitReason: groupBy(rows, (row) => row.exitReason),
    contextStrength: groupBy(rows, (row) => row.contextStrength),
    mfeBand: groupBy(rows, (row) => row.mfeBand),
  };
}

function entryExitDiagnosis(rows, metrics) {
  if (metrics.closed < 10) {
    return {
      sampleGate: 'INSUFFICIENT_EVIDENCE',
      entryEdge: 'INSUFFICIENT_EVIDENCE',
      exitEdge: 'INSUFFICIENT_EVIDENCE',
      explanation: `Need 10 closed v9 trades for an early diagnostic; have ${metrics.closed}.`,
      automaticParameterChangeAllowed: false,
    };
  }

  const normalized = rows.map(normalizeRatchetTrade).filter((row) => row.closed);
  const significantMfeRate = normalized.length
    ? normalized.filter((row) => row.mfe >= WINNER_LOST_MFE_USD).length / normalized.length
    : 0;
  const poorRealized = metrics.expectancy != null && metrics.expectancy <= 0;
  const poorCapture = metrics.medianCaptureEfficiency != null && metrics.medianCaptureEfficiency < 0.5;
  let entryEdge = 'UNRESOLVED';
  let exitEdge = 'UNRESOLVED';
  let explanation = 'Entry and exit quality both require more evidence.';

  if (significantMfeRate >= 0.5) {
    entryEdge = 'FAVORABLE_EXCURSION_PRESENT';
    if (poorRealized || poorCapture || metrics.winnerLostCount > 0) {
      exitEdge = 'CAPTURE_WEAKNESS_SUSPECTED';
      explanation = 'Entries frequently create meaningful favorable excursion, while realized capture is weak; investigate exits before entry retuning.';
    } else {
      exitEdge = 'CAPTURE_NOT_OBVIOUSLY_BROKEN';
      explanation = 'Favorable excursion is present and observed capture is not obviously impaired in this sample.';
    }
  } else {
    entryEdge = 'FAVORABLE_EXCURSION_WEAK';
    exitEdge = poorCapture ? 'CAPTURE_WEAKNESS_ALSO_PRESENT' : 'NOT_PRIMARY_SUSPECT';
    explanation = 'Too few trades achieve the existing $5 ratchet activation excursion; entry/strategy quality is the primary suspect.';
  }

  return {
    sampleGate: metrics.closed >= 20 ? 'TWENTY_TRADE_REVIEW' : 'TEN_TRADE_EARLY_DIAGNOSTIC',
    entryEdge,
    exitEdge,
    significantMfeRate: round(significantMfeRate, 6),
    explanation,
    automaticParameterChangeAllowed: false,
  };
}

export function buildProfitRatchetExitAudit(rows = []) {
  const v9 = rows.filter((row) => String(row.strategy_version_id || '').endsWith(':v9'));
  const metrics = summarizeRatchetCohort(v9);
  const diagnosis = entryExitDiagnosis(v9, metrics);
  return {
    auditVersion: PROFIT_RATCHET_AUDIT_VERSION,
    strategyScope: 'v9_only',
    exitPolicyScope: 'adaptive_profit_ratchet_v1',
    winnerLostDefinition: `MFE >= $${WINNER_LOST_MFE_USD} (existing activation threshold) and realized net PnL <= 0`,
    metrics,
    segments: segmentRatchetTrades(v9),
    diagnosis,
    evidenceGates: {
      earlyDiagnosticClosed: 10,
      strongerReviewClosed: 20,
      closedObserved: metrics.closed,
      earlyDiagnosticReady: metrics.closed >= 10,
      strongerReviewReady: metrics.closed >= 20,
      automaticTuning: false,
    },
  };
}
