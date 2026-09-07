import { sendJson, sendMethodNotAllowed } from '../_lib/http.js';
import { getSystemHealthFallback } from '../_lib/cryptoFallback.js';
import { fetchRemoteFallback } from '../_lib/remoteFallback.js';

const RUNNER_STATUS_URL = 'https://swgixcbwyhxttnmrglbk.supabase.co/functions/v1/genesis-runner-status';
const QUANT_EVIDENCE_URL = 'https://swgixcbwyhxttnmrglbk.supabase.co/functions/v1/genesis-quant-evidence-status';
const FUTURES_STATE_KEY = 'quant_futures_native_market_v1';

function normalizeHealth(input) {
  const data = input && typeof input === 'object' ? input : {};
  const execution = data.execution && typeof data.execution === 'object' ? data.execution : {};
  const agentRunner = data.agentRunner && typeof data.agentRunner === 'object' ? data.agentRunner : {};
  return {
    ...data,
    ok: data.ok === true,
    timestamp: typeof data.timestamp === 'string' ? data.timestamp : new Date().toISOString(),
    probeMs: Number.isFinite(data.probeMs) ? data.probeMs : 0,
    websocket: data.websocket && typeof data.websocket === 'object' ? data.websocket : { connectedClients: 0, active: false },
    database: data.database && typeof data.database === 'object' ? data.database : { ok: false, tables: 0, totalTrades: 0 },
    treasury: data.treasury && typeof data.treasury === 'object' ? data.treasury : { ok: false, total: null, available: null, inTrades: null, isPaused: true, drawdownPct: null },
    agentRunner: {
      ok: agentRunner.ok === true,
      agentAlive: agentRunner.agentAlive === true,
      neverStarted: agentRunner.neverStarted !== false,
      lastTickAt: agentRunner.lastTickAt ?? null,
      msSinceLastTick: Number.isFinite(agentRunner.msSinceLastTick) ? agentRunner.msSinceLastTick : null,
      totalCycles: Number.isFinite(agentRunner.totalCycles) ? agentRunner.totalCycles : 0,
      claudeEnabled: agentRunner.claudeEnabled === true,
      llmProvider: agentRunner.llmProvider ?? 'none',
      ...agentRunner,
    },
    kalshi: data.kalshi && typeof data.kalshi === 'object' ? data.kalshi : { ok: false, hasApiKey: false, wsConnected: false, mode: 'read_only', inUse: false },
    optimizer: data.optimizer && typeof data.optimizer === 'object' ? data.optimizer : { ok: false },
    learning: data.learning && typeof data.learning === 'object' ? data.learning : { ok: false, lessons: 0, activeVetoes: 0, agentsTracked: 0, lastConsensusDecision: null, lastConsensusAt: null },
    founderMode: data.founderMode && typeof data.founderMode === 'object' ? data.founderMode : { ok: false, mode: 'live_locked', focus: null, goal: null },
    execution: {
      capital: Number.isFinite(execution.capital) ? execution.capital : 0,
      available: Number.isFinite(execution.available) ? execution.available : 0,
      openTrades: Number.isFinite(execution.openTrades) ? execution.openTrades : 0,
      isPaused: execution.isPaused !== false,
      drawdownPct: Number.isFinite(execution.drawdownPct) ? execution.drawdownPct : 0,
      agentAlive: execution.agentAlive === true,
      lastTickAt: execution.lastTickAt ?? null,
      realizedPnl: Number.isFinite(execution.realizedPnl) ? execution.realizedPnl : null,
      winRate: Number.isFinite(execution.winRate) ? execution.winRate : null,
      totalTrades: Number.isFinite(execution.totalTrades) ? execution.totalTrades : 0,
      stalePositionCount: Number.isFinite(execution.stalePositionCount) ? execution.stalePositionCount : 0,
      unrealizedDegraded: execution.unrealizedDegraded !== false,
      pnlFresh: typeof execution.pnlFresh === 'boolean' ? execution.pnlFresh : null,
      unrealizedPnl: Number.isFinite(execution.unrealizedPnl) ? execution.unrealizedPnl : null,
      drawdownProtection: execution.drawdownProtection ?? null,
      startupReconciliation: execution.startupReconciliation ?? null,
      confidenceEngine: execution.confidenceEngine ?? null,
      globalRisk: execution.globalRisk ?? null,
      ...execution,
    },
    issues: Array.isArray(data.issues) ? data.issues : [{ severity: 'warn', system: 'health', message: 'Health payload incomplete' }],
  };
}

