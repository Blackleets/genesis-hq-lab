export const INSTITUTIONAL_EDGE_ALLOCATOR_VERSION = 'institutional_edge_allocator_v1';

export const DEFAULT_ALLOCATOR_GATES = Object.freeze({
  minSamples: 20,
  minExpectancyBps: 0,
  minProfitFactor: 1.10,
  minTStat: 0.75,
  maxDrawdownPct: 12,
  minEvidenceQuality: 0.60,
});

const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const clamp = (value, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, value));

export function evaluateSleeve(sleeve = {}, gates = DEFAULT_ALLOCATOR_GATES) {
  const metrics = {
    samples: finite(sleeve.samples ?? sleeve.trades),
    expectancyBps: finite(sleeve.expectancyBps),
    profitFactor: finite(sleeve.profitFactor),
    tStat: finite(sleeve.tStat),
    maxDrawdownPct: finite(sleeve.maxDrawdownPct),
    evidenceQuality: finite(sleeve.evidenceQuality),
  };
  const checks = {
    sample: metrics.samples != null && metrics.samples >= gates.minSamples,
    expectancy: metrics.expectancyBps != null && metrics.expectancyBps > gates.minExpectancyBps,
    profitFactor: metrics.profitFactor != null && metrics.profitFactor >= gates.minProfitFactor,
    tStat: metrics.tStat != null && metrics.tStat >= gates.minTStat,
    drawdown: metrics.maxDrawdownPct != null && metrics.maxDrawdownPct <= gates.maxDrawdownPct,
    evidence: metrics.evidenceQuality != null && metrics.evidenceQuality >= gates.minEvidenceQuality,
    paperEligibility: sleeve.paperCapitalEligible !== false,
  };
  const qualified = Object.values(checks).every(Boolean) && sleeve.killed !== true;
  const evidenceFactor = clamp(metrics.evidenceQuality ?? 0);
  const ddPenalty = metrics.maxDrawdownPct == null ? 0 : clamp(1 - metrics.maxDrawdownPct / Math.max(gates.maxDrawdownPct, 1));
  const pfBoost = metrics.profitFactor == null ? 0 : clamp((metrics.profitFactor - 1) / 1.5);
  const tBoost = metrics.tStat == null ? 0 : clamp(metrics.tStat / 3);
  const expectancy = Math.max(0, metrics.expectancyBps ?? 0);
  const robustScore = qualified
    ? expectancy * (0.45 + 0.55 * evidenceFactor) * (0.35 + 0.65 * ddPenalty) * (0.5 + 0.25 * pfBoost + 0.25 * tBoost)
    : 0;
  return { sleeveKey: sleeve.sleeveKey ?? 'UNKNOWN', metrics, checks, qualified, robustScore, killed: sleeve.killed === true, reason: qualified ? 'QUALIFIED_FOR_PAPER_ALLOCATION' : 'EVIDENCE_GATE_NOT_MET' };
}

export function allocatePaperCapital(sleeves = [], options = {}) {
  const totalPaperCapitalUsd = finite(options.totalPaperCapitalUsd) ?? 10_000;
  const gates = options.gates ?? DEFAULT_ALLOCATOR_GATES;
  const evaluations = sleeves.map((sleeve) => ({ sleeve, evaluation: evaluateSleeve(sleeve, gates) }));
  const qualified = evaluations.filter((row) => row.evaluation.qualified && row.evaluation.robustScore > 0);
  const totalScore = qualified.reduce((sum, row) => sum + row.evaluation.robustScore, 0);
  const allocations = evaluations.map(({ sleeve, evaluation }) => {
    const weight = evaluation.qualified && totalScore > 0 ? evaluation.robustScore / totalScore : 0;
    return {
      sleeveKey: evaluation.sleeveKey,
      engineVersion: sleeve.engineVersion ?? null,
      qualified: evaluation.qualified,
      reason: evaluation.reason,
      robustScore: Number(evaluation.robustScore.toFixed(6)),
      paperWeight: Number(weight.toFixed(6)),
      paperCapitalUsd: Number((weight * totalPaperCapitalUsd).toFixed(2)),
      metrics: evaluation.metrics,
      checks: evaluation.checks,
    };
  });
  const allocatedWeight = allocations.reduce((sum, row) => sum + row.paperWeight, 0);
  const cashWeight = Math.max(0, 1 - allocatedWeight);
  return {
    version: INSTITUTIONAL_EDGE_ALLOCATOR_VERSION,
    mode: 'PAPER_ONLY',
    paperOnly: true,
    executionAuthority: false,
    liveLocked: true,
    totalPaperCapitalUsd,
    qualifiedSleeves: allocations.filter((row) => row.qualified).length,
    allocations,
    cashReserve: {
      paperWeight: Number(cashWeight.toFixed(6)),
      paperCapitalUsd: Number((cashWeight * totalPaperCapitalUsd).toFixed(2)),
      reason: qualified.length ? 'UNALLOCATED_ROUNDING_OR_RISK_BUFFER' : 'NO_SLEEVE_HAS_PROVEN_EDGE',
    },
    invariants: {
      forcesTrading: false,
      fabricatesPnL: false,
      unlocksLive: false,
      signsTransactions: false,
      broadcastsTransactions: false,
    },
  };
}
