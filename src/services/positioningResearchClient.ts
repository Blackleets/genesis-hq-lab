export type PositioningDataQuality = {
  schemaVersion: number;
  mode: 'RESEARCH_ONLY';
  researchUse: string;
  symbol?: string;
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
  symbol?: string;
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
    symbolIsolation?: boolean;
    activeQualityCohortOnly?: boolean;
    strictMissingNumericEvidence?: boolean;
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

export type PositioningUniverseProbe = {
  schemaVersion: number;
  mode: 'RESEARCH_ONLY';
  provider: string;
  requestedSymbols: string[];
  usableSymbols: string[];
  excludedSymbols: string[];
  completedAt: string | null;
  policy: {
    missingDimensionExcludesSymbol: true;
    substitutionsAllowed: false;
    admissionDoesNotImplyEdge: true;
  };
  boundaries: {
    executionAuthority: false;
    liveTrading: false;
    realOrders: false;
    candidatePromotion: false;
    holdoutRanking: false;
  };
};

export type PositioningUniverseRow = {
  symbol: string;
  admitted: boolean;
  qualityPass: boolean | null;
  independentRowCount: number | null;
  required: number | null;
  ready: boolean | null;
};

const ROOT = 'https://raw.githubusercontent.com/Blackleets/genesis-hq-lab/capture-tape';
const QUALITY_URL = `${ROOT}/paper-tape/positioning-data-quality-latest.json`;
const EDGE_URL = `${ROOT}/quant-evidence/positioning-edge-factory-latest.json`;
const UNIVERSE_URL = `${ROOT}/paper-tape/positioning-universe-probe-latest.json`;
const POSITIONING_EDGE_VERSION = 'positioning_edge_factory_v7_strict_numeric';

const QUALITY_URLS: Record<string, string> = {
  BTCUSDT: QUALITY_URL,
  ETHUSDT: `${ROOT}/paper-tape/positioning-data-quality-ethusdt-latest.json`,
  SOLUSDT: `${ROOT}/paper-tape/positioning-data-quality-solusdt-latest.json`,
  XRPUSDT: `${ROOT}/paper-tape/positioning-data-quality-xrpusdt-latest.json`,
  BNBUSDT: `${ROOT}/paper-tape/positioning-data-quality-bnbusdt-latest.json`,
};

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store', signal });
  if (!response.ok) throw new Error(`positioning_research_http_${response.status}`);
  return response.json() as Promise<T>;
}

function assertQualityBoundary(quality: PositioningDataQuality) {
  if (quality.mode !== 'RESEARCH_ONLY' || quality.readiness?.rankingAllowed === true) {
    throw new Error('positioning_quality_boundary_unverified');
  }
}

export async function fetchPositioningResearch(signal?: AbortSignal): Promise<{ quality: PositioningDataQuality; edge: PositioningEdgeSnapshot }> {
  const [quality, edge] = await Promise.all([
    fetchJson<PositioningDataQuality>(QUALITY_URL, signal),
    fetchJson<PositioningEdgeSnapshot>(EDGE_URL, signal),
  ]);

  assertQualityBoundary(quality);
  if (
    edge.version !== POSITIONING_EDGE_VERSION
    || edge.mode !== 'RESEARCH_ONLY'
    || edge.paperOnly !== true
    || edge.liveOrders !== false
    || edge.executionAuthority !== false
    || edge.capitalEligible !== false
    || edge.methodology?.selectionUsesHoldout !== false
    || edge.methodology?.holdoutSealed !== true
    || edge.methodology?.activeQualityCohortOnly !== true
    || edge.methodology?.strictMissingNumericEvidence !== true
  ) throw new Error('positioning_edge_boundary_unverified');

  return { quality, edge };
}

export async function fetchPositioningUniverseReadiness(signal?: AbortSignal): Promise<{ probe: PositioningUniverseProbe; rows: PositioningUniverseRow[] }> {
  const probe = await fetchJson<PositioningUniverseProbe>(UNIVERSE_URL, signal);
  if (
    probe.mode !== 'RESEARCH_ONLY'
    || probe.policy?.missingDimensionExcludesSymbol !== true
    || probe.policy?.substitutionsAllowed !== false
    || probe.boundaries?.executionAuthority !== false
    || probe.boundaries?.liveTrading !== false
    || probe.boundaries?.realOrders !== false
    || probe.boundaries?.candidatePromotion !== false
    || probe.boundaries?.holdoutRanking !== false
  ) throw new Error('positioning_universe_boundary_unverified');

  const symbols = Array.isArray(probe.requestedSymbols) ? probe.requestedSymbols : Object.keys(QUALITY_URLS);
  const results = await Promise.allSettled(symbols.map(async symbol => {
    const url = QUALITY_URLS[symbol];
    if (!url) return null;
    const quality = await fetchJson<PositioningDataQuality>(url, signal);
    assertQualityBoundary(quality);
    if (quality.symbol && quality.symbol !== symbol) throw new Error('positioning_quality_symbol_mismatch');
    return quality;
  }));

  const rows = symbols.map((symbol, index) => {
    const result = results[index];
    const quality = result?.status === 'fulfilled' ? result.value : null;
    return {
      symbol,
      admitted: probe.usableSymbols?.includes(symbol) === true,
      qualityPass: quality ? quality.qualityPass === true : null,
      independentRowCount: quality ? quality.independentRowCount : null,
      required: quality?.readiness?.minimumIndependentRows ?? null,
      ready: quality ? quality.readiness?.readyForPredeclaredStudy === true : null,
    } satisfies PositioningUniverseRow;
  });

  return { probe, rows };
}
