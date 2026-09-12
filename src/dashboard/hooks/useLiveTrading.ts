// useLiveTrading — métricas de trading desde el backend (SQLite + agent runner).
// Única fuente de verdad para capital, P&L y posiciones. Sin store local simulado.

import { useEffect, useMemo, useState } from 'react';
import { useAgentData } from '@agents/hooks/useAgentData';
import type { AgentTrade } from '@services/agentClient';
import { loadFuturesDesk, type FuturesDeskSnapshot } from '@services/cryptoClient';

export interface LiveTradingMetrics {
  online: boolean;
  lastSync: string | null;
  capital: number;
  netWorth: number;
  available: number;
  inTrades: number;
  startingCapital: number;
  totalPnL: number;
  winRate: number;
  totalTrades: number;
  openTrades: AgentTrade[];
  closedTrades: AgentTrade[];
  isPaused: boolean;
  drawdownPct: number;
  capitalHistory: { at: string; value: number }[];
  futuresMode: boolean;
  futuresDesk: FuturesDeskSnapshot | null;
}

export function useLiveTrading(): LiveTradingMetrics {
  const { dashboard, trades, online, lastSync } = useAgentData();
  const [futuresDesk, setFuturesDesk] = useState<FuturesDeskSnapshot | null>(null);

  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      const desk = await loadFuturesDesk(false, 5000);
      if (mounted) setFuturesDesk(desk);
    };
    void refresh();
    const id = window.setInterval(() => { void refresh(); }, 15000);
    return () => {
      mounted = false;
      window.clearInterval(id);
    };
  }, []);

  return useMemo(() => {
    const futuresMode = (futuresDesk?.config.profiles.length ?? 0) > 0;
    const openTrades = trades.filter((t) => t.status === 'open' && (!futuresMode || String(t.id ?? '').startsWith('crypto_futures_')));
    const closedTrades = trades.filter((t) => t.status === 'closed');
    const treasury = dashboard?.treasury;
    const perf = dashboard?.performance;
    // In futures mode (serverless prod) the legacy dashboard.capitalHistory is
    // null, but the futures snapshot carries a real equity curve — use it so the
    // capital chart isn't permanently stuck on "waiting for history".
    const capitalHistory = futuresMode
      ? (futuresDesk?.equityCurve ?? []).map((p) => ({ at: p.ts, value: p.equity }))
      : (dashboard?.capitalHistory ?? []).map((h) => ({ at: h.recorded_at, value: h.total }));
    const futuresCapital = futuresDesk?.futuresCapital ?? null;
    const futuresTodayPnl = futuresDesk?.today?.totalPnl ?? 0;
    const futuresNetWorth = futuresCapital?.equity ?? 0;
    const futuresStartingCapital = futuresCapital?.startCapital ?? 10_000;

    return {
      online,
      lastSync,
      capital: futuresMode ? futuresNetWorth : treasury?.total ?? 0,
      netWorth: futuresMode ? futuresNetWorth : treasury?.netWorth ?? treasury?.total ?? 0,
      available: futuresMode ? (futuresCapital?.available ?? 0) : treasury?.available ?? 0,
      inTrades: futuresMode ? (futuresCapital?.reservedMargin ?? 0) : treasury?.inTrades ?? 0,
      startingCapital: futuresMode ? futuresStartingCapital : treasury?.startingCapital ?? 10_000,
      totalPnL: futuresMode ? (futuresCapital?.netPnl ?? futuresTodayPnl) : perf?.totalPnl ?? 0,
      winRate: perf?.winRate ?? 0,
      totalTrades: futuresMode
        ? futuresDesk?.closedSummary.reduce((sum, row) => sum + (row.closedTrades ?? 0), 0) ?? 0
        : perf?.totalTrades ?? 0,
      openTrades,
      closedTrades,
      isPaused: treasury?.isPaused ?? false,
      drawdownPct: treasury?.drawdownPct ?? 0,
      capitalHistory,
      futuresMode,
      futuresDesk,
    };
  }, [dashboard, trades, online, lastSync, futuresDesk]);
}
