// useAgentData — polls the backend agent runner.
// Uses exponential backoff on failure (10s → 20s → 40s, cap 60s), resets on success.

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  agentClient,
  type TradingDashboard, type AgentTrade, type AgentLesson,
  type OrgStatus, type AgentSignal, type SkillVersion,
  type MarketingContent, type AgentRunnerStatus,
} from '@services/agentClient';
import { useWebSocket } from '@hooks/useWebSocket';

const BASE_POLL_MS = 10_000;
const MAX_POLL_MS  = 60_000;

export interface AgentData {
  dashboard: TradingDashboard | null;
  trades: AgentTrade[];
  lessons: AgentLesson[];
  signals: AgentSignal[];
  signalAccuracy: { total: number; correct: number; rate: number | null } | null;
  skills: SkillVersion[];
  marketing: MarketingContent | null;
  status: OrgStatus | null;
  runnerStatus: AgentRunnerStatus['status'];
  online: boolean;
  lastSync: string | null;
}

export function useAgentData(): AgentData {
  const { lastMessage } = useWebSocket();
  const failureCountRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [data, setData] = useState<AgentData>({
    dashboard: null,
    trades: [],
    lessons: [],
    signals: [],
    signalAccuracy: null,
    skills: [],
    marketing: null,
    status: null,
    runnerStatus: null,
    online: false,
    lastSync: null,
  });

  const scheduleNext = useCallback((failures: number) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const delay = Math.min(MAX_POLL_MS, BASE_POLL_MS * Math.pow(2, failures));
    timerRef.current = setTimeout(() => void refresh(), delay); // eslint-disable-line
  }, []); // eslint-disable-line

  const refresh = useCallback(async () => {
    const health = await agentClient.getHealth();
    if (!health?.ok) {
      failureCountRef.current += 1;
      setData((prev) => ({ ...prev, online: false }));
      scheduleNext(failureCountRef.current);
      return;
    }

    const [dashboard, tradesRes, lessonsRes, signalsRes, skillsRes, marketing, status, runnerRes] =
      await Promise.all([
        agentClient.getDashboard(),
        agentClient.getTrades(),
        agentClient.getLessons(),
        agentClient.getSignals(),
        agentClient.getSkills(),
        agentClient.getMarketing(),
        agentClient.getStatus(),
        agentClient.getRunnerStatus(),
      ]);

    failureCountRef.current = 0;

    setData({
      dashboard: dashboard ?? null,
      trades: tradesRes?.trades ?? [],
      lessons: lessonsRes?.lessons ?? [],
      signals: signalsRes?.signals ?? [],
      signalAccuracy: signalsRes?.accuracy ?? null,
      skills: skillsRes?.deployed ?? [],
      marketing: marketing ?? null,
      status: status ?? null,
      runnerStatus: runnerRes?.status ?? null,
      online: true,
      lastSync: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    });

    scheduleNext(0);
  }, [scheduleNext]);

  useEffect(() => {
    void refresh();
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [refresh]);

  useEffect(() => {
    if (!lastMessage) return;
    const relevant = ['trade:executed', 'trade:resolved', 'lesson:learned', 'agent:tick'];
    if (relevant.includes(lastMessage.type)) void refresh();
  }, [lastMessage, refresh]);

  return data;
}
