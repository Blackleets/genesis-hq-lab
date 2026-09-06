import { sendJson, sendMethodNotAllowed } from '../_lib/http.js';
import { getSystemHealthFallback } from '../_lib/cryptoFallback.js';
import { fetchRemoteFallback } from '../_lib/remoteFallback.js';

const RUNNER_STATUS_URL = 'https://swgixcbwyhxttnmrglbk.supabase.co/functions/v1/genesis-runner-status';
const QUANT_EVIDENCE_URL = 'https://swgixcbwyhxttnmrglbk.supabase.co/functions/v1/genesis-quant-evidence-status';

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
    if (!response.ok) return null;
    const status = await response.json();
    return status?.ok === true ? status : null;
  } catch {
    return null;
  }
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
      source: runner?.source ?? 'supabase_futures_runner',
      paperOnly: runner?.paperOnly === true,
      liveOrders: runner?.liveOrders === true,
      lastResult: runner?.lastResult ?? null,
      openTrades: openPositions.length,
      openPositions,
      recentTrades,
      stats: runner?.stats && typeof runner.stats === 'object' ? runner.stats : null,
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
