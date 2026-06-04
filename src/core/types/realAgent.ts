// Real AI agent execution types — separate from the visual simulation layer.
// States come from actual LLM execution, not timers.

export type RealAgentStatus =
  | 'idle'
  | 'thinking'
  | 'processing'
  | 'researching'
  | 'executing'
  | 'completed'
  | 'error';

export interface RealAgentDef {
  id: string;
  name: string;
  role: string;
  department: string;
  provider: 'claude' | 'openai' | 'gemini' | 'custom';
  modelId: string;
  accent: string;
  providerConfigured: boolean;
}

export interface RealAgentLive extends RealAgentDef {
  status: RealAgentStatus;
  currentExecId: string | null;
  currentTask: string | null;
}

export interface ExecutionRecord {
  id: string;
  task: string;
  status: RealAgentStatus;
  provider: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  output: string | null;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface AgentLogEntry {
  id: string;
  execId: string | null;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  data: Record<string, unknown> | null;
  at: string;
}

export interface ProviderInfo {
  configured: boolean;
  defaultModel: string;
}

export interface ExecuteResult {
  ok: boolean;
  output?: string;
  error?: string;
  execId: string;
  tokens: { in: number; out: number };
}
