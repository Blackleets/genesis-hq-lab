import { apiUrl, fetchApi } from '@services/apiBase';

export interface QuantStrategyEntry {
  strategyId:   string;
  name:         string;
  status:       'RESEARCH' | 'BACKTESTING' | 'PAPER' | 'PROMOTED' | 'REJECTED' | 'DISABLED';
  trades:       number | null;
  profitFactor: number | null;
  winRate:      number | null;
  avgPnl:       number | null;
  note:         string | null;
}

export interface QuantBlocker {
  reason: string;
  code:   string;
}

export interface QuantAllocationSummary {
  blocked:           boolean;
  blockReason:       string | null;
  totalAllocatedPct: number;
  totalAllocatedUsd: number;
  availableCapital:  number | null;
  topAllocations:    {
    strategyId:            string;
    name:                  string;
    recommendedCapitalPct: number;
    maxPositionUsd:        number;
    reason:                string;
    paperMode?:            boolean;
  }[];
}

export interface QuantMetrics {
  totalStrategies:  number;
  byStatus:         Record<string, number>;
  totalTrades?:     number;
  profitFactor?:    number | null;
  expectancy?:      number | null;
  winRate?:         number | null;
  maxDrawdown?:     number | null;
  sharpeProxy?:     number | null;
  sortinoProxy?:    number | null;
  rollingPf15?:     number | null;
  maxLossStreak?:   number | null;
  wfRobustShort?:   boolean | null;
  wfRobustCombined?: boolean | null;
  wfRunAt?:         string | null;
  promotedCount?:   number;
  alphaVerdict?:    string | null;
}

export interface QuantReport {
  headline:    string;
  edgeAnswer:  'YES' | 'NO' | 'UNKNOWN';
  edgeReason:  string | null;
  strategies:  QuantStrategyEntry[];
  blockers:    QuantBlocker[];
  allocation:  QuantAllocationSummary | null;
  metrics:     QuantMetrics;
  dataMode:    string;
  errors:      Record<string, string> | null;
  updatedAt:   string | null;
}

export async function fetchQuantReport(): Promise<QuantReport> {
  const res = await fetchApi(apiUrl('/api/quant/report'));
  if (!res.ok) throw new Error(`quant/report ${res.status}`);
  return res.json() as Promise<QuantReport>;
}

export interface WfSummary {
  shortJudgedWindows:    number;
  shortPositiveWindows:  number;
  combinedJudgedWindows: number;
  combinedPositiveWindows: number;
  robustShort:    boolean;
  robustCombined: boolean;
}

export interface WfStatus {
  ok:      boolean;
  running: boolean;
  stale:   boolean;
  cache: {
    completedAt: string;
    startedAt:   string;
    durationMs:  number;
  } | null;
  summary:   WfSummary | null;
  scheduler: {
    started:          boolean;
    checkIntervalMin: number;
    maxAgeHours:      number;
    minTrades:        number;
    closedTrades:     number;
    cacheStale:       boolean;
    running:          boolean;
  };
}

export async function fetchWfStatus(): Promise<WfStatus> {
  const res = await fetchApi(apiUrl('/api/quant/wf/status'));
  if (!res.ok) throw new Error(`wf/status ${res.status}`);
  return res.json() as Promise<WfStatus>;
}

export async function triggerWalkForward(): Promise<{ ok: boolean; running: boolean; message: string }> {
  const res = await fetchApi(apiUrl('/api/quant/wf/run'), { method: 'GET' });
  if (!res.ok) throw new Error(`wf/run ${res.status}`);
  return res.json();
}
