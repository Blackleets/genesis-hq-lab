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
  totalStrategies: number;
  byStatus:        Record<string, number>;
  totalTrades?:    number;
  profitFactor?:   number | null;
  expectancy?:     number | null;
  winRate?:        number | null;
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
