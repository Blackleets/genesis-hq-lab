// agentClient — fetches live agent runner data from the backend.
// All endpoints are read-only. Errors return null so UI degrades gracefully.

import { apiUrl } from '@services/apiBase';

async function get<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(apiUrl(path), {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return res.json() as Promise<T>;
  } catch {
    return null;
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgentTrade {
  id: string;
  agent_id: string;
  market_question: string;
  market_source: string;
  market_category: string;
  outcome: 'YES' | 'NO';
  entry_price: number;
  shares: number;
  capital_used: number;
  confidence: number;
  reason: string;
  evidence: string;       // JSON array
  status: 'open' | 'closed' | 'vetoed' | 'expired';
  resolved_outcome?: 'YES' | 'NO';
  pnl?: number;
  opened_at: string;
  closed_at?: string;
  days_to_close?: number;
}

export interface AgentLesson {
  id: string;
  lesson_text: string;
  why_failed?: string;
  new_rule?: string;
  category: string;
  severity: 'info' | 'warning' | 'critical';
  times_prevented_loss: number;
  created_at: string;
}

export interface AgentSignal {
  id: string;
  source: string;
  signal_text: string;
  category: string;
  confidence: number;
  proved_correct: number | null;
  created_at: string;
}

export interface SkillVersion {
  agent: string;
  version: number;
  status: string;
  brier: number | null;
  win_rate: number | null;
  calibration: number | null;
  deployed_at: string | null;
}

export interface TradingDashboard {
  ok: boolean;
  treasury: {
    total: number;
    available: number;
    inTrades: number;
    unrealizedPnl: number;
    netWorth: number;
    totalReturn: number;
    drawdownPct: number;
    isPaused: boolean;
  };
  performance: {
    totalTrades: number;
    winRate: number;
    totalPnl: number;
    avgPnl: number;
    bestTrade: number;
    worstTrade: number;
    roi: number;
  };
  risk: {
    brierScore: { score: number | null; label: string; n: number } | null;
    sharpeRatio: { ratio: number | null; label: string } | null;
    openTrades: number;
    atRisk: number;
    todaySkips: number;
  };
  breakdown: { category: string; total: number; wins: number; win_rate: number; total_pnl: number }[];
  capitalHistory: { total: number; available: number; recorded_at: string }[];
}

export interface OrgStatus {
  ok: boolean;
  state: {
    mode: string;
    activeDepts: Record<string, boolean>;
    riskTolerance: string;
    focus?: { topic: string; since: string } | null;
    goal?: { description: string; deadline: string } | null;
    founderNote?: string | null;
  };
  summary: string;
}

export interface MarketingContent {
  ok: boolean;
  insight?: string;
  headline?: string;
  tweet?: string;
  linkedin?: string;
  generatedAt?: string;
  content?: null;
  message?: string;
}

export interface HealthStatus {
  ok: boolean;
  service?: string;
  now?: string;
  agent?: { capital: number; isPaused: boolean; openTrades: number };
}

export interface EdgeScorecardCheck {
  pass: boolean;
  value: number | null;
  threshold: number;
  label: string;
}

export interface EdgeScorecard {
  ok: boolean;
  verdict: 'GO' | 'NO_GO' | 'INSUFFICIENT_DATA';
  totalClosed: number;
  winRate: number;
  roi: number;
  totalPnl: number;
  brierScore: number | null;
  brierSkill: number | null;
  brierLabel: string;
  sharpeRatio: number | null;
  sharpeLabel: string;
  calibrationGap: number | null;
  checks: Record<string, EdgeScorecardCheck>;
  failingChecks: Array<{ key: string; label: string; value: number | null; threshold: number }>;
  nextMilestone: string | null;
}

// ─── API calls ────────────────────────────────────────────────────────────────

export const agentClient = {
  getTrades:   () => get<{ ok: boolean; trades: AgentTrade[] }>('/api/agent/trades'),
  getLessons:  () => get<{ ok: boolean; lessons: AgentLesson[] }>('/api/agent/lessons'),
  getSignals:  () => get<{ ok: boolean; signals: AgentSignal[]; accuracy: { total: number; correct: number; rate: number | null } }>('/api/agent/signals'),
  getSkills:   () => get<{ ok: boolean; deployed: SkillVersion[] }>('/api/agent/skills'),
  getDashboard:() => get<TradingDashboard>('/api/trading/dashboard'),
  getStatus:   () => get<OrgStatus>('/api/command/status'),
  getHealth:   () => get<HealthStatus>('/api/health'),
  getMarketing:() => get<MarketingContent>('/api/agent/marketing'),
  getEdgeScorecard: () => get<EdgeScorecard>('/api/trading/edge-scorecard'),

  sendCommand: async (command: string) => {
    try {
      const res = await fetch(apiUrl('/api/command'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return null;
      return res.json();
    } catch {
      return null;
    }
  },
};
