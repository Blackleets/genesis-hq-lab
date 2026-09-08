export type EdgeMetrics = {
  trades?: number;
  expectancyBps?: number | null;
  profitFactor?: number | null;
  tStat?: number | null;
  maxDrawdownPct?: number | null;
};

export type EdgeFactoryCandidate = {
  hypothesisKey: string;
  status: 'PAPER_CANDIDATE' | 'INTERESTING' | 'DEAD' | 'KILLED';
  failureStreak?: number;
  market: { pair: string; tf: string };
  candidate: { family: string; period: number; targetAtr: number; stopAtr: number; timeoutBars: number; session: string };
  train?: EdgeMetrics;
  validation?: EdgeMetrics;
  holdout?: EdgeMetrics;
  walkForward?: { positiveFolds: number; requiredPositiveFolds: number; pass: boolean };
};

export type EdgeFactorySnapshot = {
  ok: boolean;
  version: string;
  mode: string;
  paperOnly: boolean;
  liveOrders: boolean;
  executionAuthority: boolean;
  capitalEligible: boolean;
  completedAt: string | null;
  tested: number;
  killed: number;
  interesting: number;
  paperCandidates: number;
  verdict: string;
  methodology?: { barsPerMarket?: number; families?: string[]; sessions?: string[]; killAfterFailures?: number };
  top: EdgeFactoryCandidate[];
  nextGeneration?: Array<{ parent: string; mutation: string }>;
};

const URL = 'https://raw.githubusercontent.com/Blackleets/genesis-hq-lab/capture-tape/quant-evidence/edge-factory-latest.json';

export async function fetchEdgeFactory(signal?: AbortSignal): Promise<EdgeFactorySnapshot> {
  const response = await fetch(`${URL}?t=${Date.now()}`, { cache: 'no-store', signal });
  if (!response.ok) throw new Error(`edge_factory_http_${response.status}`);
  const data = await response.json() as EdgeFactorySnapshot;
  if (data?.paperOnly !== true || data?.liveOrders !== false || data?.executionAuthority !== false || data?.capitalEligible !== false) {
    throw new Error('edge_factory_boundary_unverified');
  }
  return { ...data, top: Array.isArray(data.top) ? data.top.slice(0, 5) : [], nextGeneration: Array.isArray(data.nextGeneration) ? data.nextGeneration.slice(0, 3) : [] };
}
