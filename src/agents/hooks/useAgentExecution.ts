// useAgentExecution — manages real AI agent state.
// Polls on mount, then stays live via WebSocket agent:* events.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useWebSocket } from '@hooks/useWebSocket';
import type {
  RealAgentLive,
  AgentLogEntry,
  ExecutionRecord,
  ExecuteResult,
  ProviderInfo,
} from '@core/types/realAgent';

interface AgentExecState {
  agents: RealAgentLive[];
  providers: Record<string, ProviderInfo>;
  loading: boolean;
  error: string | null;
}

interface PerAgentState {
  logs: AgentLogEntry[];
  history: ExecutionRecord[];
  currentOutput: string;
}

export function useAgentExecution() {
  const [state, setState] = useState<AgentExecState>({
    agents: [],
    providers: {},
    loading: true,
    error: null,
  });

  const [perAgent, setPerAgent] = useState<Record<string, PerAgentState>>({});
  const { lastMessage } = useWebSocket();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch all agent statuses ──────────────────────────────────────────────

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/agents/real');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as {
        ok: boolean;
        agents: RealAgentLive[];
        providers: Record<string, ProviderInfo>;
      };
      if (data.ok) {
        setState({ agents: data.agents, providers: data.providers, loading: false, error: null });
      }
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load agents',
      }));
    }
  }, []);

  // ── Fetch logs for a specific agent ──────────────────────────────────────

  const fetchLogs = useCallback(async (agentId: string) => {
    try {
      const [logsRes, statusRes] = await Promise.all([
        fetch(`/api/agents/${agentId}/logs?limit=50`),
        fetch(`/api/agents/${agentId}/status`),
      ]);
      const [logsData, statusData] = await Promise.all([
        logsRes.json() as Promise<{ ok: boolean; logs: AgentLogEntry[] }>,
        statusRes.json() as Promise<{ ok: boolean; agent: { recentExecutions: ExecutionRecord[] } }>,
      ]);

      setPerAgent((prev) => ({
        ...prev,
        [agentId]: {
          logs: logsData.ok ? logsData.logs : [],
          history: statusData.ok ? statusData.agent.recentExecutions ?? [] : [],
          currentOutput: prev[agentId]?.currentOutput ?? '',
        },
      }));
    } catch { /* non-fatal */ }
  }, []);

  // ── Execute a task ────────────────────────────────────────────────────────

  const executeTask = useCallback(async (agentId: string, task: string): Promise<ExecuteResult> => {
    // Optimistically set status to thinking
    setState((prev) => ({
      ...prev,
      agents: prev.agents.map((a) =>
        a.id === agentId
          ? { ...a, status: 'thinking', currentTask: task }
          : a,
      ),
    }));
    setPerAgent((prev) => ({
      ...prev,
      [agentId]: { ...(prev[agentId] ?? { logs: [], history: [], currentOutput: '' }), currentOutput: '' },
    }));

    try {
      const res = await fetch(`/api/agents/${agentId}/task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task }),
      });
      const data = await res.json() as ExecuteResult & { message?: string };
      if (!data.ok) {
        setState((prev) => ({
          ...prev,
          agents: prev.agents.map((a) => a.id === agentId ? { ...a, status: 'error' } : a),
        }));
        return { ok: false, error: data.message ?? 'Execution failed', execId: data.execId ?? '', tokens: { in: 0, out: 0 } };
      }

      setPerAgent((prev) => ({
        ...prev,
        [agentId]: {
          ...(prev[agentId] ?? { logs: [], history: [] }),
          currentOutput: data.output ?? '',
        },
      }));

      // Refresh logs after completion
      setTimeout(() => { void fetchLogs(agentId); }, 500);

      return data;
    } catch (err) {
      setState((prev) => ({
        ...prev,
        agents: prev.agents.map((a) => a.id === agentId ? { ...a, status: 'error' } : a),
      }));
      const message = err instanceof Error ? err.message : 'Network error';
      return { ok: false, error: message, execId: '', tokens: { in: 0, out: 0 } };
    }
  }, [fetchLogs]);

  // ── WebSocket: real-time status updates ──────────────────────────────────

  useEffect(() => {
    if (!lastMessage) return;
    const msg = lastMessage;

    if (msg.type === 'agent:status') {
      const agentId = msg.agentId as string;
      const status = msg.status as RealAgentLive['status'];
      const task = msg.task as string | undefined;
      setState((prev) => ({
        ...prev,
        agents: prev.agents.map((a) =>
          a.id === agentId
            ? { ...a, status, currentTask: task ?? a.currentTask }
            : a,
        ),
      }));
    }

    if (msg.type === 'agent:log') {
      const agentId = msg.agentId as string;
      const logEntry: AgentLogEntry = {
        id: msg.id as string,
        execId: (msg.execId as string | null) ?? null,
        level: msg.level as AgentLogEntry['level'],
        message: msg.message as string,
        data: (msg.data as Record<string, unknown> | null) ?? null,
        at: msg.at as string,
      };
      setPerAgent((prev) => ({
        ...prev,
        [agentId]: {
          ...(prev[agentId] ?? { history: [], currentOutput: '' }),
          logs: [logEntry, ...(prev[agentId]?.logs ?? [])].slice(0, 50),
        },
      }));
    }

    if (msg.type === 'agent:completed') {
      const agentId = msg.agentId as string;
      const output = msg.output as string;
      setPerAgent((prev) => ({
        ...prev,
        [agentId]: { ...(prev[agentId] ?? { logs: [], history: [] }), currentOutput: output },
      }));
      setTimeout(() => { void fetchLogs(agentId); }, 300);
    }
  }, [lastMessage, fetchLogs]);

  // ── Initial load + poll every 30s for provider config changes ────────────

  useEffect(() => {
    void refresh();
    pollRef.current = setInterval(() => { void refresh(); }, 30_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [refresh]);

  return {
    agents: state.agents,
    providers: state.providers,
    loading: state.loading,
    error: state.error,
    perAgent,
    executeTask,
    fetchLogs,
    refresh,
  };
}
