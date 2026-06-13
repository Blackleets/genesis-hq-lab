// tradingAgents — 5 base trading agents for Genesis HQ.
// These are the tactical specialists that operate the trading desk.
// Initial performanceMetrics are zeroed — they update from live data.

import type { TradingAgent } from '@core/types/tradingAgent';

export const TRADING_AGENTS: TradingAgent[] = [
  {
    id: 'scalping-hunter',
    name: 'Scalping Hunter',
    role: 'High-Frequency Signal Hunter',
    mission: 'Detect short-duration edge signals and execute fast alpha trades with precision.',
    tools: ['EMA Crossover', 'RSI Filter', 'Volume Scanner', 'Fatigue Guard'],
    riskLimits: {
      maxCapitalPct: 0.15,
      maxDrawdownPct: 0.03,
      maxTradesPerDay: 20,
      vetoEnabled: true,
    },
    performanceMetrics: {
      completedTasks: 0,
      successfulSignals: 0,
      winRate: 0,
      profitFactor: 0,
      learningScore: 0,
      uptime: 1,
      errorRate: 0,
    },
    level: 1,
    tier: 'rookie',
    visualTraits: {
      primaryColor: '#3da9fc',
      accentColor: '#22d3ee',
      auraColor: '#3da9fc',
      activeTools: ['EMA', 'RSI', 'VOL'],
      idleAnimation: 'scan',
      workAnimation: 'signal',
    },
    currentStatus: 'idle',
  },

  {
    id: 'risk-sentinel',
    name: 'Risk Sentinel',
    role: 'Risk Control Enforcer',
    mission: 'Monitor portfolio exposure and block any action that violates risk boundaries.',
    tools: ['VaR Monitor', 'Drawdown Guard', 'Position Sizer', 'Veto Engine'],
    riskLimits: {
      maxCapitalPct: 0.05,
      maxDrawdownPct: 0.02,
      maxTradesPerDay: 0,
      vetoEnabled: true,
    },
    performanceMetrics: {
      completedTasks: 0,
      successfulSignals: 0,
      winRate: 0,
      profitFactor: 0,
      learningScore: 0,
      uptime: 1,
      errorRate: 0,
    },
    level: 1,
    tier: 'rookie',
    visualTraits: {
      primaryColor: '#ff4757',
      accentColor: '#ff6b81',
      auraColor: '#ff4757',
      activeTools: ['VAR', 'DD', 'VETO'],
      idleAnimation: 'monitor',
      workAnimation: 'risk-check',
    },
    currentStatus: 'active',
  },

  {
    id: 'market-analyst',
    name: 'Market Analyst',
    role: 'Market Intelligence Analyst',
    mission: 'Synthesize market signals and regime context into actionable intelligence for traders.',
    tools: ['Regime Detector', 'Trend Scanner', 'News Feed', 'Sentiment Engine'],
    riskLimits: {
      maxCapitalPct: 0,
      maxDrawdownPct: 0,
      maxTradesPerDay: 0,
      vetoEnabled: false,
    },
    performanceMetrics: {
      completedTasks: 0,
      successfulSignals: 0,
      winRate: 0,
      profitFactor: 0,
      learningScore: 0,
      uptime: 1,
      errorRate: 0,
    },
    level: 1,
    tier: 'rookie',
    visualTraits: {
      primaryColor: '#22d3ee',
      accentColor: '#67e8f9',
      auraColor: '#22d3ee',
      activeTools: ['RGME', 'TREND', 'NEWS'],
      idleAnimation: 'analyze',
      workAnimation: 'analyze',
    },
    currentStatus: 'idle',
  },

  {
    id: 'backtest-engineer',
    name: 'Backtest Engineer',
    role: 'Strategy Validation Engineer',
    mission: 'Validate edge hypotheses against historical data and compute statistical confidence.',
    tools: ['Backtester', 'Sharpe Calc', 'Walk-Forward', 'Overfit Detector'],
    riskLimits: {
      maxCapitalPct: 0,
      maxDrawdownPct: 0,
      maxTradesPerDay: 0,
      vetoEnabled: false,
    },
    performanceMetrics: {
      completedTasks: 0,
      successfulSignals: 0,
      winRate: 0,
      profitFactor: 0,
      learningScore: 0,
      uptime: 1,
      errorRate: 0,
    },
    level: 1,
    tier: 'rookie',
    visualTraits: {
      primaryColor: '#7c5cff',
      accentColor: '#a78bfa',
      auraColor: '#7c5cff',
      activeTools: ['BKTS', 'SHRP', 'WFW'],
      idleAnimation: 'compute',
      workAnimation: 'backtest',
    },
    currentStatus: 'idle',
  },

  {
    id: 'capital-manager',
    name: 'Capital Manager',
    role: 'Capital Allocation Strategist',
    mission: 'Optimize capital deployment across active strategies to maximize risk-adjusted returns.',
    tools: ['Kelly Engine', 'Portfolio Alloc', 'Budget Tracker', 'Rebalancer'],
    riskLimits: {
      maxCapitalPct: 1.0,
      maxDrawdownPct: 0.08,
      maxTradesPerDay: 0,
      vetoEnabled: true,
    },
    performanceMetrics: {
      completedTasks: 0,
      successfulSignals: 0,
      winRate: 0,
      profitFactor: 0,
      learningScore: 0,
      uptime: 1,
      errorRate: 0,
    },
    level: 1,
    tier: 'rookie',
    visualTraits: {
      primaryColor: '#ffd24a',
      accentColor: '#fbbf24',
      auraColor: '#ffd24a',
      activeTools: ['KELLY', 'ALLOC', 'BUDG'],
      idleAnimation: 'monitor',
      workAnimation: 'execute',
    },
    currentStatus: 'idle',
  },
];

export function getTradingAgent(id: string): TradingAgent | undefined {
  return TRADING_AGENTS.find(a => a.id === id);
}
