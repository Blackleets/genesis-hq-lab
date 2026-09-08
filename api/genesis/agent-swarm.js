import { sendJson, sendMethodNotAllowed } from '../_lib/http.js';

const SWARM_URL = 'https://raw.githubusercontent.com/Blackleets/genesis-hq-lab/capture-tape/paper-tape/agent-swarm-latest.json';
const MAX_OUTPUT = 2600;

function clip(value, max = MAX_OUTPUT) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return null;
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function safeAgent(row) {
  if (!row || typeof row !== 'object' || typeof row.id !== 'string') return null;
  return {
    id: row.id,
    name: typeof row.name === 'string' ? row.name : row.id,
    role: typeof row.role === 'string' ? row.role : 'UNAVAILABLE',
    status: typeof row.status === 'string' ? row.status : 'unavailable',
    engine: row.engine === 'llm' ? 'llm' : 'deterministic_guardrail',
    provider: typeof row.provider === 'string' ? row.provider : null,
    model: typeof row.model === 'string' ? row.model : null,
    tokens: {
      in: Number.isFinite(Number(row.tokens?.in)) ? Number(row.tokens.in) : 0,
      out: Number.isFinite(Number(row.tokens?.out)) ? Number(row.tokens.out) : 0,
    },
    startedAt: typeof row.startedAt === 'string' ? row.startedAt : null,
    completedAt: typeof row.completedAt === 'string' ? row.completedAt : null,
    output: clip(row.output),
    error: clip(row.error, 500),
  };
}

function safeEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object') return null;
  return {
    capture: {
      ts: evidence.capture?.ts ?? null,
      venue: evidence.capture?.venue ?? null,
      scored: Number.isFinite(Number(evidence.capture?.scored)) ? Number(evidence.capture.scored) : null,
      quoted: Number.isFinite(Number(evidence.capture?.quoted)) ? Number(evidence.capture.quoted) : null,
      reasons: Array.isArray(evidence.capture?.reasons) ? evidence.capture.reasons.slice(0, 6) : [],
    },
    funding: {
      ts: evidence.funding?.ts ?? null,
      economicPnlUsdt: Number.isFinite(Number(evidence.funding?.economicPnlUsdt)) ? Number(evidence.funding.economicPnlUsdt) : null,
      equityUsdt: Number.isFinite(Number(evidence.funding?.equityUsdt)) ? Number(evidence.funding.equityUsdt) : null,
      feesUsdt: Number.isFinite(Number(evidence.funding?.feesUsdt)) ? Number(evidence.funding.feesUsdt) : null,
      feeLock: evidence.funding?.feeLock === true,
      feeLockReason: typeof evidence.funding?.feeLockReason === 'string' ? evidence.funding.feeLockReason : null,
    },
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendMethodNotAllowed(res);
  try {
    const response = await fetch(SWARM_URL, { cache: 'no-store', signal: AbortSignal.timeout(3500) });
    if (!response.ok) throw new Error(`paper_swarm_tape_${response.status}`);
    const payload = await response.json();
    const boundaryVerified = payload?.paperOnly === true
      && payload?.liveOrders === false
      && payload?.executionAuthority === false
      && payload?.capitalEligible === false;
    if (!boundaryVerified) throw new Error('paper_swarm_boundary_unverified');

    const agents = Array.isArray(payload.agents) ? payload.agents.map(safeAgent).filter(Boolean).slice(0, 8) : [];
    return sendJson(res, 200, {
      ok: true,
      version: typeof payload.version === 'string' ? payload.version : 'unavailable',
      updatedAt: typeof payload.ts === 'string' ? payload.ts : null,
      paperOnly: true,
      liveOrders: false,
      executionAuthority: false,
      capitalEligible: false,
      source: 'github_capture_tape',
      llmProvider: typeof payload.llmProvider === 'string' ? payload.llmProvider : null,
      llmActive: payload.llmActive === true,
      providerConfigured: payload.providerConfigured === true,
      agents,
      totals: {
        agents: Number.isFinite(Number(payload.totals?.agents)) ? Number(payload.totals.agents) : agents.length,
        completedLlm: Number.isFinite(Number(payload.totals?.completedLlm)) ? Number(payload.totals.completedLlm) : agents.filter((agent) => agent.engine === 'llm').length,
        fallback: Number.isFinite(Number(payload.totals?.fallback)) ? Number(payload.totals.fallback) : agents.filter((agent) => agent.engine !== 'llm').length,
        tokens: {
          in: Number.isFinite(Number(payload.totals?.tokens?.in)) ? Number(payload.totals.tokens.in) : 0,
          out: Number.isFinite(Number(payload.totals?.tokens?.out)) ? Number(payload.totals.tokens.out) : 0,
        },
      },
      final: {
        verdict: typeof payload.final?.verdict === 'string' ? payload.final.verdict : 'UNAVAILABLE',
        blockers: Array.isArray(payload.final?.blockers) ? payload.final.blockers.filter((item) => typeof item === 'string').slice(0, 8) : [],
      },
      evidence: safeEvidence(payload.evidence),
    });
  } catch (error) {
    return sendJson(res, 200, {
      ok: false,
      paperOnly: true,
      liveOrders: false,
      executionAuthority: false,
      capitalEligible: false,
      source: 'github_capture_tape',
      error: error instanceof Error ? error.message : 'paper_swarm_unavailable',
      agents: [],
      final: { verdict: 'UNAVAILABLE', blockers: [] },
      updatedAt: null,
    });
  }
}
