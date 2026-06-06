// useAgentData — polls the backend agent runner with exponential backoff.
// Returns null while loading; components degrade gracefully when backend is offline.

import { useState, useEffect, useCallback, useRef } from 'react';
import { agentClient, type TradingDashboard, type AgentTrade, type AgentLesson, type OrgStatus, type AgentSignal, type SkillVersion, type MarketingContent } from '../lib/agentClient';
import { useWebSocket } from './useWebSocket';

const POLL_MS_BASE = 10_000;
const POLL_MS_MAX  = 60_000;

export interface AgentData {
  dashboard: TradingDashboard | null;
  trades:    AgentTrade[];
  lessons:   AgentLesson[];
  signals:   AgentSignal[];
  signalAccuracy: { total: number; correct: number; rate: number | null } | null;
  skills:    SkillVersion[];
  marketing: MarketingContent | null;
  status:    OrgStatus | null;
  online:    boolean;
  lastSync:  string | null;
}

export function useAgentData(): AgentData {
  const { lastMessage } = useWebSocket();
  const failureCount = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const [data, setData] = useState<AgentData>({
    dashboard: null,
    trades:    [],
    lessons:   [],
    signals:   [],
    signalAccuracy: null,
    skills:    [],
    marketing: null,
    status:    null,
    online:    false,
    lastSync:  null,
  });

  const refresh = useCallback(async () => {
    const health = await agentClient.getHealth();
    if (!health?.ok) {
      failureCount.current++;
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

    failureCount.current = 0;
    setData({
      dashboard: dashboard ?? null,
      trades:    tradesRes?.trades ?? [],
      lessons:   lessonsRes?.lessons ?? [],
      signals:   signalsRes?.signals ?? [],
      signalAccuracy: signalsRes?.accuracy ?? null,
      skills:    skillsRes?.deployed ?? [],
      marketing: marketing ?? null,
      status:    status ?? null,
      online:    true,
      lastSync:  new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    });
  }, []);

  const scheduleNext = useCallback(() => {
    clearTimeout(timerRef.current);
    const delay = Math.min(POLL_MS_MAX, POLL_MS_BASE * Math.pow(2, failureCount.current));
    timerRef.current = setTimeout(async () => {
      await refresh();
      scheduleNext();
    }, delay);
  }, [refresh]);

  useEffect(() => {
    void refresh().then(scheduleNext);
    return () => clearTimeout(timerRef.current);
  }, [refresh, scheduleNext]);

  useEffect(() => {
    if (!lastMessage) return;
    const relevant = ['trade:executed', 'trade:resolved', 'lesson:learned', 'agent:tick'];
    if (relevant.includes(lastMessage.type)) {
      void refresh();
    }
  }, [lastMessage, refresh]);

  return data;
}
