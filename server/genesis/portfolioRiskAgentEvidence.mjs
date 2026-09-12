function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function compactResearchLifecycleForward(forward) {
  if (!forward) return null;
  if (
    forward.mode !== 'FORWARD_PAPER_RESEARCH'
    || forward.paperOnly !== true
    || forward.liveOrders !== false
    || forward.executionAuthority !== false
    || forward.capitalEligible !== false
    || forward.boundaries?.realOrdersPlaced !== false
    || forward.boundaries?.liveTradingEnabled !== false
    || forward.boundaries?.changesRiskGates !== false
  ) throw new Error('paper_swarm_research_forward_boundary_failed');
  return {
    ts: forward.completedAt ?? null,
    version: forward.version ?? null,
    mode: forward.mode,
    registeredEligible: finite(forward.registeredEligible),
    enrolled: finite(forward.enrolled),
    openSignals: finite(forward.openSignals),
    nextStageEligible: finite(forward.nextStageEligible),
    candidates: Array.isArray(forward.candidates) ? forward.candidates.slice(0, 8).map((candidate) => ({
      id: candidate.id ?? null,
      laneType: candidate.laneType ?? null,
      symbol: candidate.symbol ?? null,
      family: candidate.family ?? null,
      evidenceStatus: candidate.evidenceStatus ?? null,
      baseTrades: finite(candidate?.forwardBase12Bps?.trades),
      baseExpectancyBps: finite(candidate?.forwardBase12Bps?.expectancyBps),
      baseProfitFactor: finite(candidate?.forwardBase12Bps?.profitFactor),
      baseTStat: finite(candidate?.forwardBase12Bps?.tStat),
      baseMaxDrawdownPct: finite(candidate?.forwardBase12Bps?.maxDrawdownPct),
      stressExpectancyBps: finite(candidate?.forwardStress18Bps?.expectancyBps),
      nextStageEligible: candidate.nextStageEligible === true,
      liveEligible: false,
      executionAuthority: false,
      capitalEligible: false,
    })) : [],
  };
}

export function compactPortfolioRisk(portfolio) {
  if (!portfolio) return null;
  if (
    portfolio.mode !== 'PORTFOLIO_RISK_RESEARCH'
    || portfolio.paperOnly !== true
    || portfolio.liveOrders !== false
    || portfolio.executionAuthority !== false
    || portfolio.capitalEligible !== false
    || portfolio.methodology?.cumulativeTradeReturnIsNotPortfolioReturn !== true
    || portfolio.methodology?.changesProductionRiskGates !== false
    || portfolio.methodology?.optimizationOrRanking !== false
    || portfolio.regimeSizing?.usedForSizing !== false
    || portfolio.boundaries?.realOrdersPlaced !== false
    || portfolio.boundaries?.liveTradingEnabled !== false
    || portfolio.boundaries?.changesRiskGates !== false
    || portfolio.boundaries?.writesExecutionState !== false
    || portfolio.boundaries?.grantsCapitalEligibility !== false
  ) throw new Error('paper_swarm_portfolio_boundary_failed');
  return {
    ts: portfolio.completedAt ?? null,
    version: portfolio.version ?? null,
    mode: portfolio.mode,
    status: portfolio.status ?? 'UNAVAILABLE',
    admittedCandidates: finite(portfolio?.source?.admittedCandidates),
    base: {
      trades: finite(portfolio?.realized?.base12Bps?.tradeCount),
      portfolioReturnPct: finite(portfolio?.realized?.base12Bps?.portfolioReturnPct),
      maxDrawdownPct: finite(portfolio?.realized?.base12Bps?.maxDrawdownPct),
    },
    stressed: {
      trades: finite(portfolio?.realized?.stress18Bps?.tradeCount),
      portfolioReturnPct: finite(portfolio?.realized?.stress18Bps?.portfolioReturnPct),
      maxDrawdownPct: finite(portfolio?.realized?.stress18Bps?.maxDrawdownPct),
    },
    concurrency: {
      peakConcurrentCandidates: finite(portfolio?.concurrency?.peakConcurrentCandidates),
      peakGrossExposurePct: finite(portfolio?.concurrency?.peakGrossExposurePct),
      peakSymbolExposurePct: finite(portfolio?.concurrency?.peakSymbolExposurePct),
      peakFamilyExposurePct: finite(portfolio?.concurrency?.peakFamilyExposurePct),
    },
    covariance: {
      bucketCount: finite(portfolio?.covariance?.bucketCount),
      portfolioBucketStdBps: finite(portfolio?.covariance?.portfolioBucketStdBps),
      status: portfolio?.covariance?.status ?? null,
    },
    openScenarios: {
      status: portfolio?.openScenarios?.status ?? null,
      openSignals: finite(portfolio?.openScenarios?.openSignals),
      scenarios: Array.isArray(portfolio?.openScenarios?.scenarios) ? portfolio.openScenarios.scenarios.slice(0, 4).map((scenario) => ({
        id: scenario.id ?? null,
        shockBps: finite(scenario.shockBps),
        portfolioPnlPct: finite(scenario.portfolioPnlPct),
      })) : [],
    },
    regimeSizing: { status: portfolio?.regimeSizing?.status ?? 'UNAVAILABLE', usedForSizing: false },
    liveEligible: false,
    executionAuthority: false,
    capitalEligible: false,
  };
}

export function lifecycleForwardSummary(lifecycle) {
  if (!lifecycle) return 'Issue-72 forward lifecycle unavailable.';
  return `Issue-72 forward: enrolled=${lifecycle.enrolled ?? 'NA'}; nextStageEligible=${lifecycle.nextStageEligible ?? 'NA'}; openSignals=${lifecycle.openSignals ?? 'NA'}`;
}

export function portfolioRiskSummary(portfolio) {
  if (!portfolio) return 'Portfolio risk evidence unavailable.';
  return `Portfolio risk: status=${portfolio.status}; admitted=${portfolio.admittedCandidates ?? 'NA'}; trades=${portfolio.base.trades ?? 'NA'}; return=${portfolio.base.portfolioReturnPct ?? 'NA'}%; DD=${portfolio.base.maxDrawdownPct ?? 'NA'}%; stressReturn=${portfolio.stressed.portfolioReturnPct ?? 'NA'}%; covarianceBuckets=${portfolio.covariance.bucketCount ?? 'NA'}`;
}

export function portfolioRiskBlocker(lifecycle, portfolio) {
  const nextStageEligible = Number(lifecycle?.nextStageEligible ?? 0);
  if (!(nextStageEligible > 0)) return null;
  if (!portfolio) return 'PORTFOLIO_RISK_UNVERIFIED';
  if (portfolio.status !== 'PORTFOLIO_RESEARCH_READY') return 'PORTFOLIO_RISK_NOT_READY';
  return null;
}
