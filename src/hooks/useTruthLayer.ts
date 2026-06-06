// useTruthLayer — polls /api/system/health every 15s for canonical system state.
// Exposes granular health indicators that /api/health does not provide.

import { useEffect, useState } from 'react';

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
    neverStarted?: boolean;
    error?: string;
  };
  kalshi: { ok: boolean; hasApiKey?: boolean; wsConnected?: boolean; mode?: string; error?: string };
  optimizer: { ok: boolean; [key: string]: unknown };
  learning: {
    ok: boolean;
    lessons?: number;
    activeVetoes?: number;
    agentsTracked?: number;
    lastConsensusDecision?: string | null;
    lastConsensusAt?: number | null;
    error?: string;
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
  execution: {
    capital: number;
    available: number;
    openTrades: number;
    isPaused: boolean;
    drawdownPct: number;
    agentAlive: boolean;
    lastTickAt: string | null;
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

const API_BASE = (() => {
  try {
    return import.meta.env?.VITE_API_BASE ?? 'http://localhost:8787';
  } catch {
    return 'http://localhost:8787';
  }
})();

export function useTruthLayer(): UseTruthLayerReturn {
  const [truth, setTruth] = useState<SystemTruth | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchTruth() {
      try {
        const res = await fetch(`${API_BASE}/api/system/health`);
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
