import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { getAllAgents } from '../agents/agentRegistry.mjs';
import { isProviderConfigured, routeToProvider } from '../agents/providerRouter.mjs';
import {
  compactPortfolioRisk,
  compactResearchLifecycleForward,
  lifecycleForwardSummary,
  portfolioRiskBlocker,
  portfolioRiskSummary,
} from './portfolioRiskAgentEvidence.mjs';

const SWARM_VERSION = 'paper_agent_swarm_v4_portfolio_risk_evidence';
const AGENT_IDS = ['atlas', 'nova', 'sentinel', 'curator', 'arbiter'];
const PROVIDER_ORDER = ['openai', 'nvidia', 'groq', 'gemini', 'claude', 'custom'];
const HARD_BOUNDARY = `
PAPER SWARM HARD BOUNDARY:
- This is PAPER evidence only.
- You have zero execution authority and cannot place, route, sign, or approve a live order.
- Never infer missing market facts. Use only the supplied evidence JSON and prior agent notes.
- Capital eligibility is false. LIVE remains locked.
- Forward PAPER evidence can justify more PAPER observation only, never LIVE promotion.
- Portfolio risk evidence is advisory/research-only and cannot change production risk gates or size live capital.
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
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) {
    if (!required) return null;
    throw new Error(`paper_swarm_read_failed:${path}:${error instanceof Error ? error.message : String(error)}`);
  }
}
function writeJson(path, value) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }
function appendJsonl(path, value) { mkdirSync(dirname(path), { recursive: true }); appendFileSync(path, `${JSON.stringify(value)}\n`, 'utf8'); }
function finite(value) { if (value == null || value === '') return null; const n = Number(value); return Number.isFinite(n) ? n : null; }
function topReasons(reasons) { if (!reasons || typeof reasons !== 'object') return []; return Object.entries(reasons).map(([reason, count]) => ({ reason, count: Number(count) || 0 })).sort((a, b) => b.count - a.count).slice(0, 6); }
function compactRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.filter((row) => row && typeof row.symbol === 'string').sort((a, b) => Boolean(a.quote) !== Boolean(b.quote) ? (a.quote ? -1 : 1) : (finite(b.harvestBps) ?? -Infinity) - (finite(a.harvestBps) ?? -Infinity)).slice(0, 10).map((row) => ({ symbol: row.symbol, quote: row.quote === true, reason: row.reason ?? null, harvestBps: finite(row.harvestBps), spreadBps: finite(row.spreadBps), vpin: finite(row.vpin), fair: finite(row.fair), mid: finite(row.mid) }));
}
function compactForward(forward) {
  if (!forward) return null;
  if (!(forward.paperOnly === true && forward.liveOrders === false && forward.executionAuthority === false && forward.capitalEligible === false)) throw new Error('paper_swarm_forward_boundary_failed');
  const families = Array.isArray(forward.families) ? forward.families.slice(0, 6).map((family) => ({
    familyKey: family.familyKey ?? null,
    championId: family.championId ?? null,
    variantCount: finite(family.variantCount),
    independentEvidenceUnits: finite(family.independentEvidenceUnits),
    championForward: { trades: finite(family?.championForward?.trades), expectancyBps: finite(family?.championForward?.expectancyBps), profitFactor: finite(family?.championForward?.profitFactor), tStat: finite(family?.championForward?.tStat), maxDrawdownPct: finite(family?.championForward?.maxDrawdownPct) },
    evidenceStatus: family.championEvidenceStatus ?? null,
    forwardGate: family.forwardGate ?? null,
    nextStageEligible: family.nextStageEligible === true,
    liveEligible: false,
  })) : [];
  return { ts: forward.completedAt ?? null, mode: forward.mode ?? 'FORWARD_PAPER_RESEARCH', enrolled: finite(forward.enrolled), familyCount: finite(forward.familyCount), openShadows: finite(forward.openShadows), families };
}
function buildEvidence(capture, funding, hz1, forward, researchForward, portfolio) {
  if (capture?.paper !== true || capture?.liveOff !== true) throw new Error('paper_swarm_capture_boundary_failed');
  if (funding?.paper !== true || funding?.liveOff !== true) throw new Error('paper_swarm_funding_boundary_failed');
  if (hz1 && (hz1.paper !== true || hz1.liveOff !== true)) throw new Error('paper_swarm_hz1_boundary_failed');
  const truth = funding?.truthLedger && typeof funding.truthLedger === 'object' ? funding.truthLedger : {};
  return {
    safety: { paperOnly: true, liveOrders: false, executionAuthority: false, capitalEligible: false, liveOff: true },
    capture: { ts: capture.ts ?? null, venue: capture.venue ?? null, universe: finite(capture.universe), scored: finite(capture.scored), quoted: finite(capture.quoted), go: capture.go === true, reasons: topReasons(capture.reasons), candidates: compactRows(capture.rows) },
    funding: { ts: funding.ts ?? null, capitalUsdt: finite(funding.capital), realizedFundingUsdt: finite(funding.realizedFundingUsdt), realizedPricePnlUsdt: finite(funding.realizedPricePnlUsdt ?? truth.realizedPricePnlUsdt), feesUsdt: finite(funding.feesUsdt), economicPnlUsdt: finite(funding.economicPnlUsdt ?? truth.economicPnlUsdt), equityUsdt: finite(funding.equityUsdt ?? truth.equityUsdt), settledCount: finite(funding.settledCount), openHolds: Array.isArray(funding.holds) ? funding.holds.length : finite(truth.openHolds), closedCount: Array.isArray(funding.closed) ? funding.closed.length : finite(truth.closedCount), feeLock: funding.feeLock === true, feeLockReason: funding.feeLockReason ?? null, note: typeof funding.note === 'string' ? funding.note.slice(0, 500) : null },
    hz1: hz1 ? { ts: hz1.ts ?? null, preQuote: finite(hz1.preQuote), quoted: finite(hz1.quoted), filled: finite(hz1.filled), paperPnl: finite(hz1.paperPnl), reasons: topReasons(hz1.reasons) } : null,
    forwardResearch: compactForward(forward),
    researchLifecycleForward: compactResearchLifecycleForward(researchForward),
    portfolioRisk: compactPortfolioRisk(portfolio),
  };
}
function selectProvider() { const override = String(process.env.GENESIS_PAPER_AGENT_PROVIDER || '').trim().toLowerCase(); const candidates = override ? [override] : PROVIDER_ORDER; return candidates.find((p) => PROVIDER_ORDER.includes(p) && isProviderConfigured(p)) ?? null; }
function reasonSummary(evidence) { return evidence.capture.reasons.map((item) => `${item.reason}=${item.count}`).join(', ') || 'no reason histogram available'; }
function money(value) { return value == null ? 'UNAVAILABLE' : `${value >= 0 ? '+' : ''}$${value.toFixed(2)}`; }
function forwardSummary(evidence) {
  const family = evidence.forwardResearch?.families?.[0];
  if (!family) return 'No legacy forward PAPER family is enrolled.';
  const m = family.championForward;
  return `${family.familyKey}; champion=${family.championId}; trades=${m.trades ?? 0}; expectancy=${m.expectancyBps ?? 'NA'}bps; PF=${m.profitFactor ?? 'NA'}; t=${m.tStat ?? 'NA'}; gate=${family.forwardGate ?? 'UNAVAILABLE'}`;
}
function forwardEligible(evidence) {
  return evidence.forwardResearch?.families?.some((family) => family.nextStageEligible) === true
    || Number(evidence.researchLifecycleForward?.nextStageEligible ?? 0) > 0;
}
function deterministicOutput(agentId, evidence) {
  const quoted = evidence.capture.quoted ?? 0;
  const economic = evidence.funding.economicPnlUsdt;
  const feeLock = evidence.funding.feeLock;
  const forward = forwardSummary(evidence);
  const lifecycle = lifecycleForwardSummary(evidence.researchLifecycleForward);
  const portfolio = portfolioRiskSummary(evidence.portfolioRisk);
  const eligible = forwardEligible(evidence);
  const portfolioBlock = portfolioRiskBlocker(evidence.researchLifecycleForward, evidence.portfolioRisk);
  const paperReviewReady = eligible && !portfolioBlock;
  switch (agentId) {
    case 'atlas': return `VERDICT: ${paperReviewReady ? 'FORWARD PAPER EVIDENCE PASSED RISK REVIEW GATE' : 'CONTINUE PAPER OBSERVATION'}\nEVIDENCE: ${evidence.capture.scored ?? 'UNAVAILABLE'} scanned, ${quoted} quoted. ${forward}. ${lifecycle}. ${portfolio}.\nNEXT PAPER ACTION: ${portfolioBlock ? 'Accumulate or verify portfolio risk evidence before any next-stage PAPER review.' : 'Keep collecting new completed-candle evidence for frozen champions.'}\nBLOCKERS: ${portfolioBlock ?? (feeLock ? `Fee lock active (${evidence.funding.feeLockReason ?? 'reason unavailable'}).` : 'Forward and portfolio evidence remain authoritative.')}`;
    case 'nova': return `VERDICT: ${paperReviewReady ? 'PAPER NEXT-STAGE REVIEW' : 'NO PROMOTION'}\nEVIDENCE: ${lifecycle}. ${portfolio}.\nNEXT PAPER ACTION: Do not retune frozen champions from forward or portfolio outcomes; challengers remain correlated evidence only.\nBLOCKERS: ${portfolioBlock ?? (paperReviewReady ? 'Human review still required; LIVE remains locked.' : 'Forward gate not yet passed.')}`;
    case 'sentinel': return `VERDICT: ${feeLock || !paperReviewReady ? 'VETO' : 'WARN'}\nEVIDENCE: Economic P&L ${money(economic)}; fee lock ${feeLock ? 'ON' : 'OFF'}; ${lifecycle}; ${portfolio}.\nNEXT PAPER ACTION: ${paperReviewReady ? 'Permit PAPER-only next-stage review with portfolio evidence attached.' : 'Keep capital eligibility false and continue evidence collection.'}\nBLOCKERS: ${portfolioBlock ?? 'No live capital path is authorized by this swarm.'}`;
    case 'curator': return `VERDICT: LEARN\nEVIDENCE: ${lifecycle}. ${portfolio}.\nNEXT PAPER ACTION: Preserve champion freeze and record forward/portfolio outcomes as new evidence, never parameter-selection data.\nBLOCKERS: Correlated challengers must never count as independent confirmations; unsupported regime sizing remains unavailable.`;
    case 'arbiter': return `VERDICT: ${feeLock || !paperReviewReady ? 'STAND DOWN' : 'PAPER NEXT-STAGE REVIEW ONLY'}\nEVIDENCE: ${lifecycle}; ${portfolio}; economic P&L ${money(economic)}; live authority OFF.\nNEXT PAPER ACTION: ${paperReviewReady ? 'Escalate only to the next PAPER validation stage.' : 'Continue collecting verified forward and portfolio evidence.'}\nBLOCKERS: ${portfolioBlock ?? 'LIVE orders, execution authority, and capital eligibility remain false.'}`;
    default: return 'VERDICT: UNAVAILABLE\nEVIDENCE: UNAVAILABLE\nNEXT PAPER ACTION: WAIT\nBLOCKERS: Agent policy unavailable.';
  }
}
function finalDecision(evidence) {
  const blockers = [];
  if ((evidence.capture.quoted ?? 0) === 0) blockers.push('NO_QUOTED_CANDIDATES');
  if (evidence.funding.feeLock) blockers.push(evidence.funding.feeLockReason || 'FEE_LOCK');
  if (evidence.funding.economicPnlUsdt != null && evidence.funding.economicPnlUsdt < 0) blockers.push('NEGATIVE_ECONOMIC_PNL');
  const families = evidence.forwardResearch?.families ?? [];
  if (families.length && !families.some((family) => family.nextStageEligible)) blockers.push('FORWARD_EDGE_NOT_PROVEN');
  const lifecycle = evidence.researchLifecycleForward;
  if ((lifecycle?.enrolled ?? 0) > 0 && !(Number(lifecycle?.nextStageEligible ?? 0) > 0)) blockers.push('RESEARCH_FORWARD_EDGE_NOT_PROVEN');
  const portfolioBlock = portfolioRiskBlocker(lifecycle, evidence.portfolioRisk);
  if (portfolioBlock) blockers.push(portfolioBlock);
  return {
    verdict: blockers.length ? 'STAND_DOWN' : 'PAPER_REVIEW_ONLY',
    blockers,
    forwardFamilies: families.length,
    forwardNextStageEligible: families.some((family) => family.nextStageEligible),
    researchForwardEnrolled: finite(lifecycle?.enrolled),
    researchForwardNextStageEligible: finite(lifecycle?.nextStageEligible),
    portfolioRiskStatus: evidence.portfolioRisk?.status ?? null,
    portfolioRiskReady: evidence.portfolioRisk?.status === 'PORTFOLIO_RESEARCH_READY',
    executionAuthority: false,
    liveOrders: false,
    capitalEligible: false,
  };
}
function clip(value, max = 1800) { const text = String(value ?? '').trim(); return text.length <= max ? text : `${text.slice(0, max)}…`; }
function safeFinalOutput(value) {
  const text = String(value ?? '').trim();
  const lower = text.toLowerCase();
  const forbidden = ['thinking process', 'chain-of-thought', 'chain of thought', 'analyze user input', 'understand constraints', 'process the evidence', 'reasoning transcript'];
  if (!text || forbidden.some((needle) => lower.includes(needle))) return null;
  const required = ['VERDICT:', 'EVIDENCE:', 'NEXT PAPER ACTION:', 'BLOCKERS:'];
  if (!required.every((label) => text.toUpperCase().includes(label))) return null;
  return clip(text);
}
async function runAgent(def, provider, evidence, prior) {
  const startedAt = new Date().toISOString();
  const priorContext = Object.entries(prior).map(([id, output]) => `${id.toUpperCase()}: ${clip(output, 800)}`).join('\n\n');
  const task = ['Review the verified Genesis PAPER evidence below in your assigned role.', 'Return ONLY four compact sections: VERDICT, EVIDENCE, NEXT PAPER ACTION, BLOCKERS.', 'Do not provide chain-of-thought, hidden reasoning, analysis steps, or a reasoning transcript.', `EVIDENCE JSON:\n${JSON.stringify(evidence)}`, priorContext ? `PRIOR AGENT NOTES:\n${priorContext}` : ''].filter(Boolean).join('\n\n');
  if (!provider) return { id: def.id, name: def.name, role: def.role, status: 'fallback_complete', engine: 'deterministic_guardrail', provider: null, model: null, tokens: { in: 0, out: 0 }, startedAt, completedAt: new Date().toISOString(), output: deterministicOutput(def.id, evidence), error: 'Provider not configured' };
  try {
    const config = { provider, maxTokens: 350, timeoutMs: 45_000 };
    if (process.env.GENESIS_PAPER_AGENT_MODEL) config.modelId = process.env.GENESIS_PAPER_AGENT_MODEL; else if (provider === 'claude') config.modelId = def.modelId;
    const result = await routeToProvider([{ role: 'user', content: task }], `${def.systemPrompt}\n${HARD_BOUNDARY}`, config);
    const safeOutput = safeFinalOutput(result.content);
    if (!safeOutput) return { id: def.id, name: def.name, role: def.role, status: 'fallback_complete', engine: 'deterministic_guardrail', provider: result.provider, model: result.model, tokens: { in: result.inputTokens, out: result.outputTokens }, startedAt, completedAt: new Date().toISOString(), output: deterministicOutput(def.id, evidence), error: 'llm_output_rejected_by_firewall' };
    return { id: def.id, name: def.name, role: def.role, status: 'completed', engine: 'llm', provider: result.provider, model: result.model, tokens: { in: result.inputTokens, out: result.outputTokens }, startedAt, completedAt: new Date().toISOString(), output: safeOutput, error: null };
  } catch (error) {
    return { id: def.id, name: def.name, role: def.role, status: 'fallback_complete', engine: 'deterministic_guardrail', provider, model: null, tokens: { in: 0, out: 0 }, startedAt, completedAt: new Date().toISOString(), output: deterministicOutput(def.id, evidence), error: clip(error instanceof Error ? error.message : String(error), 500) };
  }
}
async function main() {
  const capturePath = arg('--capture', 'paper-tape/capture-latest.json');
  const fundingPath = arg('--funding', 'paper-tape/funding-latest.json');
  const hz1Path = arg('--hz1', 'paper-tape/hz1-latest.json');
  const forwardPath = arg('--forward', 'quant-evidence/forward-paper-latest.json');
  const researchForwardPath = arg('--research-forward', 'quant-evidence/research-forward-shadow-latest.json');
  const portfolioPath = arg('--portfolio', 'quant-evidence/portfolio-risk-research-latest.json');
  const outPath = arg('--out', 'paper-tape/agent-swarm-latest.json');
  const jsonlPath = arg('--jsonl', 'paper-tape/agent-swarm.jsonl');
  const evidence = buildEvidence(
    readJson(capturePath),
    readJson(fundingPath),
    readJson(hz1Path, false),
    readJson(forwardPath, false),
    readJson(researchForwardPath, false),
    readJson(portfolioPath, false),
  );
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
  const snapshot = { version: SWARM_VERSION, ts: new Date().toISOString(), paperOnly: true, liveOrders: false, executionAuthority: false, capitalEligible: false, source: 'github_capture_tape', llmProvider: provider, llmActive: agents.some((agent) => agent.engine === 'llm'), providerConfigured: Boolean(provider), evidence, agents, totals: { agents: agents.length, completedLlm: agents.filter((agent) => agent.engine === 'llm').length, fallback: agents.filter((agent) => agent.engine !== 'llm').length, tokens }, final: finalDecision(evidence), errors };
  writeJson(outPath, snapshot);
  appendJsonl(jsonlPath, snapshot);
  console.log(JSON.stringify({ ok: true, version: snapshot.version, provider: snapshot.llmProvider ?? 'deterministic_guardrail', llmActive: snapshot.llmActive, verdict: snapshot.final.verdict, forwardFamilies: snapshot.final.forwardFamilies, forwardNextStageEligible: snapshot.final.forwardNextStageEligible, researchForwardNextStageEligible: snapshot.final.researchForwardNextStageEligible, portfolioRiskStatus: snapshot.final.portfolioRiskStatus, agents: snapshot.agents.map((agent) => ({ id: agent.id, status: agent.status, engine: agent.engine })), paperOnly: true, liveOrders: false, executionAuthority: false }));
}
main().catch((error) => { console.error(`[paperAgentSwarm] ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
