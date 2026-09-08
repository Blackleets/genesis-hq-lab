import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { getAllAgents } from '../agents/agentRegistry.mjs';
import { isProviderConfigured, routeToProvider } from '../agents/providerRouter.mjs';

const SWARM_VERSION = 'paper_agent_swarm_v1';
const AGENT_IDS = ['atlas', 'nova', 'sentinel', 'curator', 'arbiter'];
const PROVIDER_ORDER = ['groq', 'gemini', 'claude', 'openai', 'custom'];
const HARD_BOUNDARY = `
PAPER SWARM HARD BOUNDARY:
- This is PAPER evidence only.
- You have zero execution authority and cannot place, route, sign, or approve a live order.
- Never infer missing market facts. Use only the supplied evidence JSON and prior agent notes.
- Capital eligibility is false. LIVE remains locked.
- Recommendations must be framed as PAPER observation, PAPER experiment, WAIT, SKIP, WARN, or VETO.
- If evidence is insufficient, say so explicitly.
`;

function arg(name, fallback = null) {
  const prefix = `${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function readJson(path, required = true) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    if (!required) return null;
    throw new Error(`paper_swarm_read_failed:${path}:${error instanceof Error ? error.message : String(error)}`);
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function appendJsonl(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(value)}\n`, 'utf8');
}

