export const ECONOMIC_SCOREBOARD_VERSION: string;
export const ECONOMIC_GATES: {
  minForwardTrades: number;
  minExpectancyBps: number;
  minProfitFactor: number;
  minTStat: number;
  maxDrawdownPct: number;
  selfFundingSafetyMultiple: number;
  minCompanyPnlWindowDays: number;
  maxCompanyPnlWindowDays: number;
};

export type ForwardEvaluation = {
  metrics: { trades: number | null; expectancyBps: number | null; profitFactor: number | null; tStat: number | null; maxDrawdownPct: number | null };
  checks: Record<'sample' | 'expectancy' | 'profitFactor' | 'tStat' | 'drawdown', boolean>;
  passed: number;
  required: number;
  proven: boolean;
};

export function evaluateForwardChampion(metrics: Record<string, unknown>, gates?: typeof ECONOMIC_GATES): ForwardEvaluation;
export function selectBestForwardFamily(forward: unknown, gates?: typeof ECONOMIC_GATES): { family: any; evaluation: ForwardEvaluation; score: number } | null;
export function buildEconomicScoreboard(input?: Record<string, any>, gates?: typeof ECONOMIC_GATES): any;
