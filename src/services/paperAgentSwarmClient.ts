import { fetchApi } from '@services/apiBase';

export interface PaperAgentSwarmAgent {
  id: string;
  name: string;
  role: string;
  status: string;
  engine: 'llm' | 'deterministic_guardrail';
  provider: string | null;
  model: string | null;
  tokens: { in: number; out: number };
  startedAt: string | null;
  completedAt: string | null;
  output: string | null;
  error: string | null;
}

export interface PaperAgentSwarmSnapshot {
  ok: boolean;
  version?: string;
  updatedAt: string | null;
  paperOnly: true;
  liveOrders: false;
  executionAuthority: false;
  capitalEligible: false;
  source: 'github_capture_tape';
  llmProvider?: string | null;
  llmActive?: boolean;
  providerConfigured?: boolean;
  agents: PaperAgentSwarmAgent[];
  totals?: {
    agents: number;
    completedLlm: number;
    fallback: number;
    tokens: { in: number; out: number };
  };
  final: {
    verdict: string;
    blockers: string[];
  };
  evidence?: {
    capture: {
      ts: string | null;
      venue: string | null;
      scored: number | null;
      quoted: number | null;
      reasons: Array<{ reason?: string; count?: number }>;
    };
    funding: {
      ts: string | null;
      economicPnlUsdt: number | null;
      equityUsdt: number | null;
      feesUsdt: number | null;
      feeLock: boolean;
      feeLockReason: string | null;
    };
  } | null;
  error?: string;
}

export async function fetchPaperAgentSwarm(signal?: AbortSignal): Promise<PaperAgentSwarmSnapshot> {
  const response = await fetchApi('/api/genesis/capture?view=agent-swarm', { cache: 'no-store', signal });
  if (!response.ok) throw new Error(`genesis/capture agent-swarm ${response.status}`);
  const payload = await response.json() as PaperAgentSwarmSnapshot;
  if (payload.paperOnly !== true || payload.liveOrders !== false || payload.executionAuthority !== false || payload.capitalEligible !== false) {
    throw new Error('paper_agent_swarm_boundary_unverified');
  }
  return payload;
}