function finite(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function topReasons(reasons) {
  if (!reasons || typeof reasons !== 'object') return [];
  return Object.entries(reasons)
    .map(([reason, count]) => ({ reason, count: Number(count) || 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
}

function compactRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row) => row && typeof row.symbol === 'string')
    .sort((a, b) => {
      if (Boolean(a.quote) !== Boolean(b.quote)) return a.quote ? -1 : 1;
      return (finite(b.harvestBps) ?? Number.NEGATIVE_INFINITY) - (finite(a.harvestBps) ?? Number.NEGATIVE_INFINITY);
    })
    .slice(0, 10)
    .map((row) => ({
      symbol: row.symbol,
      quote: row.quote === true,
      reason: row.reason ?? null,
      harvestBps: finite(row.harvestBps),
      spreadBps: finite(row.spreadBps),
      vpin: finite(row.vpin),
      fair: finite(row.fair),
      mid: finite(row.mid),
    }));
}

function buildEvidence(capture, funding, hz1) {
  if (capture?.paper !== true || capture?.liveOff !== true) {
    throw new Error('paper_swarm_capture_boundary_failed');
  }
  if (funding?.paper !== true || funding?.liveOff !== true) {
    throw new Error('paper_swarm_funding_boundary_failed');
  }
  if (hz1 && (hz1.paper !== true || hz1.liveOff !== true)) {
    throw new Error('paper_swarm_hz1_boundary_failed');
  }

  const truth = funding?.truthLedger && typeof funding.truthLedger === 'object' ? funding.truthLedger : {};
  return {
    safety: {
      paperOnly: true,
      liveOrders: false,
      executionAuthority: false,
      capitalEligible: false,
      liveOff: true,
    },
    capture: {
      ts: capture.ts ?? null,
      venue: capture.venue ?? null,
      universe: finite(capture.universe),
      scored: finite(capture.scored),
      quoted: finite(capture.quoted),
      go: capture.go === true,
      reasons: topReasons(capture.reasons),
      candidates: compactRows(capture.rows),
    },
    funding: {
      ts: funding.ts ?? null,
      capitalUsdt: finite(funding.capital),
      realizedFundingUsdt: finite(funding.realizedFundingUsdt),
      realizedPricePnlUsdt: finite(funding.realizedPricePnlUsdt ?? truth.realizedPricePnlUsdt),
      feesUsdt: finite(funding.feesUsdt),
      economicPnlUsdt: finite(funding.economicPnlUsdt ?? truth.economicPnlUsdt),
      equityUsdt: finite(funding.equityUsdt ?? truth.equityUsdt),
      settledCount: finite(funding.settledCount),
      openHolds: Array.isArray(funding.holds) ? funding.holds.length : finite(truth.openHolds),
      closedCount: Array.isArray(funding.closed) ? funding.closed.length : finite(truth.closedCount),
      feeLock: funding.feeLock === true,
      feeLockReason: funding.feeLockReason ?? null,
      note: typeof funding.note === 'string' ? funding.note.slice(0, 500) : null,
    },
    hz1: hz1 ? {
      ts: hz1.ts ?? null,
      preQuote: finite(hz1.preQuote),
      quoted: finite(hz1.quoted),
      filled: finite(hz1.filled),
      paperPnl: finite(hz1.paperPnl),
      reasons: topReasons(hz1.reasons),
    } : null,
  };
}

function selectProvider() {
  const override = String(process.env.GENESIS_PAPER_AGENT_PROVIDER || '').trim().toLowerCase();
  const candidates = override ? [override] : PROVIDER_ORDER;
  return candidates.find((provider) => PROVIDER_ORDER.includes(provider) && isProviderConfigured(provider)) ?? null;
}

function reasonSummary(evidence) {
  const reasons = evidence.capture.reasons.map((item) => `${item.reason}=${item.count}`).join(', ');
  return reasons || 'no reason histogram available';
}

function money(value) {
  return value == null ? 'UNAVAILABLE' : `${value >= 0 ? '+' : ''}$${value.toFixed(2)}`;
}

function deterministicOutput(agentId, evidence) {
  const quoted = evidence.capture.quoted ?? 0;
  const economic = evidence.funding.economicPnlUsdt;
  const feeLock = evidence.funding.feeLock;
  const reasons = reasonSummary(evidence);

  switch (agentId) {
    case 'atlas':
      return `VERDICT: ${quoted > 0 ? 'PAPER CANDIDATES OBSERVED' : 'SKIP / NO QUOTABLE PAPER EDGE'}\nEVIDENCE: ${evidence.capture.scored ?? 'UNAVAILABLE'} names scored, ${quoted} quoted. Blockers: ${reasons}. Funding economic P&L ${money(economic)}.\nNEXT PAPER ACTION: Keep observing verified tape; do not infer an entry where the capture engine emitted none.\nBLOCKERS: ${feeLock ? `Fee lock active (${evidence.funding.feeLockReason ?? 'reason unavailable'}).` : 'No fee lock reported.'}`;
    case 'nova':
      return `STRATEGY STRENGTH: ${quoted > 0 && !feeLock ? 'WEAK / REVIEW PAPER ONLY' : 'NO-TRADE'}\nTHESIS: The current verified tape does not justify fabricating a setup. ${quoted} quotable candidates are present and the economic ledger is ${money(economic)}.\nENTRY CRITERIA: Only re-evaluate a PAPER thesis when the capture engine itself emits a candidate and current economic guardrails do not veto it.\nEXIT / INVALIDATION: Any fee-lock, toxic-flow, would-cross, or evidence-quality veto keeps the desk stood down.`;
    case 'sentinel':
      return `VERDICT: ${feeLock || quoted === 0 || (economic != null && economic < 0) ? 'VETO' : 'WARN'}\nRISK: PAPER only; liveOrders=false; executionAuthority=false. Economic P&L ${money(economic)}; fee lock ${feeLock ? 'ON' : 'OFF'}; quoted candidates ${quoted}.\nACTION: ${feeLock ? 'Do not add new PAPER risk while fees dominate.' : 'Any candidate remains PAPER-review only.'}\nTAIL CHECK: No live capital path is authorized by this swarm.`;
    case 'curator':
      return `LESSON: ${feeLock ? 'When fees dominate realized capture, stop opening new PAPER tickets until the ledger proves the economics have improved.' : 'Do not convert scan activity into a trade narrative unless the execution tape emits a verified candidate.'}\nSEVERITY: ${feeLock || (economic != null && economic < 0) ? 'WARNING' : 'INFO'}\nEVIDENCE: Economic P&L ${money(economic)}; ${quoted} quoted; blockers ${reasons}.\nVETO PATTERN: Preserve the existing fee/toxicity guardrails; no new live rule is created here.`;
    case 'arbiter':
      return `RECOMMENDATION: ${feeLock || quoted === 0 || (economic != null && economic < 0) ? 'STAND DOWN' : 'REVIEW PAPER CANDIDATES ONLY'}\nCONFIDENCE: Evidence-bound, not predictive.\nPIVOTAL FACTS: ${quoted} quoted candidates; economic P&L ${money(economic)}; fee lock ${feeLock ? 'ON' : 'OFF'}; live authority OFF.\nNEXT STEP: Continue PAPER evidence collection and let Sentinel/Truth Ledger veto any setup that is not economically proven.`;
    default:
      return 'STATUS: No deterministic paper policy is registered for this agent.';
  }
}

function finalDecision(evidence) {
  const blockers = [];
  if ((evidence.capture.quoted ?? 0) === 0) blockers.push('NO_QUOTED_CANDIDATES');
  if (evidence.funding.feeLock) blockers.push(evidence.funding.feeLockReason || 'FEE_LOCK');
  if (evidence.funding.economicPnlUsdt != null && evidence.funding.economicPnlUsdt < 0) blockers.push('NEGATIVE_ECONOMIC_PNL');
  return {
    verdict: blockers.length ? 'STAND_DOWN' : 'PAPER_REVIEW_ONLY',
    blockers,
    executionAuthority: false,
    liveOrders: false,
    capitalEligible: false,
  };
}

function clip(value, max = 2400) {
  const text = String(value ?? '').trim();
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

async function runAgent(def, provider, evidence, prior) {
  const startedAt = new Date().toISOString();
  const priorContext = Object.entries(prior)
    .map(([id, output]) => `${id.toUpperCase()}: ${clip(output, 1200)}`)
    .join('\n\n');
  const task = [
    'Review the verified Genesis PAPER evidence below in your assigned role.',
    'Return compact sections with an explicit verdict, the evidence you used, the next PAPER action, and blockers.',
    `EVIDENCE JSON:\n${JSON.stringify(evidence)}`,
    priorContext ? `PRIOR AGENT NOTES:\n${priorContext}` : '',
  ].filter(Boolean).join('\n\n');

  if (!provider) {
    return {
      id: def.id,
      name: def.name,
      role: def.role,
      status: 'fallback_complete',
      engine: 'deterministic_guardrail',
      provider: null,
      model: null,
      tokens: { in: 0, out: 0 },
      startedAt,
      completedAt: new Date().toISOString(),
      output: deterministicOutput(def.id, evidence),
      error: 'Provider not configured',
    };
  }

  try {
    const config = {
      provider,
      maxTokens: 700,
      timeoutMs: 30_000,
    };
    if (process.env.GENESIS_PAPER_AGENT_MODEL) config.modelId = process.env.GENESIS_PAPER_AGENT_MODEL;
    else if (provider === 'claude') config.modelId = def.modelId;
    const result = await routeToProvider(
      [{ role: 'user', content: task }],
      `${def.systemPrompt}\n${HARD_BOUNDARY}`,
      config,
    );
    return {
      id: def.id,
      name: def.name,
      role: def.role,
      status: 'completed',
      engine: 'llm',
      provider: result.provider,
      model: result.model,
      tokens: { in: result.inputTokens, out: result.outputTokens },
      startedAt,
      completedAt: new Date().toISOString(),
      output: clip(result.content),
      error: null,
    };
  } catch (error) {
    return {
      id: def.id,
      name: def.name,
      role: def.role,
      status: 'fallback_complete',
      engine: 'deterministic_guardrail',
      provider,
      model: null,
      tokens: { in: 0, out: 0 },
      startedAt,
      completedAt: new Date().toISOString(),
      output: deterministicOutput(def.id, evidence),
      error: clip(error instanceof Error ? error.message : String(error), 500),
    };
  }
}

async function main() {
  const capturePath = arg('--capture', 'paper-tape/capture-latest.json');
  const fundingPath = arg('--funding', 'paper-tape/funding-latest.json');
  const hz1Path = arg('--hz1', 'paper-tape/hz1-latest.json');
  const outPath = arg('--out', 'paper-tape/agent-swarm-latest.json');
  const jsonlPath = arg('--jsonl', 'paper-tape/agent-swarm.jsonl');

  const capture = readJson(capturePath);
  const funding = readJson(fundingPath);
  const hz1 = readJson(hz1Path, false);
  const evidence = buildEvidence(capture, funding, hz1);
  const provider = selectProvider();
  const definitions = getAllAgents().filter((agent) => AGENT_IDS.includes(agent.id));
  const byId = new Map(definitions.map((agent) => [agent.id, agent]));
  const agents = [];
  const prior = {};

  for (const id of AGENT_IDS) {
    const def = byId.get(id);
    if (!def) throw new Error(`paper_swarm_agent_missing:${id}`);
    const result = await runAgent(def, provider, evidence, prior);
    agents.push(result);
    prior[id] = result.output;
  }

  const tokens = agents.reduce((sum, agent) => ({
    in: sum.in + Number(agent.tokens?.in || 0),
    out: sum.out + Number(agent.tokens?.out || 0),
  }), { in: 0, out: 0 });
  const errors = agents.filter((agent) => agent.error && agent.error !== 'Provider not configured')
    .map((agent) => ({ agentId: agent.id, error: agent.error }));
  const snapshot = {
    version: SWARM_VERSION,
    ts: new Date().toISOString(),
    paperOnly: true,
    liveOrders: false,
    executionAuthority: false,
    capitalEligible: false,
    source: 'github_capture_tape',
    llmProvider: provider,
    llmActive: agents.some((agent) => agent.engine === 'llm'),
    providerConfigured: Boolean(provider),
    evidence,
    agents,
    totals: { agents: agents.length, completedLlm: agents.filter((agent) => agent.engine === 'llm').length, fallback: agents.filter((agent) => agent.engine !== 'llm').length, tokens },
    final: finalDecision(evidence),
    errors,
  };

  writeJson(outPath, snapshot);
  appendJsonl(jsonlPath, snapshot);
  console.log(JSON.stringify({
    ok: true,
    version: snapshot.version,
    provider: snapshot.llmProvider ?? 'deterministic_guardrail',
    llmActive: snapshot.llmActive,
    verdict: snapshot.final.verdict,
    agents: snapshot.agents.map((agent) => ({ id: agent.id, status: agent.status, engine: agent.engine })),
    paperOnly: true,
    liveOrders: false,
    executionAuthority: false,
  }));
}

main().catch((error) => {
  console.error(`[paperAgentSwarm] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
