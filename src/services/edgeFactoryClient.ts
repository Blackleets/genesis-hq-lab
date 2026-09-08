export type EdgeMetrics = {
  trades?: number;
  expectancyBps?: number | null;
  profitFactor?: number | null;
  tStat?: number | null;
  maxDrawdownPct?: number | null;
};

export type EdgeFactoryCandidate = {
  hypothesisKey: string;
  variantKey?: string;
  status: 'PAPER_CANDIDATE' | 'INTERESTING' | 'REGIME_DIVERGENCE' | 'DEAD' | 'KILLED';
  failureStreak?: number;
  failureReason?: string | null;
  market: { pair: string; tf: string };
  candidate: { family: string; period: number; targetAtr: number; stopAtr: number; timeoutBars: number; session: string };
  train?: EdgeMetrics;
  validation?: EdgeMetrics;
  holdout?: EdgeMetrics;
  walkForward?: { positiveFolds: number; requiredPositiveFolds: number; pass: boolean };
};

export type EdgeLearningRule = {
  hypothesisKey: string;
  total: number;
  interesting: number;
  regimeDivergence: number;
  paper: number;
  dominantFailure: string | null;
  action: 'PROMOTE_TO_FORWARD_PAPER' | 'MUTATE_AND_RETEST' | 'RETEST_ONLY_IF_REGIME_CHANGES' | 'DEPRIORITIZE';
};

export type EdgeLearningSnapshot = {
  ok: boolean;
  version: string;
  paperOnly: boolean;
  liveOrders: boolean;
  executionAuthority: boolean;
  capitalEligible: boolean;
  completedAt: string | null;
  summary: { hypotheses: number; paperCandidates: number; interesting: number; regimeDivergence: number; killed: number };
  rules: EdgeLearningRule[];
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
  regimeDivergence?: number;
  paperCandidates: number;
  verdict: string;
  methodology?: { barsPerMarket?: number; families?: string[]; sessions?: string[]; killAfterFailures?: number; classification?: string };
  top: EdgeFactoryCandidate[];
  nextGeneration?: Array<{ parent: string; mutation: string }>;
};

const FACTORY_URL = 'https://raw.githubusercontent.com/Blackleets/genesis-hq-lab/capture-tape/quant-evidence/edge-factory-latest.json';
const LEARNING_URL = 'https://raw.githubusercontent.com/Blackleets/genesis-hq-lab/capture-tape/quant-evidence/edge-learning-latest.json';

function assertBoundary(data: { paperOnly?: boolean; liveOrders?: boolean; executionAuthority?: boolean; capitalEligible?: boolean }) {
  if (data?.paperOnly !== true || data?.liveOrders !== false || data?.executionAuthority !== false || data?.capitalEligible !== false) {
    throw new Error('edge_factory_boundary_unverified');
  }
}

export async function fetchEdgeFactory(signal?: AbortSignal): Promise<EdgeFactorySnapshot> {
  const response = await fetch(`${FACTORY_URL}?t=${Date.now()}`, { cache: 'no-store', signal });
  if (!response.ok) throw new Error(`edge_factory_http_${response.status}`);
  const data = await response.json() as EdgeFactorySnapshot;
  assertBoundary(data);
  return { ...data, top: Array.isArray(data.top) ? data.top.slice(0, 5) : [], nextGeneration: Array.isArray(data.nextGeneration) ? data.nextGeneration.slice(0, 3) : [] };
}

export async function fetchEdgeLearning(signal?: AbortSignal): Promise<EdgeLearningSnapshot> {
  const response = await fetch(`${LEARNING_URL}?t=${Date.now()}`, { cache: 'no-store', signal });
  if (!response.ok) throw new Error(`edge_learning_http_${response.status}`);
  const data = await response.json() as EdgeLearningSnapshot;
  assertBoundary(data);
  return { ...data, rules: Array.isArray(data.rules) ? data.rules.slice(0, 5) : [] };
}
