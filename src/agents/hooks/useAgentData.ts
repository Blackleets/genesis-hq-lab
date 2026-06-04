// useAgentData — polls the backend agent runner every 10s.
// Returns null while loading; components degrade gracefully when backend is offline.

import { useState, useEffect, useCallback } from 'react';
import { agentClient, type TradingDashboard, type AgentTrade, type AgentLesson, type OrgStatus, type AgentSignal, type SkillVersion, type MarketingContent } from '@services/agentClient';
import { useWebSocket } from '@hooks/useWebSocket';

const POLL_MS = 10_000;

export interface AgentData {
  dashboard: TradingDashboard | null;
  trades: AgentTrade[];
  lessons: AgentLesson[];
  signals: AgentSignal[];
  signalAccuracy: { total: number; correct: number; rate: number | null } | null;
  skills: SkillVersion[];
  marketing: MarketingContent | null;
  status: OrgStatus | null;
  online: boolean;
  lastSync: string | null;
}

export function useAgentData(): AgentData {
  const { lastMessage } = useWebSocket();

  const [data, setData] = useState<AgentData>({
    dashboard: null,
    trades: [],
    lessons: [],
    signals: [],
    signalAccuracy: null,
    skills: [],
    marketing: null,
    status: null,
    online: false,
    lastSync: null,
  });

  const refresh = useCallback(async () => {
    const health = await agentClient.getHealth();
    if (!health?.ok) {
      setData((prev) => ({ ...prev, online: false }));
      return;
    }

    const [dashboard, tradesRes, lessonsRes, signalsRes, skillsRes, marketing, status] = await Promise.all([
      agentClient.getDashboard(),
      agentClient.getTrades(),
      agentClient.getLessons(),
      agentClient.getSignals(),
      agentClient.getSkills(),
      agentClient.getMarketing(),
      agentClient.getStatus(),
    ]);

    setData({
      dashboard: dashboard ?? null,
      trades: tradesRes?.trades ?? [],
      lessons: lessonsRes?.lessons ?? [],
      signals: signalsRes?.signals ?? [],
      signalAccuracy: signalsRes?.accuracy ?? null,
      skills: skillsRes?.deployed ?? [],
      marketing: marketing ?? null,
      status: status ?? null,
      online: true,
      lastSync: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    });
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => void refresh(), 0);
    const interval = window.setInterval(() => void refresh(), POLL_MS);
    return () => {
      window.clearTimeout(id);
      window.clearInterval(interval);
    };
  }, [refresh]);

  useEffect(() => {
    if (!lastMessage) return;
    const relevant = ['trade:executed', 'trade:resolved', 'lesson:learned', 'agent:tick'];
    if (relevant.includes(lastMessage.type)) {
      const id = window.setTimeout(() => void refresh(), 0);
      return () => window.clearTimeout(id);
    }
  }, [lastMessage, refresh]);

  return data;
}
