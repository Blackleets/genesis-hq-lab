// TradingAgent — enhanced agent model for the Genesis HQ trading system.
// Parallel to the visual Agent type; focused on performance, tools, and risk posture.
// Additive only — does NOT modify or replace the existing Agent/genesis.ts types.

export type TradingTier = 'rookie' | 'professional' | 'elite';

export type TradingStatus = 'active' | 'idle' | 'paused' | 'error' | 'offline';

export interface TradingPerformanceMetrics {
  completedTasks: number;
  successfulSignals: number;
  winRate: number;        // 0..1
  profitFactor: number;   // grossProfit / grossLoss, 0 if no closed trades
  learningScore: number;  // 0..1
  uptime: number;         // 0..1 availability ratio
  errorRate: number;      // 0..1 errors per task
}

export const EMPTY_PERFORMANCE: TradingPerformanceMetrics = {
  completedTasks: 0,
  successfulSignals: 0,
  winRate: 0,
  profitFactor: 0,
  learningScore: 0,
  uptime: 1,
  errorRate: 0,
};

export interface TradingRiskLimits {
  maxCapitalPct: number;    // 0..1 fraction of total capital
  maxDrawdownPct: number;   // 0..1 max allowed drawdown before pause
  maxTradesPerDay: number;  // 0 = no trade initiation (analysis/control only)
  vetoEnabled: boolean;
}

export interface TradingVisualTraits {
  primaryColor: string;   // hex — main body color
  accentColor: string;    // hex — highlight color
  auraColor: string;      // hex — glow when active
  activeTools: string[];  // 2–4 short tool labels shown floating near agent
  idleAnimation: 'scan' | 'analyze' | 'monitor' | 'compute' | 'guard';
  workAnimation: 'execute' | 'signal' | 'backtest' | 'analyze' | 'risk-check';
}

export interface TradingAgent {
  id: string;
  name: string;
  role: string;
  mission: string;              // one-sentence mandate
  tools: string[];              // full tool names this agent uses
  riskLimits: TradingRiskLimits;
  performanceMetrics: TradingPerformanceMetrics;
  level: number;                // 1..60 derived from metrics
  tier: TradingTier;
  visualTraits: TradingVisualTraits;
  currentStatus: TradingStatus;
  lastAction?: string;          // human-readable description of last action
  lastActionAt?: string;        // ISO timestamp
}
