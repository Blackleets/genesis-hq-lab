const ROOT = 'https://raw.githubusercontent.com/Blackleets/genesis-hq-lab/capture-tape/quant-evidence';
const MICRO_CANARY_URL = `${ROOT}/micro-canary-paper-latest.json`;

export type MicroCanaryTrade = {
  sourceTradeId: string;
  pair: string;
  side: 'LONG' | 'SHORT';
  openedAt: string | null;
  closedAt: string | null;
  exitReason: string | null;
  entry: number;
  exit: number;
  sourceStop: number | null;
  sourceTarget: number | null;
  sourceCapitalUsedUsd: number | null;
  sourceLeverage: number | null;
  sourcePnlUsd: number | null;
  canaryLeverage: 1;
  canaryNotionalUsd: number;
  grossReturnPct: number;
  costBps: number;
  netPnlUsd: number;
  equityAfterUsd: number;
};

export type MicroCanaryRun = {
  costBps: number;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  netPnlUsd: number;
  roiPct: number;
  expectancyUsd: number;
  profitFactor: number | null;
  finalEquityUsd: number;
  maxDrawdownUsd: number;
  maxDrawdownPct: number;
  stoppedByLossCap: boolean;
  maxObservedOpenPositions: number;
  maxObservedNotionalUsd: number;
  ignoredOverlaps: number;
  ignoredAfterLossCap: number;
  tradesDetail: MicroCanaryTrade[];
};

export type MicroCanarySnapshot = {
  version: 'micro_canary_paper_v2_v8_mirror';
  generatedAt: string;
  mode: 'MICRO_CANARY_PAPER';
  paperOnly: true;
  liveOrders: false;
  executionAuthority: false;
  capitalEligible: false;
  strategy: {
    id: 'futures_breakout_short_micro:v8';
    purpose: 'ACTIVE_V8_PAPER_MIRROR_DIAGNOSTIC';
    note: string;
  };
  source: {
    kind: 'VERIFIED_SYSTEM_HEALTH_PAPER_TRADES';
    strategyVersionId: 'futures_breakout_short_micro:v8';
    runnerVersion: string | null;
    validationEngineVersion: string | null;
    sourceClosedTrades: number;
    sourceLastTickAt: string | null;
    sourceUpdatedAt: string | null;
  };
  canaryReadiness: string;
  diagnosticVerdict: 'NO_TRADES' | 'PAPER_WIN' | 'PAPER_LOSS' | 'FLAT';
  baseline: MicroCanaryRun;
  stress: MicroCanaryRun;
  boundaries: {
    realOrdersPlaced: false;
    orderEndpointAvailable: false;
    apiTradingKeysUsed: false;
    liveTradingEnabled: false;
    changesProductionRiskGates: false;
    grantsCapitalEligibility: false;
    writesExecutionState: false;
    maxCapitalUsd: 10;
    maxTotalLossUsd: 0.25;
    maxOpenPositions: 1;
    maxLeverage: 1;
  };
};

function assertMicroCanaryBoundary(x: MicroCanarySnapshot) {
  if (
    x.version !== 'micro_canary_paper_v2_v8_mirror'
    || x.mode !== 'MICRO_CANARY_PAPER'
    || x.paperOnly !== true
    || x.liveOrders !== false
    || x.executionAuthority !== false
    || x.capitalEligible !== false
    || x.strategy?.id !== 'futures_breakout_short_micro:v8'
    || x.strategy?.purpose !== 'ACTIVE_V8_PAPER_MIRROR_DIAGNOSTIC'
    || x.source?.kind !== 'VERIFIED_SYSTEM_HEALTH_PAPER_TRADES'
    || x.boundaries?.realOrdersPlaced !== false
    || x.boundaries?.orderEndpointAvailable !== false
    || x.boundaries?.apiTradingKeysUsed !== false
    || x.boundaries?.liveTradingEnabled !== false
    || x.boundaries?.changesProductionRiskGates !== false
    || x.boundaries?.grantsCapitalEligibility !== false
    || x.boundaries?.writesExecutionState !== false
    || x.boundaries?.maxCapitalUsd !== 10
    || x.boundaries?.maxTotalLossUsd !== 0.25
    || x.boundaries?.maxOpenPositions !== 1
    || x.boundaries?.maxLeverage !== 1
  ) throw new Error('micro_canary_boundary_unverified');
}

export async function fetchMicroCanary(signal?: AbortSignal): Promise<MicroCanarySnapshot> {
  const response = await fetch(`${MICRO_CANARY_URL}?t=${Date.now()}`, { cache: 'no-store', signal });
  if (!response.ok) throw new Error(`micro_canary_http_${response.status}`);
  const payload = await response.json() as MicroCanarySnapshot;
  assertMicroCanaryBoundary(payload);
  return payload;
}
