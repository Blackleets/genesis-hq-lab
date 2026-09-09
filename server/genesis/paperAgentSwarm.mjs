import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { getAllAgents } from '../agents/agentRegistry.mjs';
import { isProviderConfigured, routeToProvider } from '../agents/providerRouter.mjs';

const SWARM_VERSION = 'paper_agent_swarm_v2_forward_evidence';
const AGENT_IDS = ['atlas', 'nova', 'sentinel', 'curator', 'arbiter'];
const PROVIDER_ORDER = ['openai', 'nvidia', 'groq', 'gemini', 'claude', 'custom'];
const HARD_BOUNDARY = `
PAPER SWARM HARD BOUNDARY:
- This is PAPER evidence only.
- You have zero execution authority and cannot place, route, sign, or approve a live order.
- Never infer missing market facts. Use only the supplied evidence JSON and prior agent notes.
- Capital eligibility is false. LIVE remains locked.
- Forward PAPER evidence can justify more PAPER observation only, never LIVE promotion.
- Recommendations must be framed as PAPER observation, PAPER experiment, WAIT, SKIP, WARN, or VETO.
- Return final conclusions only. Do not expose chain-of-thought or hidden reasoning.
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

function compactForward(forward) {
  if (!forward) return null;
  const boundaryVerified = forward.paperOnly === true
    && forward.liveOrders === false
    && forward.executionAuthority === false
    && forward.capitalEligible === false;
  if (!boundaryVerified) throw new Error('paper_swarm_forward_boundary_failed');
  const families = Array.isArray(forward.families) ? forward.families.slice(0, 6).map((family) => ({
    familyKey: family.familyKey ?? null,
    championId: family.championId ?? null,
    variantCount: finite(family.variantCount),
    independentEvidenceUnits: finite(family.independentEvidenceUnits),
    championForward: {
      trades: finite(family?.championForward?.trades),
      expectancyBps: finite(family?.championForward?.expectancyBps),
      profitFactor: finite(family?.championForward?.profitFactor),
      tStat: finite(family?.championForward?.tStat),
      maxDrawdownPct: finite(family?.championForward?.maxDrawdownPct),
    },
    evidenceStatus: family.championEvidenceStatus ?? null,
    forwardGate: family.forwardGate ?? null,
    nextStageEligible: family.nextStageEligible === true,
    liveEligible: false,
  })) : [];
  return {
    ts: forward.completedAt ?? null,
    mode: forward.mode ?? 'FORWARD_PAPER_RESEARCH',
    enrolled: finite(forward.enrolled),
    familyCount: finite(forward.familyCount),
    openShadows: finite(forward.openShadows),
    families,
  };
}

function buildEvidence(capture, funding, hz1, forward) {
  if (capture?.paper !== true || capture?.liveOff !== true) throw new Error('paper_swarm_capture_boundary_failed');
  if (funding?.paper !== true || funding?.liveOff !== true) throw new Error('paper_swarm_funding_boundary_failed');
  if (hz1 && (hz1.paper !== true || hz1.liveOff !== true)) throw new Error('paper_swarm_hz1_boundary_failed');
  const truth = funding?.truthLedger && typeof funding.truthLedger === 'object' ? funding.truthLedger : {};
  return {
    safety: { paperOnly: true, liveOrders: false, executionAuthority: false, capitalEligible: false, liveOff: true },
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
    forwardResearch: compactForward(forward),
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

function forwardSummary(evidence) {
  const f = evidence.forwardResearch;
  const family = f?.families?.[0];
  if (!family) return 'No forward PAPER family is enrolled.';
  const m = family.championForward;
  return `${family.familyKey}; champion=${family.championId}; trades=${m.trades ?? 0}; expectancy=${m.expectancyBps ?? 'NA'}bps; PF=${m.profitFactor ?? 'NA'}; t=${m.tStat ?? 'NA'}; gate=${family.forwardGate ?? 'UNAVAILABLE'}`;
}

function deterministicOutput(agentId, evidence) {
  const quoted = evidence.capture.quoted ?? 0;
  const economic = evidence.funding.economicPnlUsdt;
  const feeLock = evidence.funding.feeLock;
  const reasons = reasonSummary(evidence);
  const forward = forwardSummary(evidence);
  const forwardEligible = evidence.forwardResearch?.families?.some((f) => f.nextStageEligible) === true;

  switch (agentId) {
    case 'atlas':
      return `VERDICT: ${forwardEligible ? 'FORWARD PAPER EVIDENCE PASSED GATE' : 'CONTINUE PAPER OBSERVATION'}\nEVIDENCE: ${evidence.capture.scored ?? 'UNAVAILABLE'} scanned, ${quoted} quoted. ${forward}.\nNEXT PAPER ACTION: Keep collecting new completed-candle evidence for the frozen champion.\nBLOCKERS: ${feeLock ? `Fee lock active (${evidence.funding.feeLockReason ?? 'reason unavailable'}).` : 'Forward sample/gate remains authoritative.'}`;
    case 'nova':
      return `VERDICT: ${forwardEligible ? 'PAPER NEXT-STAGE REVIEW' : 'NO PROMOTION'}\nEVIDENCE: ${forward}.\nNEXT PAPER ACTION: Do not retune the frozen champion from forward outcomes; challengers remain correlated evidence only.\nBLOCKERS: ${forwardEligible ? 'Human review still required; LIVE remains locked.' : 'Forward gate not yet passed.'}`;
    case 'sentinel':
      return `VERDICT: ${feeLock || !forwardEligible ? 'VETO' : 'WARN'}\nEVIDENCE: Economic P&L ${money(economic)}; fee lock ${feeLock ? 'ON' : 'OFF'}; ${forward}.\nNEXT PAPER ACTION: ${forwardEligible ? 'Permit PAPER-only next-stage review.' : 'Keep capital eligibility false and continue forward observation.'}\nBLOCKERS: No live capital path is authorized by this swarm.`;
    case 'curator':
      return `VERDICT: LEARN\nEVIDENCE: ${forward}.\nNEXT PAPER ACTION: Preserve the champion freeze and record forward outcomes as new evidence, not as parameter-selection data.\nBLOCKERS: Correlated challengers must never count as independent confirmations.`;
    case 'arbiter':
      return `VERDICT: ${feeLock || !forwardEligible ? 'STAND DOWN' : 'PAPER NEXT-STAGE REVIEW ONLY'}\nEVIDENCE: ${forward}; economic P&L ${money(economic)}; live authority OFF.\nNEXT PAPER ACTION: ${forwardEligible ? 'Escalate only to the next PAPER validation stage.' : 'Continue collecting forward evidence.'}\nBLOCKERS: LIVE orders, execution authority, and capital eligibility remain false.`;
    default:
      return 'VERDICT: UNAVAILABLE';
  }
}

function finalDecision(evidence) {
  const blockers = [];
  if ((evidence.capture.quoted ?? 0) === 0) blockers.push('NO_QUOTED_CANDIDATES');
  if (evidence.funding.feeLock) blockers.push(evidence.funding.feeLockReason || 'FEE_LOCK');
  if (evidence.funding.economicPnlUsdt != null && evidence.funding.economicPnlUsdt < 0) blockers.push('NEGATIVE_ECONOMIC_PNL');
  const families = evidence.forwardResearch?.families ?? [];
  if (families.length && !families.some((f) => f.nextStageEligible)) blockers.push('FORWARD_EDGE_NOT_PROVEN');
  return {
    verdict: blockers.length ? 'STAND_DOWN' : 'PAPER_REVIEW_ONLY',
    blockers,
    forwardFamilies: families.length,
    forwardNextStageEligible: families.some((f) => f.nextStageEligible),
    executionAuthority: false,
    liveOrders: false,
    capitalEligible: false,
  };
}

function clip(value, max = 1800) {
  const text = String(value ?? '').trim();
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

async function runAgent(def, provider, evidence, prior) {
  const startedAt = new Date().toISOString();
  const priorContext = Object.entries(prior).map(([id, output]) => `${id.toUpperCase()}: ${clip(output, 800)}`).join('\n\n');
  const task = [
    'Review the verified Genesis PAPER evidence below in your assigned role.',
    'Return ONLY four compact sections: VERDICT, EVIDENCE, NEXT PAPER ACTION, BLOCKERS.',
    'Do not provide chain-of-thought, hidden reasoning, or a reasoning transcript.',
    `EVIDENCE JSON:\n${JSON.stringify(evidence)}`,
    priorContext ? `PRIOR AGENT NOTES:\n${priorContext}` : '',
  ].filter(Boolean).join('\n\n');

  if (!provider) {
    return {
      id: def.id, name: def.name, role: def.role, status: 'fallback_complete', engine: 'deterministic_guardrail',
      provider: null, model: null, tokens: { in: 0, out: 0 }, startedAt, completedAt: new Date().toISOString(),
      output: deterministicOutput(def.id, evidence), error: 'Provider not configured',
    };
  }

  try {
    const config = { provider, maxTokens: 350, timeoutMs: 45_000 };
    if (process.env.GENESIS_PAPER_AGENT_MODEL) config.modelId = process.env.GENESIS_PAPER_AGENT_MODEL;
    else if (provider === 'claude') config.modelId = def.modelId;
    const result = await routeToProvider([{ role: 'user', content: task }], `${def.systemPrompt}\n${HARD_BOUNDARY}`, config);
    return {
      id: def.id, name: def.name, role: def.role, status: 'completed', engine: 'llm', provider: result.provider,
      model: result.model, tokens: { in: result.inputTokens, out: result.outputTokens }, startedAt,
      completedAt: new Date().toISOString(), output: clip(result.content), error: null,
    };
  } catch (error) {
    return {
      id: def.id, name: def.name, role: def.role, status: 'fallback_complete', engine: 'deterministic_guardrail',
      provider, model: null, tokens: { in: 0, out: 0 }, startedAt, completedAt: new Date().toISOString(),
      output: deterministicOutput(def.id, evidence), error: clip(error instanceof Error ? error.message : String(error), 500),
    };
  }
}

async function main() {
  const capturePath = arg('--capture', 'paper-tape/capture-latest.json');
  const fundingPath = arg('--funding', 'paper-tape/funding-latest.json');
  const hz1Path = arg('--hz1', 'paper-tape/hz1-latest.json');
  const forwardPath = arg('--forward', 'quant-evidence/forward-paper-latest.json');
  const outPath = arg('--out', 'paper-tape/agent-swarm-latest.json');
  const jsonlPath = arg('--jsonl', 'paper-tape/agent-swarm.jsonl');

  const capture = readJson(capturePath);
  const funding = readJson(fundingPath);
  const hz1 = readJson(hz1Path, false);
  const forward = readJson(forwardPath, false);
  const evidence = buildEvidence(capture, funding, hz1, forward);
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

  const tokens = agents.reduce((sum, agent) => ({ in: sum.in + Number(agent.tokens?.in || 0), out: sum.out + Number(agent.tokens?.out || 0) }), { in: 0, out: 0 });
  const errors = agents.filter((agent) => agent.error && agent.error !== 'Provider not configured').map((agent) => ({ agentId: agent.id, error: agent.error }));
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
    forwardFamilies: snapshot.final.forwardFamilies,
    forwardNextStageEligible: snapshot.final.forwardNextStageEligible,
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
