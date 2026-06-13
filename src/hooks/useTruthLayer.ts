// useTruthLayer — polls /api/system/health every 15s for canonical system state.
// Exposes granular health indicators that /api/health does not provide.

import { useEffect, useState } from 'react';
import { fetchApi } from '@services/apiBase';

export interface TruthIssue {
  severity: 'warn' | 'info';
  system: string;
  message: string;
}

export interface SystemTruth {
  ok: boolean;
  timestamp: string;
  probeMs: number;
  websocket: { connectedClients: number; active: boolean };
  database: { ok: boolean; tables?: number; totalTrades?: number; error?: string };
  treasury: {
    ok: boolean;
    total?: number;
    available?: number;
    inTrades?: number;
    isPaused?: boolean;
    drawdownPct?: number;
    error?: string;
  };
  agentRunner: {
    ok: boolean;
    openTrades?: number;
    lastTickAt?: string | null;
    agentAlive?: boolean;
    msSinceLastTick?: number | null;
    totalCycles?: number;
    claudeEnabled?: boolean;
    llmProvider?: 'groq' | 'gemini' | 'claude' | 'none';
    neverStarted?: boolean;
    error?: string;
  };
  kalshi: { ok: boolean; hasApiKey?: boolean; wsConnected?: boolean; mode?: string; inUse?: boolean; error?: string };
  optimizer: { ok: boolean; [key: string]: unknown };
  learning: {
    ok: boolean;
    lessons?: number;
    activeVetoes?: number;
    agentsTracked?: number;
    lastConsensusDecision?: string | null;
    lastConsensusAt?: number | null;
    error?: string;
    outcomeEngine?: {
      totalTradesAnalyzed: number;
      recentAccuracy: number | null;
      avgPnl: number | null;
      activeWeights: Record<string, number>;
      lastCycleTime: string | null;
      lastCycleChanges: Record<string, number> | null;
      highBandWinRate: number | null;
      cautionWinRate: number | null;
    } | null;
  };
  founderMode: {
    ok: boolean;
    mode?: string;
    focus?: string | null;
    goal?: string | null;
    deptMarkets?: string;
    deptCrypto?: string;
    error?: string;
  };
  globalRisk?: {
    ok: boolean;
    score: number;
    band: 'HEALTHY' | 'WATCH' | 'ELEVATED' | 'HIGH_RISK' | 'CRITICAL';
    safeMode: boolean;
    activeFlags: string[];
    dimensions: Record<string, { score: number; max: number }>;
    lastRefreshAt: string | null;
    error?: string;
  };
  execution: {
    capital: number;
    available: number;
    openTrades: number;
    isPaused: boolean;
    drawdownPct: number;
    agentAlive: boolean;
    lastTickAt: string | null;
    realizedPnl: number | null;
    winRate: number | null;
    totalTrades: number;
    stalePositionCount: number;
    unrealizedDegraded: boolean;
    pnlFresh: boolean | null;
    unrealizedPnl: number | null;
    drawdownProtection: {
      peakCapital: number;
      source: 'sqlite' | 'memory';
      persistence: boolean;
      peakCapitalLoaded: boolean;
    } | null;
    startupReconciliation: {
      status: 'healthy' | 'recovering' | 'degraded';
      recoveredPositions: number;
      orphanCount: number;
      unresolvedExposure: number;
      lastRun: string | null;
      issueCount: number;
      safeMode: boolean;
    } | null;
    confidenceEngine: {
      lastScore: number | null;
      lastBand: string | null;
      averageScore: number | null;
      blockedTrades: number;
      noTradeReasonCounts: Record<string, number>;
      lastDecisionAt: string | null;
    } | null;
    globalRisk: {
      score: number;
      band: string;
      safeMode: boolean;
      activeFlags: string[];
      dimensions: Record<string, { score: number; max: number }>;
      lastRefreshAt: string | null;
    };
  };
  executionDiagnostics?: {
    ok: boolean;
    stalePositions?: Array<{ id: string; marketId: string; source: string; ageHours: number }>;
    pnlLastSettledAt?: string | null;
    drawdownProtection?: {
      peakCapital: number;
      source: 'sqlite' | 'memory';
      persistence: boolean;
      peakCapitalLoaded: boolean;
    };
    startupReconciliation?: {
      status: 'healthy' | 'recovering' | 'degraded';
      recoveredPositions: number;
      orphanCount: number;
      unresolvedExposure: number;
      lastRun: string | null;
      issueCount: number;
      safeMode: boolean;
    };
    error?: string;
  };
  issues: TruthIssue[];
  error?: string;
}

interface UseTruthLayerReturn {
  truth: SystemTruth | null;
  loading: boolean;
  lastFetchedAt: Date | null;
  wsConnected: boolean;
}

const POLL_INTERVAL_MS = 15_000;

export function useTruthLayer(): UseTruthLayerReturn {
  const [truth, setTruth] = useState<SystemTruth | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchTruth() {
      try {
        const res = await fetchApi('/api/system/health');
        const data: SystemTruth = await res.json();
        if (!cancelled) {
          setTruth(data);
          setLastFetchedAt(new Date());
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setLoading(false);
          setTruth((prev) =>
            prev
              ? { ...prev, ok: false, error: 'fetch failed' }
              : null
          );
        }
      }
    }

    fetchTruth();
    const id = setInterval(fetchTruth, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const wsConnected = truth?.websocket?.active ?? false;

  return { truth, loading, lastFetchedAt, wsConnected };
}
