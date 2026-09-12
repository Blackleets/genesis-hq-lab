const ROOT = 'https://raw.githubusercontent.com/Blackleets/genesis-hq-lab/capture-tape/quant-evidence';
const PORTFOLIO_RISK_URL = `${ROOT}/portfolio-risk-research-latest.json`;

export type PortfolioRiskResearchSnapshot = {
  ok: boolean;
  version: string;
  mode: 'PORTFOLIO_RISK_RESEARCH';
  paperOnly: true;
  liveOrders: false;
  executionAuthority: false;
  capitalEligible: false;
  status: 'NO_FORWARD_GATE_PASS_CANDIDATES' | 'PORTFOLIO_EVIDENCE_BUILDING' | 'PORTFOLIO_RESEARCH_READY' | string;
  completedAt: string | null;
  source: {
    forwardVersion?: string | null;
    forwardCompletedAt?: string | null;
    admittedRule?: string;
    admittedCandidates: number;
    invalidClosedTradesIgnored?: number;
  };
  methodology: {
    weighting?: string;
    portfolioReturn?: string;
    cumulativeTradeReturnIsNotPortfolioReturn?: boolean;
    covariance?: string;
    covarianceBucketMs?: number;
    baseCostBps?: number;
    stressCostBps?: number;
    changesProductionRiskGates?: boolean;
    optimizationOrRanking?: boolean;
  };
  realized: {
    base12Bps: {
      candidateCount: number;
      tradeCount: number;
      cumulativeTradeReturnPct: number;
      portfolioReturnPct: number;
      maxDrawdownPct: number;
      weightPerCandidatePct: number;
    };
    stress18Bps: {
      candidateCount: number;
      tradeCount: number;
      cumulativeTradeReturnPct: number;
      portfolioReturnPct: number;
      maxDrawdownPct: number;
      weightPerCandidatePct: number;
    };
  };
  concurrency: {
    peakConcurrentTrades: number;
    peakConcurrentCandidates: number;
    peakGrossExposurePct: number;
    peakSymbolExposurePct: number;
    peakFamilyExposurePct: number;
  };
  covariance: {
    bucketMs?: number;
    bucketCount: number;
    portfolioBucketStdBps: number | null;
    status?: string;
  };
  regimeSizing: {
    status: string;
    reason?: string;
    usedForSizing: false;
  };
  boundaries: {
    realOrdersPlaced: false;
    liveTradingEnabled: false;
    changesRiskGates: false;
    writesExecutionState: false;
    grantsCapitalEligibility: false;
  };
};

function assertPortfolioRiskBoundary(x: PortfolioRiskResearchSnapshot) {
  if (
    x.mode !== 'PORTFOLIO_RISK_RESEARCH'
    || x.paperOnly !== true
    || x.liveOrders !== false
    || x.executionAuthority !== false
    || x.capitalEligible !== false
    || x.methodology?.cumulativeTradeReturnIsNotPortfolioReturn !== true
    || x.methodology?.changesProductionRiskGates !== false
    || x.methodology?.optimizationOrRanking !== false
    || x.regimeSizing?.usedForSizing !== false
    || x.boundaries?.realOrdersPlaced !== false
    || x.boundaries?.liveTradingEnabled !== false
    || x.boundaries?.changesRiskGates !== false
    || x.boundaries?.writesExecutionState !== false
    || x.boundaries?.grantsCapitalEligibility !== false
  ) throw new Error('portfolio_risk_research_boundary_unverified');
}

export async function fetchPortfolioRiskResearch(signal?: AbortSignal): Promise<PortfolioRiskResearchSnapshot> {
  const response = await fetch(`${PORTFOLIO_RISK_URL}?t=${Date.now()}`, { cache: 'no-store', signal });
  if (!response.ok) throw new Error(`portfolio_risk_research_http_${response.status}`);
  const payload = await response.json() as PortfolioRiskResearchSnapshot;
  assertPortfolioRiskBoundary(payload);
  return payload;
}
