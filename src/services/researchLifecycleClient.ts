const ROOT = 'https://raw.githubusercontent.com/Blackleets/genesis-hq-lab/capture-tape/quant-evidence';
const PROMOTION_URL = `${ROOT}/research-promotion-latest.json`;
const FORWARD_URL = `${ROOT}/research-forward-shadow-latest.json`;

export type ResearchPromotionIntake = {
  laneType: 'POSITIONING' | 'CROSS_MARKET' | string;
  symbol: string;
  state: string;
  usableSamples: number | null;
  required: number | null;
  laneKey: string | null;
};

export type ResearchPromotionSnapshot = {
  ok: boolean;
  version: string;
  mode: 'RESEARCH_ONLY';
  paperOnly: true;
  liveOrders: false;
  executionAuthority: false;
  capitalEligible: false;
  completedAt: string | null;
  methodology: {
    oneChampionPerLaneCohort?: boolean;
    championSelectedBeforeHoldout?: boolean;
    holdoutOneShot?: boolean;
    sameActiveCohortCannotReopenHoldout?: boolean;
    minimumUsableSamplesBeforeAudit?: number;
    stressCostBps?: number;
    auditPassDoesNotAutoEnrollForward?: boolean;
    promotionNeverAutomaticToLive?: boolean;
  };
  intake: ResearchPromotionIntake[];
  newAudits: number;
  newForwardPaperEligible: number;
  totalForwardPaperEligible: number;
  totalAuditedLaneCohorts: number;
  waitingLanes: number;
  verdict: string;
  boundaries: {
    realOrdersPlaced: false;
    liveTradingEnabled: false;
    riskGatesChanged: false;
    forwardAutoEnrollment: false;
  };
};

export type ResearchForwardCandidate = {
  id?: string;
  laneType?: string;
  symbol?: string;
  family?: string;
  status?: string;
  trades?: number;
  expectancyBps?: number | null;
  profitFactor?: number | null;
  tStat?: number | null;
  maxDrawdownPct?: number | null;
  nextStageEligible?: boolean;
};

export type ResearchForwardSnapshot = {
  ok: boolean;
  version: string;
  mode: 'FORWARD_PAPER_RESEARCH';
  paperOnly: true;
  liveOrders: false;
  executionAuthority: false;
  capitalEligible: false;
  completedAt: string | null;
  registeredEligible: number;
  enrolled: number;
  newlyEnrolled: number;
  processedRows: number;
  openSignals: number;
  nextStageEligible: number;
  candidates: ResearchForwardCandidate[];
  methodology: {
    noHistoricalBackfill?: boolean;
    enrollmentBaselineIsLatestDurableObservation?: boolean;
    postEnrollmentObservationsOnly?: boolean;
    promotionNeverAutomaticToLive?: boolean;
    forwardGate?: {
      minTrades?: number;
      minExpectancyBps?: number;
      minProfitFactor?: number;
      minTStat?: number;
      maxDrawdownPct?: number;
    };
  };
  boundaries: {
    realOrdersPlaced: false;
    liveTradingEnabled: false;
    changesRiskGates: false;
  };
};

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store', signal });
  if (!response.ok) throw new Error(`research_lifecycle_http_${response.status}`);
  return response.json() as Promise<T>;
}

function assertPromotionBoundary(x: ResearchPromotionSnapshot) {
  if (
    x.mode !== 'RESEARCH_ONLY'
    || x.paperOnly !== true
    || x.liveOrders !== false
    || x.executionAuthority !== false
    || x.capitalEligible !== false
    || x.boundaries?.realOrdersPlaced !== false
    || x.boundaries?.liveTradingEnabled !== false
    || x.boundaries?.riskGatesChanged !== false
    || x.boundaries?.forwardAutoEnrollment !== false
    || x.methodology?.holdoutOneShot !== true
    || x.methodology?.promotionNeverAutomaticToLive !== true
  ) throw new Error('research_promotion_boundary_unverified');
}

function assertForwardBoundary(x: ResearchForwardSnapshot) {
  if (
    x.mode !== 'FORWARD_PAPER_RESEARCH'
    || x.paperOnly !== true
    || x.liveOrders !== false
    || x.executionAuthority !== false
    || x.capitalEligible !== false
    || x.boundaries?.realOrdersPlaced !== false
    || x.boundaries?.liveTradingEnabled !== false
    || x.boundaries?.changesRiskGates !== false
    || x.methodology?.noHistoricalBackfill !== true
    || x.methodology?.postEnrollmentObservationsOnly !== true
    || x.methodology?.promotionNeverAutomaticToLive !== true
  ) throw new Error('research_forward_boundary_unverified');
}

export async function fetchResearchLifecycle(signal?: AbortSignal): Promise<{
  promotion: ResearchPromotionSnapshot;
  forward: ResearchForwardSnapshot;
}> {
  const [promotion, forward] = await Promise.all([
    fetchJson<ResearchPromotionSnapshot>(PROMOTION_URL, signal),
    fetchJson<ResearchForwardSnapshot>(FORWARD_URL, signal),
  ]);
  assertPromotionBoundary(promotion);
  assertForwardBoundary(forward);
  return { promotion, forward };
}
