export type PositioningDataQuality = {
  schemaVersion: number;
  mode: 'RESEARCH_ONLY';
  researchUse: string;
  eligibleRowCount: number;
  independentRowCount: number;
  effectiveIndependentRatio: number;
  qualityPass: boolean;
  defects: {
    duplicateCloseTimes: number;
    nonCausalSequence: number;
    overlappingWindows: number;
    excessiveGaps: number;
  };
  readiness?: {
    minimumIndependentRows: number;
    remainingIndependentRows: number;
    readyForPredeclaredStudy: boolean;
    holdoutStillSealed: boolean;
    rankingAllowed: boolean;
  };
  lastEligibleCapturedAt?: string | null;
};

export type PositioningCandidateMetrics = {
  trades: number;
  expectancyBps: number | null;
  profitFactor: number | null;
  tStat: number | null;
  maxDrawdownPct: number | null;
};

export type PositioningCandidate = {
  family: string;
  description: string;
  train: PositioningCandidateMetrics;
  validation: PositioningCandidateMetrics;
  walkForward: { pass: boolean };
  status: 'RESEARCH_CANDIDATE' | 'REJECTED';
};

export type PositioningEdgeSnapshot = {
  ok: boolean;
  version: string;
  mode: 'RESEARCH_ONLY';
  paperOnly: true;
  liveOrders: false;
  executionAuthority: false;
  capitalEligible: false;
  verdict: 'DATA_NOT_READY' | 'NO_EDGE_FOUND' | 'RESEARCH_CANDIDATE_FOUND' | string;
  methodology: {
    selectionUsesHoldout: false;
    holdoutSealed: true;
    minIndependentRows: number;
    stressedCostBps: number;
    walkForwardFolds?: number;
  };
  dataQuality?: {
    qualityPass: boolean;
    independentRowCount: number;
    required?: number;
    usableForwardSamples?: number;
  };
  candidates?: PositioningCandidate[];
  survivors?: PositioningCandidate[];
  holdoutOpened?: boolean;
};

const QUALITY_URL = 'https://raw.githubusercontent.com/Blackleets/genesis-hq-lab/capture-tape/paper-tape/positioning-data-quality-latest.json';
const EDGE_URL = 'https://raw.githubusercontent.com/Blackleets/genesis-hq-lab/capture-tape/quant-evidence/positioning-edge-factory-latest.json';

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store', signal });
  if (!response.ok) throw new Error(`positioning_research_http_${response.status}`);
  return response.json() as Promise<T>;
}

export async function fetchPositioningResearch(signal?: AbortSignal): Promise<{ quality: PositioningDataQuality; edge: PositioningEdgeSnapshot }> {
  const [quality, edge] = await Promise.all([
    fetchJson<PositioningDataQuality>(QUALITY_URL, signal),
    fetchJson<PositioningEdgeSnapshot>(EDGE_URL, signal),
  ]);

  if (quality.mode !== 'RESEARCH_ONLY') throw new Error('positioning_quality_boundary_unverified');
  if (
    edge.mode !== 'RESEARCH_ONLY'
    || edge.paperOnly !== true
    || edge.liveOrders !== false
    || edge.executionAuthority !== false
    || edge.capitalEligible !== false
    || edge.methodology?.selectionUsesHoldout !== false
    || edge.methodology?.holdoutSealed !== true
  ) throw new Error('positioning_edge_boundary_unverified');

  return { quality, edge };
}
