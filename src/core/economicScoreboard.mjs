export const ECONOMIC_SCOREBOARD_VERSION = 'genesis_economic_scoreboard_v1';

export const ECONOMIC_GATES = Object.freeze({
  minForwardTrades: 20,
  minExpectancyBps: 0,
  minProfitFactor: 1.20,
  minTStat: 1.0,
  maxDrawdownPct: 12,
  selfFundingSafetyMultiple: 1.5,
  minCompanyPnlWindowDays: 28,
  maxCompanyPnlWindowDays: 31,
});

const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null;

function normalizeMetrics(metrics = {}) {
  return {
    trades: finite(metrics.trades),
    expectancyBps: finite(metrics.expectancyBps),
    profitFactor: finite(metrics.profitFactor),
    tStat: finite(metrics.tStat),
    maxDrawdownPct: finite(metrics.maxDrawdownPct),
  };
}

export function evaluateForwardChampion(metrics, gates = ECONOMIC_GATES) {
  const m = normalizeMetrics(metrics);
  const checks = {
    sample: m.trades != null && m.trades >= gates.minForwardTrades,
    expectancy: m.expectancyBps != null && m.expectancyBps > gates.minExpectancyBps,
    profitFactor: m.profitFactor != null && m.profitFactor >= gates.minProfitFactor,
    tStat: m.tStat != null && m.tStat >= gates.minTStat,
    drawdown: m.maxDrawdownPct != null && m.maxDrawdownPct <= gates.maxDrawdownPct,
  };
  const passed = Object.values(checks).filter(Boolean).length;
  return {
    metrics: m,
    checks,
    passed,
    required: Object.keys(checks).length,
    proven: Object.values(checks).every(Boolean),
  };
}

function candidateRank(family, gates) {
  const evaluation = evaluateForwardChampion(family?.championForward ?? {}, gates);
  const metrics = evaluation.metrics;
  return {
    family,
    evaluation,
    score: evaluation.passed * 1_000_000
      + (metrics.trades ?? 0) * 1_000
      + (metrics.profitFactor ?? 0) * 100
      + (metrics.expectancyBps ?? -10_000),
  };
}

export function selectBestForwardFamily(forward, gates = ECONOMIC_GATES) {
  const families = Array.isArray(forward?.families) ? forward.families : [];
  if (!families.length) return null;
  return families
    .map((family) => candidateRank(family, gates))
    .sort((a, b) => b.score - a.score)[0];
}

export function buildEconomicScoreboard(input = {}, gates = ECONOMIC_GATES) {
  const edgeFactory = input.edgeFactory ?? null;
  const forward = input.forward ?? null;
  const runner = input.runner ?? null;
  const monthlyOperatingCostUsd = finite(input.monthlyOperatingCostUsd);
  const reconciledCompanyPnlUsd = finite(input.reconciledCompanyPnlUsd);
  const reconciledCompanyPnlWindowDays = finite(input.reconciledCompanyPnlWindowDays);
  const best = selectBestForwardFamily(forward, gates);
  const forwardEvaluation = best?.evaluation ?? null;

  let edgeVerdict = 'EVIDENCE_INCOMPLETE';
  if (forward && best) {
    if ((forwardEvaluation?.metrics.trades ?? 0) < gates.minForwardTrades) edgeVerdict = 'FORWARD_EVIDENCE_ACCUMULATING';
    else if (forwardEvaluation?.proven) edgeVerdict = 'EDGE_PROVEN_PAPER';
    else edgeVerdict = 'NO_EDGE_PROVEN';
  } else if (edgeFactory && Number(edgeFactory.paperCandidates ?? 0) > 0) {
    edgeVerdict = 'RESEARCH_CANDIDATES_ONLY';
  }

  let selfFundingVerdict = 'EDGE_REQUIRED';
  let coverageRatio = null;
  const costBasisReady = monthlyOperatingCostUsd != null && monthlyOperatingCostUsd > 0;
  const companyPnlReady = reconciledCompanyPnlUsd != null;
  const windowReady = reconciledCompanyPnlWindowDays != null
    && reconciledCompanyPnlWindowDays >= gates.minCompanyPnlWindowDays
    && reconciledCompanyPnlWindowDays <= gates.maxCompanyPnlWindowDays;

  if (!costBasisReady) selfFundingVerdict = 'COST_BASIS_MISSING';
  else if (!companyPnlReady) selfFundingVerdict = 'PNL_RECONCILIATION_REQUIRED';
  else if (!windowReady) selfFundingVerdict = 'PNL_WINDOW_MISMATCH';
  else if (edgeVerdict !== 'EDGE_PROVEN_PAPER') selfFundingVerdict = 'EDGE_REQUIRED';
  else {
    coverageRatio = reconciledCompanyPnlUsd / monthlyOperatingCostUsd;
    selfFundingVerdict = coverageRatio >= gates.selfFundingSafetyMultiple
      ? 'PAYS_FOR_ITSELF_PAPER'
      : 'NOT_SELF_FUNDING';
  }

  const runnerStats = runner?.stats ?? null;
  return {
    version: ECONOMIC_SCOREBOARD_VERSION,
    mode: 'PAPER_EVIDENCE_ONLY',
    paperOnly: true,
    liveOrders: false,
    executionAuthority: false,
    capitalEligible: false,
    liveEligible: false,
    edgeVerdict,
    selfFundingVerdict,
    gates,
    bestForwardFamily: best ? {
      familyKey: best.family?.familyKey ?? null,
      championId: best.family?.championId ?? null,
      evidenceStatus: best.family?.championEvidenceStatus ?? null,
      forwardGate: best.family?.forwardGate ?? null,
      evaluation: best.evaluation,
    } : null,
    research: edgeFactory ? {
      tested: finite(edgeFactory.tested),
      paperCandidates: finite(edgeFactory.paperCandidates),
      killed: finite(edgeFactory.killed),
      verdict: edgeFactory.verdict ?? null,
    } : null,
    paperRunner: runnerStats ? {
      closed: finite(runnerStats.sampleClosed),
      realizedPnlUsd: finite(runnerStats.sampleRealizedPnl),
      expectancyUsd: finite(runnerStats.expectancy),
      profitFactor: finite(runnerStats.profitFactor),
      maxDrawdownUsd: finite(runnerStats.maxDrawdown),
      windowLimit: finite(runnerStats.windowLimit),
    } : null,
    economics: {
      monthlyOperatingCostUsd,
      reconciledCompanyPnlUsd,
      reconciledCompanyPnlWindowDays,
      costBasisReady,
      companyPnlReady,
      windowReady,
      coverageRatio,
      requiredCoverageRatio: gates.selfFundingSafetyMultiple,
    },
    invariants: {
      sumsUnreconciledSleeves: false,
      promotesFromFastResearch: false,
      unlocksLive: false,
      changesStrategyParameters: false,
    },
  };
}
