import { sendJson, sendMethodNotAllowed } from '../_lib/http.js';
import { getSystemHealthFallback } from '../_lib/cryptoFallback.js';
import { fetchRemoteFallback } from '../_lib/remoteFallback.js';

function normalizeHealth(input) {
  const data = input && typeof input === 'object' ? input : {};
  const execution = data.execution && typeof data.execution === 'object' ? data.execution : {};
  const agentRunner = data.agentRunner && typeof data.agentRunner === 'object' ? data.agentRunner : {};
  return {
    ...data,
    ok: data.ok === true,
    timestamp: typeof data.timestamp === 'string' ? data.timestamp : new Date().toISOString(),
    probeMs: Number.isFinite(data.probeMs) ? data.probeMs : 0,
    websocket: data.websocket && typeof data.websocket === 'object'
      ? data.websocket : { connectedClients: 0, active: false },
    database: data.database && typeof data.database === 'object'
      ? data.database : { ok: false, tables: 0, totalTrades: 0 },
    treasury: data.treasury && typeof data.treasury === 'object'
      ? data.treasury : { ok: false, total: null, available: null, inTrades: null, isPaused: true, drawdownPct: null },
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
    kalshi: data.kalshi && typeof data.kalshi === 'object'
      ? data.kalshi : { ok: false, hasApiKey: false, wsConnected: false, mode: 'read_only', inUse: false },
    optimizer: data.optimizer && typeof data.optimizer === 'object' ? data.optimizer : { ok: false },
    learning: data.learning && typeof data.learning === 'object'
      ? data.learning : { ok: false, lessons: 0, activeVetoes: 0, agentsTracked: 0, lastConsensusDecision: null, lastConsensusAt: null },
    founderMode: data.founderMode && typeof data.founderMode === 'object'
      ? data.founderMode : { ok: false, mode: 'live_locked', focus: null, goal: null },
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

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendMethodNotAllowed(res);

  try {
    const remote = await fetchRemoteFallback('system-health');
    return sendJson(res, 200, normalizeHealth(remote));
  } catch (remoteError) {
    try {
      const local = await getSystemHealthFallback();
      return sendJson(res, 200, normalizeHealth(local));
    } catch (localError) {
      return sendJson(res, 200, normalizeHealth({
        ok: false,
        error: localError instanceof Error ? localError.message : (remoteError instanceof Error ? remoteError.message : 'system_health_unavailable'),
        agentRunner: { ok: false, agentAlive: false, neverStarted: true },
        execution: { agentAlive: false, isPaused: true },
        issues: [{ severity: 'warn', system: 'backend', message: 'System health unavailable' }],
      }));
    }
  }
}