function parseStoredJson(value, fallback = null) {
  if (typeof value !== 'string' || !value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function directSupabaseConfig() {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

async function directRest(path) {
  const config = directSupabaseConfig();
  if (!config) throw new Error('supabase_direct_config_unavailable');
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    headers: { apikey: config.key, authorization: `Bearer ${config.key}`, accept: 'application/json' },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`supabase_direct_${response.status}`);
  return await response.json();
}

function mapResearchExperiment(row) {
  return {
    experimentKey: row.experiment_key,
    family: row.family,
    strategyName: row.strategy_name,
    strategyVersion: row.strategy_version,
    stage: row.stage,
    verdict: row.verdict,
    branch: row.branch,
    commitSha: row.commit_sha,
    engineSha256: row.engine_sha256,
    workflowRunId: row.workflow_run_id,
    artifactId: row.artifact_id,
    artifactSha256: row.artifact_sha256,
    dataSource: row.data_source,
    dataStart: row.data_start,
    dataEnd: row.data_end,
    nAssets: row.n_assets,
    nDays: row.n_days,
    validation: row.validation ?? null,
    forwardEvidence: row.forward_evidence ?? null,
    holdoutState: row.holdout_state,
    capitalEligible: row.capital_eligible === true,
    liveOrders: row.live_orders === true,
    createdAt: row.created_at,
  };
}

async function readQuantEvidenceDirect() {
  if (!directSupabaseConfig()) return null;
  try {
    const [stateRows, checkRows, proposalRows, pipelineRows, researchRows] = await Promise.all([
      directRest(`org_state?key=eq.${FUTURES_STATE_KEY}&select=value,updated_at&limit=1`),
      directRest('quant_economic_feasibility_checks?select=check_id,proposal_id,hypothesis_fingerprint,family,engine_version,mode,observed_at,gross_edge_bps,modeled_cost_bps,safety_buffer_bps,required_gross_bps,edge_cost_ratio,margin_bps,verdict,reason,capital_eligible,live_orders,created_at&order=created_at.desc&limit=30'),
      directRest('quant_research_hypothesis_proposals?select=proposal_id,hypothesis_fingerprint,family,decision,mode,novelty_basis,supersedes_reason,execution_authority,capital_eligible,live_orders,created_at&order=created_at.desc&limit=30'),
      directRest('quant_research_pipeline_latest?select=event_id,proposal_id,hypothesis_fingerprint,family,stage,novelty_decision,economic_check_id,economic_verdict,experiment_key,research_compute_authority,reason,created_at&order=created_at.desc&limit=30'),
      directRest('quant_research_experiments?select=experiment_key,family,strategy_name,strategy_version,stage,verdict,branch,commit_sha,engine_sha256,workflow_run_id,artifact_id,artifact_sha256,data_source,data_start,data_end,n_assets,n_days,validation,forward_evidence,holdout_state,capital_eligible,live_orders,created_at&order=created_at.desc,experiment_key.asc&limit=30'),
    ]);

    const checks = Array.isArray(checkRows) ? checkRows.map((row) => ({
      checkId: row.check_id,
      proposalId: row.proposal_id,
      hypothesisFingerprint: row.hypothesis_fingerprint,
      family: row.family,
      engineVersion: row.engine_version,
      mode: row.mode,
      observedAt: row.observed_at,
      grossEdgeBps: row.gross_edge_bps == null ? null : Number(row.gross_edge_bps),
      modeledCostBps: row.modeled_cost_bps == null ? null : Number(row.modeled_cost_bps),
      safetyBufferBps: row.safety_buffer_bps == null ? null : Number(row.safety_buffer_bps),
      requiredGrossBps: row.required_gross_bps == null ? null : Number(row.required_gross_bps),
      edgeCostRatio: row.edge_cost_ratio == null ? null : Number(row.edge_cost_ratio),
      marginBps: row.margin_bps == null ? null : Number(row.margin_bps),
      verdict: row.verdict,
      reason: row.reason,
      capitalEligible: row.capital_eligible === true,
      liveOrders: row.live_orders === true,
      createdAt: row.created_at,
    })) : [];

    const proposals = Array.isArray(proposalRows) ? proposalRows.map((row) => ({
      proposalId: row.proposal_id,
      hypothesisFingerprint: row.hypothesis_fingerprint,
      family: row.family,
      decision: row.decision,
      mode: row.mode,
      noveltyBasis: row.novelty_basis,
      supersedesReason: row.supersedes_reason,
      executionAuthority: row.execution_authority === true,
      capitalEligible: row.capital_eligible === true,
      liveOrders: row.live_orders === true,
      createdAt: row.created_at,
    })) : [];

    const pipeline = Array.isArray(pipelineRows) ? pipelineRows.map((row) => ({
      eventId: row.event_id,
      proposalId: row.proposal_id,
      hypothesisFingerprint: row.hypothesis_fingerprint,
      family: row.family,
      stage: row.stage,
      noveltyDecision: row.novelty_decision,
      economicCheckId: row.economic_check_id,
      economicVerdict: row.economic_verdict,
      experimentKey: row.experiment_key,
      researchComputeAuthority: row.research_compute_authority === true,
      reason: row.reason,
      createdAt: row.created_at,
    })) : [];

    const experiments = Array.isArray(researchRows) ? researchRows.map(mapResearchExperiment) : [];
    const families = new Set(experiments.map((row) => row.family).filter(Boolean));
    const researchSummary = {
      experiments: experiments.length,
      families: families.size,
      noGo: experiments.filter((row) => row.verdict === 'NO_GO').length,
      researchGo: experiments.filter((row) => row.verdict === 'RESEARCH_GO').length,
      sealedHoldouts: experiments.filter((row) => String(row.holdoutState ?? '').includes('SEALED')).length,
      capitalEligible: experiments.filter((row) => row.capitalEligible).length,
      liveOrders: experiments.filter((row) => row.liveOrders).length,
      latestAt: experiments.map((row) => row.createdAt).filter(Boolean).sort().at(-1) ?? null,
    };
    const pipelineSummary = {
      proposalsTracked: pipeline.length,
      noveltyAccepted: pipeline.filter((row) => row.stage === 'NOVELTY_ACCEPTED').length,
      noveltyBlocked: pipeline.filter((row) => row.stage === 'NOVELTY_BLOCKED').length,
      economicWaiting: pipeline.filter((row) => row.stage === 'ECONOMIC_WAITING').length,
      economicBlocked: pipeline.filter((row) => row.stage === 'ECONOMIC_BLOCKED').length,
      backtestAllowed: pipeline.filter((row) => row.stage === 'BACKTEST_ALLOWED' && row.researchComputeAuthority).length,
      ledgerSealed: pipeline.filter((row) => row.stage === 'LEDGER_SEALED').length,
      computeAuthorities: pipeline.filter((row) => row.researchComputeAuthority).length,
    };
    const feasibilitySummary = {
      checks: checks.length,
      passPrefilter: checks.filter((row) => row.verdict === 'PASS_PREFILTER').length,
      failEconomics: checks.filter((row) => row.verdict === 'FAIL_ECONOMICS').length,
      noActiveSignal: checks.filter((row) => row.verdict === 'NO_ACTIVE_SIGNAL').length,
      dataBlocked: checks.filter((row) => row.verdict === 'DATA_BLOCKED').length,
    };
    const stateRow = Array.isArray(stateRows) ? stateRows[0] : null;
    const futuresNativeMarket = parseStoredJson(stateRow?.value, null);

    return {
      ok: true,
      statusVersion: 'vercel_direct_v1',
      mode: 'READ_ONLY_EVIDENCE',
      executionAuthority: false,
      capitalEligible: false,
      liveOrders: false,
      futuresNativeMarket: futuresNativeMarket ? { ...futuresNativeMarket, stateUpdatedAt: stateRow?.updated_at ?? null } : null,
      economicFeasibility: { engineVersion: checks[0]?.engineVersion ?? null, summary: feasibilitySummary, checks },
      hypothesisGate: { engineVersion: 'hng_v1', proposals, latest: proposals[0] ?? null },
      researchPipeline: { engineVersion: 'qrp_v1', summary: pipelineSummary, latest: pipeline, policy: 'read-only direct REST fallback; research compute authority is evidence-derived only' },
      researchLedger: { ok: true, ledgerVersion: 'v1', appendOnly: true, executionAuthority: false, summary: researchSummary, experiments },
      updatedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

async function readRunnerStatus() {
  try {
    const response = await fetch(RUNNER_STATUS_URL, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return null;
    const status = await response.json();
    if (status?.ok !== true || typeof status.agentAlive !== 'boolean') return null;
    return status;
  } catch {
    return null;
  }
}

async function readQuantEvidence() {
  try {
    const response = await fetch(QUANT_EVIDENCE_URL, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(5_000) });
    if (response.ok) {
      const status = await response.json();
      if (status?.ok === true) return status;
    }
  } catch {
    // Fall through to the read-only REST fallback below.
  }
  return await readQuantEvidenceDirect();
}

function mergeRunner(base, runner, quantEvidence) {
  const normalized = normalizeHealth(base);
  if (!runner && !quantEvidence) return normalized;
  const openPositions = Array.isArray(runner?.openPositions) ? runner.openPositions : [];
  const recentTrades = Array.isArray(runner?.recentTrades) ? runner.recentTrades : [];
  return {
    ...normalized,
    agentRunner: {
      ...normalized.agentRunner,
      ...(runner && typeof runner === 'object' ? runner : {}),
      ok: runner?.ok === true,
      agentAlive: runner?.agentAlive === true,
      neverStarted: !runner?.lastTickAt,
      lastTickAt: runner?.lastTickAt ?? null,
      msSinceLastTick: Number.isFinite(runner?.msSinceLastTick) ? runner.msSinceLastTick : null,
      totalCycles: Number.isFinite(runner?.totalCycles) ? runner.totalCycles : 0,
      source: runner?.source ?? (quantEvidence ? 'supabase_direct_evidence_fallback' : 'supabase_futures_runner'),
      paperOnly: runner?.paperOnly === true,
      liveOrders: runner?.liveOrders === true,
      lastResult: runner?.lastResult ?? null,
      openTrades: openPositions.length,
      openPositions,
      recentTrades,
      stats: runner?.stats && typeof runner.stats === 'object' ? runner.stats : null,
      validationEngine: runner?.validationEngine ?? null,
      challengerLab: runner?.challengerLab ?? null,
      researchLedger: runner?.researchLedger ?? quantEvidence?.researchLedger ?? null,
      quantEvidence: quantEvidence ?? null,
      futuresNativeMarket: quantEvidence?.futuresNativeMarket ?? null,
      economicFeasibility: quantEvidence?.economicFeasibility ?? null,
      hypothesisGate: quantEvidence?.hypothesisGate ?? null,
      researchPipeline: quantEvidence?.researchPipeline ?? null,
    },
    execution: {
      ...normalized.execution,
      agentAlive: runner?.agentAlive === true,
      lastTickAt: runner?.lastTickAt ?? normalized.execution.lastTickAt,
      openTrades: openPositions.length,
    },
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendMethodNotAllowed(res);
  const [runner, quantEvidence] = await Promise.all([readRunnerStatus(), readQuantEvidence()]);
  try {
    const remote = await fetchRemoteFallback('system-health');
    return sendJson(res, 200, mergeRunner(remote, runner, quantEvidence));
  } catch (remoteError) {
    try {
      const local = await getSystemHealthFallback();
      return sendJson(res, 200, mergeRunner(local, runner, quantEvidence));
    } catch (localError) {
      return sendJson(res, 200, mergeRunner({
        ok: false,
        error: localError instanceof Error ? localError.message : (remoteError instanceof Error ? remoteError.message : 'system_health_unavailable'),
        agentRunner: { ok: false, agentAlive: false, neverStarted: true },
        execution: { agentAlive: false, isPaused: true },
        issues: [{ severity: 'warn', system: 'backend', message: 'System health unavailable' }],
      }, runner, quantEvidence));
    }
  }
}
