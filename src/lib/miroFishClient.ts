// Client for MiroFish quick-debate endpoint (runs at localhost:5001)
// Used by Decisions module to get multi-agent LLM debate on market questions.

const MIROFISH_BASE = 'http://localhost:5001/api/debate';

export interface AgentVote {
  agent: string;
  bias: string;
  vote: 'YES' | 'NO';
  reasoning: string;
  confidence: number;
}

export interface DebateResult {
  question: string;
  consensus: 'YES' | 'NO';
  confidence: number;
  yes_count: number;
  no_count: number;
  agent_count: number;
  votes: AgentVote[];
  summary: string;
  recommendation: 'BUY_YES' | 'BUY_NO' | 'PASS';
}

export type MiroFishStatus = 'idle' | 'loading' | 'ready' | 'error' | 'offline';

export async function checkMiroFishHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${MIROFISH_BASE}/health`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return false;
    const data = await res.json() as { success: boolean; llm_configured: boolean };
    return data.success && data.llm_configured;
  } catch {
    return false;
  }
}

export async function runQuickDebate(
  question: string,
  context: string,
  agentCount = 5,
): Promise<DebateResult> {
  const res = await fetch(`${MIROFISH_BASE}/quick-debate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, context, agent_count: agentCount }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? `MiroFish error ${res.status}`);
  }
  const data = await res.json() as { success: boolean; data: DebateResult };
  if (!data.success) throw new Error('MiroFish returned success=false');
  return data.data;
}
