// Pure evidence checks — no DB. Fail closed. Never invent edge.

/**
 * Missing or stale walk-forward FAILS. "Not run yet" is not a pass.
 */
export function evaluateWalkForwardEvidence(cache, { stale = false } = {}) {
  if (!cache) {
    return {
      pass: false,
      code: 'WF_NOT_RUN',
      detail: 'Walk-forward not yet run — no OOS evidence. Call GET /api/quant/wf/run before any APPROVED.',
    };
  }

  const { summary } = cache;
  const robustShort = summary?.robustShort ?? false;
  const robustCombined = summary?.robustCombined ?? false;
  const judged = summary?.combinedJudgedWindows ?? 0;
  const positive = summary?.combinedPositiveWindows ?? 0;
  const completedAt = cache.completedAt ?? cache.cachedAt ?? 'unknown';

  if (stale) {
    return {
      pass: false,
      code: 'WF_STALE',
      detail: `Walk-forward cache is >24h old (ran ${completedAt}). Re-run for fresh OOS evidence — stale is not a pass.`,
    };
  }

  if (!robustCombined && !robustShort) {
    return {
      pass: false,
      code: 'WF_NOT_ROBUST',
      detail: `Walk-forward: combined edge positive in ${positive}/${judged} windows — not robust. Need positive in ALL judged windows.`,
    };
  }

  const which = robustCombined ? 'COMBINED' : 'SHORT';
  return {
    pass: true,
    code: 'WF_ROBUST',
    detail: `Walk-forward ${which} edge robust (${positive}/${judged} windows positive, ran ${completedAt})`,
  };
}

/**
 * Infinite PF (zero losses) is not adversarial evidence of edge.
 */
export function evaluateProfitFactorEvidence(pf, { minProfitFactor = 1.3 } = {}) {
  if (pf == null) {
    return { pass: false, code: 'PROFIT_FACTOR_UNKNOWN', detail: 'No profit factor available (no winning or losing trades)' };
  }
  if (pf === Infinity) {
    return {
      pass: false,
      code: 'PROFIT_FACTOR_NO_LOSSES',
      detail: 'PF infinite (no losing trades observed) — insufficient adversarial evidence; not APPROVED',
    };
  }
  if (pf < minProfitFactor) {
    return { pass: false, code: 'PROFIT_FACTOR_LOW', detail: `PF ${pf.toFixed(3)} < ${minProfitFactor} threshold` };
  }
  return { pass: true, code: 'PROFIT_FACTOR_OK', detail: `PF ${pf.toFixed(3)} ≥ ${minProfitFactor}` };
}
