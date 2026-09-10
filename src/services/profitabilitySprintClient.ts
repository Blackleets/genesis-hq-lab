export type ProfitabilityMetrics = {
  trades: number;
  winRate: number | null;
  netReturnPct: number | null;
  expectancyBps: number | null;
  profitFactor: number | null;
  tStat: number | null;
  maxDrawdownPct: number | null;
};

export type ProfitabilityCandidate = {
  id: string;
  params: {
    family: string;
    period: number;
    targetAtr: number;
    stopAtr: number;
    timeoutBars: number;
  };
  pass: boolean;
  score: number;
  train: ProfitabilityMetrics;
  validation: ProfitabilityMetrics;
  holdout: ProfitabilityMetrics;
  walkForward: {
    positiveFolds: number;
    requiredPositiveFolds: number;
    pass: boolean;
  };
};

export type ProfitabilitySprintSnapshot = {
  ok: boolean;
  version: string;
  mode: string;
  source: string;
  paperOnly: boolean;
  liveOrders: boolean;
  executionAuthority: boolean;
  capitalEligible: boolean;
  startedAt: string | null;
  completedAt: string | null;
  candidateCount: number;
  survivorCount: number;
  verdict: string;
  methodology?: {
    barsPerMarketTarget?: number;
    gates?: {
      validationProfitFactor?: number;
      holdoutProfitFactor?: number;
      holdoutTStat?: number;
      maxHoldoutDrawdownPct?: number;
      walkForwardPositiveFolds?: string;
    };
  };
  topCandidates: ProfitabilityCandidate[];
};

const URL = 'https://raw.githubusercontent.com/Blackleets/genesis-hq-lab/capture-tape/quant-evidence/profitability-sprint-latest.json';

export async function fetchProfitabilitySprint(signal?: AbortSignal): Promise<ProfitabilitySprintSnapshot> {
  const response = await fetch(`${URL}?t=${Date.now()}`, { cache: 'no-store', signal });
  if (!response.ok) throw new Error(`profitability_sprint_http_${response.status}`);
  const data = await response.json() as ProfitabilitySprintSnapshot;
  const boundaryVerified = data?.paperOnly === true
    && data?.liveOrders === false
    && data?.executionAuthority === false
    && data?.capitalEligible === false;
  if (!boundaryVerified) throw new Error('profitability_sprint_boundary_unverified');
  return {
    ...data,
    topCandidates: Array.isArray(data.topCandidates) ? data.topCandidates.slice(0, 3) : [],
  };
}
