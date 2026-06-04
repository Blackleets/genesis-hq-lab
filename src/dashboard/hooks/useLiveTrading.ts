// useLiveTrading — métricas de trading desde el backend (SQLite + agent runner).
// Única fuente de verdad para capital, P&L y posiciones. Sin store local simulado.

import { useMemo } from 'react';
import { useAgentData } from '@agents/hooks/useAgentData';
import type { AgentTrade } from '@services/agentClient';

export interface LiveTradingMetrics {
  online: boolean;
  lastSync: string | null;
  capital: number;
  available: number;
  inTrades: number;
  totalPnL: number;
  winRate: number;
  totalTrades: number;
  openTrades: AgentTrade[];
  closedTrades: AgentTrade[];
  isPaused: boolean;
  drawdownPct: number;
  capitalHistory: { at: string; value: number }[];
}

export function useLiveTrading(): LiveTradingMetrics {
  const { dashboard, trades, online, lastSync } = useAgentData();

  return useMemo(() => {
    const openTrades = trades.filter((t) => t.status === 'open');
    const closedTrades = trades.filter((t) => t.status === 'closed');
    const treasury = dashboard?.treasury;
    const perf = dashboard?.performance;
    const capitalHistory = (dashboard?.capitalHistory ?? []).map((h) => ({
      at: h.recorded_at,
      value: h.total,
    }));

    return {
      online,
      lastSync,
      capital: treasury?.total ?? 0,
      available: treasury?.available ?? 0,
      inTrades: treasury?.inTrades ?? 0,
      totalPnL: perf?.totalPnl ?? 0,
      winRate: perf?.winRate ?? 0,
      totalTrades: perf?.totalTrades ?? 0,
      openTrades,
      closedTrades,
      isPaused: treasury?.isPaused ?? false,
      drawdownPct: treasury?.drawdownPct ?? 0,
      capitalHistory,
    };
  }, [dashboard, trades, online, lastSync]);
}
