// promotionGate.mjs — pure eligibility for PROMOTED.
// Must be AT LEAST as strict as evaluateGates (backtestCore). Never weaker.
// Missing DD / t-stat / winRate → not PROMOTED (fail closed). LIVE_OFF unrelated.

export const PROMOTION_CRITERIA = Object.freeze({
  minTrades: 50, // was 30 — must match Sample >= 50 institutional gate
  minProfitFactor: 1.3,
  minExpectancy: 0, // avgPnl (absolute) > 0 when % expectancy unavailable
  maxDrawdownPct: 0.25, // match gate DD <= 25%
  minWinRate: 0.45,
  minTStat: 2.0,
});

/**
 * @param {object} profile — governor or metrics-like shape
 * @returns {{ eligible: boolean, code: string, detail: string, checks: object[] }}
 */
export function evaluatePromotionEligibility(profile = {}) {
  const trades = Number(profile.trades) || 0;
  const pf = profile.profitFactor;
  const ev = profile.avgPnl ?? profile.expectancy ?? null;
  const wr = profile.winRate;
  const dd = profile.maxDrawdown ?? profile.maxDrawdownPct ?? null;
  const tstat = profile.tstat ?? profile.tStat ?? null;

  const checks = [];

  const samplePass = trades >= PROMOTION_CRITERIA.minTrades;
  checks.push({ code: 'SAMPLE', pass: samplePass, detail: `trades=${trades} need≥${PROMOTION_CRITERIA.minTrades}` });

  let pfPass = false;
  let pfDetail = 'pf missing';
  if (pf == null) {
    pfPass = false;
    pfDetail = 'profitFactor missing';
  } else if (pf === Infinity) {
    pfPass = false;
    pfDetail = 'PF infinite (no losses) — not adversarial evidence';
  } else if (pf >= PROMOTION_CRITERIA.minProfitFactor) {
    pfPass = true;
    pfDetail = `PF ${pf} ≥ ${PROMOTION_CRITERIA.minProfitFactor}`;
  } else {
    pfPass = false;
    pfDetail = `PF ${pf} < ${PROMOTION_CRITERIA.minProfitFactor}`;
  }
  checks.push({ code: 'PROFIT_FACTOR', pass: pfPass, detail: pfDetail });

  const evPass = ev != null && Number(ev) > PROMOTION_CRITERIA.minExpectancy;
  checks.push({
    code: 'EXPECTANCY',
    pass: evPass,
    detail: ev == null ? 'avgPnl/expectancy missing' : `ev=${ev} need>${PROMOTION_CRITERIA.minExpectancy}`,
  });

  const wrPass = wr != null && Number(wr) >= PROMOTION_CRITERIA.minWinRate;
  checks.push({
    code: 'WIN_RATE',
    pass: wrPass,
    detail: wr == null ? 'winRate missing — fail closed' : `WR ${wr} need≥${PROMOTION_CRITERIA.minWinRate}`,
  });

  const ddPass = dd != null && Number(dd) <= PROMOTION_CRITERIA.maxDrawdownPct;
  checks.push({
    code: 'DRAWDOWN',
    pass: ddPass,
    detail: dd == null ? 'maxDrawdown missing — fail closed' : `DD ${dd} need≤${PROMOTION_CRITERIA.maxDrawdownPct}`,
  });

  const tPass = tstat != null && Number(tstat) >= PROMOTION_CRITERIA.minTStat;
  checks.push({
    code: 'TSTAT',
    pass: tPass,
    detail: tstat == null ? 't-stat missing — fail closed' : `t=${tstat} need≥${PROMOTION_CRITERIA.minTStat}`,
  });

  const eligible = checks.every((c) => c.pass);
  if (!eligible) {
    const failed = checks.filter((c) => !c.pass).map((c) => c.code);
    return {
      eligible: false,
      code: failed.includes('SAMPLE') && trades > 0 ? 'PAPER_INSUFFICIENT' : 'NOT_PROMOTED',
      detail: `Failed: ${failed.join(',')}`,
      checks,
    };
  }
  return {
    eligible: true,
    code: 'PROMOTED_ELIGIBLE',
    detail: 'Meets institutional promotion criteria (≥ 6-gate floor)',
    checks,
  };
}
