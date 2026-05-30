// useAgentData — polls the backend agent runner every 10s.
// Returns null while loading; components degrade gracefully when backend is offline.

import { useState, useEffect, useCallback } from 'react';
import { agentClient, type TradingDashboard, type AgentTrade, type AgentLesson, type OrgStatus } from '../lib/agentClient';

const POLL_MS = 10_000;

export interface AgentData {
  dashboard: TradingDashboard | null;
  trades:    AgentTrade[];
  lessons:   AgentLesson[];
  status:    OrgStatus | null;
  online:    boolean;
  lastSync:  string | null;
}

export function useAgentData(): AgentData {
  const [data, setData] = useState<AgentData>({
    dashboard: null,
    trades:    [],
    lessons:   [],
    status:    null,
    online:    false,
    lastSync:  null,
  });

  const refresh = useCallback(async () => {
    const health = await agentClient.getHealth();
    if (!health?.ok) {
      setData((prev) => ({ ...prev, online: false }));
      return;
    }

    const [dashboard, tradesRes, lessonsRes, status] = await Promise.all([
      agentClient.getDashboard(),
      agentClient.getTrades(),
      agentClient.getLessons(),
      agentClient.getStatus(),
    ]);

    setData({
      dashboard: dashboard ?? null,
      trades:    tradesRes?.trades ?? [],
      lessons:   lessonsRes?.lessons ?? [],
      status:    status ?? null,
      online:    true,
      lastSync:  new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    });
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return data;
}
