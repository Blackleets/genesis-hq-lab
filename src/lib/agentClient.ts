// agentClient — fetches live agent runner data from the backend (:8787).
// All endpoints are read-only. Errors return null so UI degrades gracefully.

function getBase(): string {
  if (typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.hostname}:8787`;
  }
  return 'http://127.0.0.1:8787';
}

async function get<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${getBase()}${path}`, {
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

export interface TradingDashboard {
  ok: boolean;
  treasury: {
    total: number;
    available: number;
    inTrades: number;
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

// ─── API calls ────────────────────────────────────────────────────────────────

export const agentClient = {
  getTrades:   () => get<{ ok: boolean; trades: AgentTrade[] }>('/api/agent/trades'),
  getLessons:  () => get<{ ok: boolean; lessons: AgentLesson[] }>('/api/agent/lessons'),
  getDashboard:() => get<TradingDashboard>('/api/trading/dashboard'),
  getStatus:   () => get<OrgStatus>('/api/command/status'),
  getHealth:   () => get<{ ok: boolean }>('/api/health'),

  sendCommand: async (command: string) => {
    try {
      const res = await fetch(`${getBase()}/api/command`, {
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
