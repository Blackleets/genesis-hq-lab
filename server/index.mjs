import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
import { WebSocketServer } from 'ws';
import { fetchPolymarketEventsSnapshot, fetchPolymarketHealth } from './polymarket.mjs';
import { handlePredictionMarketsRoute } from './predictionMarkets/index.mjs';
import {
  getStrategyRegistry, runSystemValidation,
  computeAllocation, getQuantState, generateQuantReport,
  getWfCache, isWfCacheStale, executeWalkForward, isWfRunning,
  startWfScheduler, getWfSchedulerStatus,
  getTransitionHistory, setStatusOverride, clearStatusOverride, getAllOverrides,
} from './quant/index.mjs';
import { generateClaudePlan } from './claudePlanner.mjs';
import { getSnapshot, getCapital, getTrades, getLessons, getAgentStats, addHumanOrder } from './memoryStore.mjs';
import { getDashboardMetrics, computeEdgeScorecard } from './trading/analytics.mjs';
import { getTreasury, getTreasuryAsync, getCapitalHistory } from './trading/treasury.mjs';
import { getRiskMetrics } from './trading/riskManager.mjs';
import { getRecentDebates } from './trading/debateRoom.mjs';
import { getLeaderboard } from './memory/agentScoring.mjs';
import { getVetoStats } from './memory/mistakePrevention.mjs';
import { getRecentTrades } from './memory/tradingMemory.mjs';
import { getSignalAccuracy } from './research/signalExtractor.mjs';
import { getAllDeployed, getSkillHistory } from './skills/skillRegistry.mjs';
import { runSkillOpt } from './skills/runSkillOpt.mjs';
import db from './db/database.mjs';
import { executeCommand, getCommandHistory } from './command/commandExecutor.mjs';
import { getOrgState, getStatusSummary } from './command/orgState.mjs';
import {
  executeTask as agentExecuteTask,
  getAllAgentStatuses,
  getAgentStatus,
  getAgentWithHistory,
  setBroadcast as agentSetBroadcast,
} from './agents/agentEngine.mjs';
import { getLogs as getAgentLogs } from './agents/agentMemory.mjs';
import { getProviderStatus } from './agents/providerRouter.mjs';
import { getCryptoOverview, getOptimizerHeartbeat, computeCryptoEdgeScorecard, getScalpV2TodayStats } from './crypto/cryptoAnalytics.mjs';
import {
  setBroadcast as kalshiSetBroadcast,
  startWS      as kalshiStartWS,
  getKalshiStatus,
} from './kalshi/adapter.mjs';
import { start as startMarketAnalyst }                    from './agents/marketAnalyst.mjs';
import { getRecentDecisions, getDecisionStats }           from './memory/decisionLedger.mjs';
import { getAgentPerformance }                            from './memory/decisionAccuracyEngine.mjs';
import { getRecentConsensus, getConsensusForTicker }      from './memory/consensusEngine.mjs';
import { getSystemTruth }                                 from './truthLayer.mjs';
import {
  getPnLDashboard,
  getAttributionList,
  getTradeAttribution,
  detectStalePositions,
  getPnLFreshness,
}                                                         from './memory/pnlEngine.mjs';
import {
  getReconciliationStatus,
  clearSafeMode as clearReconciliationSafeMode,
}                                                         from './memory/reconciliationEngine.mjs';
import {
  getTimeline, getRecentEvents, getActiveWarnings, getTopFailureReason,
  countBlockedTrades, getCurrentBlockers,
}                                                         from './observability/eventTimeline.mjs';
import { buildDecisionExplanation }                       from './observability/decisionExplainer.mjs';
import { getGlobalRiskDiagnostics }                       from './risk/globalRiskEngine.mjs';
import { getLearningDiagnostics }                         from './learning/learningEngine.mjs';
import { getConfidenceDiagnostics }                       from './intelligence/confidenceEngine.mjs';
import {
  getAlphaReport,
  computeExpectancy,
  computeAgentEdgeScores,
  computeRegimeAnalysis,
}                                                         from './research/alphaValidationEngine.mjs';
import { getSchedulerStatus }                             from './trading/executionScheduler.mjs';
import { getTrainingMetrics }                             from './trading/positionMonitor.mjs';
import { getMarketIntelligence, getCryptoFeedEvents, getRegimeBiasPerformance } from './crypto/marketIntelligence.mjs';
import { fetchDepth }                                     from './crypto/liquidityMatrix.mjs';
import { getProValidation }                              from './crypto/proValidation.mjs';
import { getShadowCandidateDiagnostics }                from './crypto/shadowCandidate.mjs';
import { getBreakoutShadowDiagnostics }                 from './crypto/breakoutShadow.mjs';
import { getCommentary }                                  from './ai/commentaryEngine.mjs';
import { getTradeStories }                                from './crypto/tradeHistory.mjs';
import { analyzeTrade, assertTradeAllowed }               from './crypto/copilot.mjs';
import { getFuturesDeskSnapshot, getLiveFuturesCapitalSnapshot, resetFuturesPnlBaseline } from './crypto/futuresDesk.mjs';
import {
  applyIntelligenceSupervisorRun,
  getIntelligenceSupervisorHistory,
  getIntelligenceSupervisorLatest,
  getIntelligenceSupervisorRunById,
  rollbackIntelligenceSupervisorOverrides,
  runIntelligenceSupervisor,
}                                                         from './intelligence/intelligenceSupervisor.mjs';
import { scalpConfig, getLastScanSnapshot, getScalpV2Diagnostics } from './strategies/scalpingEngine.mjs';
import { getAutopsy }                                     from './crypto/autoVeto.mjs';
import { getCouncilConfig }                               from './crypto/decisionCouncil.mjs';
import {
  getLatestDecision as getLatestCouncilDecision,
  getRecentDecisions as getRecentCouncilDecisions,
  getCouncilStats, getCouncilPerformance, getBlockedSetups,
} from './crypto/decisionMemory.mjs';
import { getFatigueIntelligenceSummary }                  from './intelligence/setupFatigue.mjs';
import { getDbHealth, startReplication }                  from './persistence/dbReplicator.mjs';
import { readHeartbeat }                                  from './trading/schedulerHeartbeat.mjs';
import { swingConfig }                                    from './strategies/swingEngine.mjs';
import { eventConfig }                                    from './strategies/eventAlphaEngine.mjs';
import {
  getClosedCryptoConfidenceRows,
  getClosedCryptoMetrics,
  getCryptoTradeCounts,
  getPredictionOnlyWhere,
}                                                         from './crypto/cryptoTradeUniverse.mjs';
import { getCryptoLlmStatus }                             from './crypto/cryptoLlmStatus.mjs';
// Solana Alpha Lab — loaded dynamically so a module error never crashes the main server.
let _solana = null;
let _solanaError = null;
(async () => {
  try {
    _solana = await import('./solana-alpha/index.mjs');
    console.log('[solana-alpha] module loaded OK');
  } catch (err) {
    _solanaError = err.message;
    console.error('[solana-alpha] module FAILED to load:', err.message);
  }
})();

// In-memory SkillOpt job state (single concurrent job)
const skilloptJob = { running: false, lastResult: null, startedAt: null, agent: null };

// ─── WebSocket broadcast ─────────────────────────────────────────────────────
const wss = new WebSocketServer({ noServer: true });
const wsClients = new Set();

wss.on('connection', (ws) => {
  wsClients.add(ws);
  ws.on('close', () => wsClients.delete(ws));
  ws.on('error', () => wsClients.delete(ws));
  // Send current state on connect
  try {
    const treasury = getTreasury();
    ws.send(JSON.stringify({ type: 'agent:tick', treasury, ts: Date.now() }));
  } catch { /* ignore */ }
});

function broadcast(event) {
  const msg = JSON.stringify(event);
  for (const client of wsClients) {
    if (client.readyState === 1) { // OPEN
      try { client.send(msg); } catch { wsClients.delete(client); }
    }
  }
}

// Give agent engine access to the broadcast channel
agentSetBroadcast(broadcast);
// Give Kalshi adapter access to the broadcast channel
kalshiSetBroadcast(broadcast);
// Solana Alpha broadcast wired after dynamic import resolves (in listen callback)
// Start MarketAnalystAgent (subscribes to internal market_update bus)
startMarketAnalyst(broadcast);

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 8787);
const FUTURES_ONLY_MODE = !['0', 'false', 'no', 'off'].includes((process.env.FUTURES_ONLY_MODE ?? 'true').toLowerCase());

function applyCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res, status, payload) {
  applyCors(res);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
  });
  res.end(JSON.stringify(payload));
}

function requireAuth(req, res) {
  const secret = process.env.API_SECRET?.trim();
  if (!secret) return true; // auth disabled when API_SECRET not set
  const auth = req.headers['authorization'] ?? '';
  if (auth === `Bearer ${secret}`) return true;
  sendJson(res, 401, { ok: false, error: 'unauthorized', message: 'Invalid or missing API_SECRET token' });
  return false;
}

function notFound(res) {
  sendJson(res, 404, {
    ok: false,
    error: 'not_found',
    message: 'Route not found',
  });
}

function latestIso(...values) {
  const valid = values.filter(Boolean);
  if (valid.length === 0) return null;
  return valid.reduce((latest, current) => (
    new Date(current).getTime() > new Date(latest).getTime() ? current : latest
  ));
}

const server = createServer(async (req, res) => {
  applyCors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (!req.url) {
    sendJson(res, 400, { ok: false, error: 'bad_request', message: 'Missing URL' });
    return;
  }

  // Guard against excessively large request bodies
  if (req.headers['content-length'] && parseInt(req.headers['content-length'], 10) > 65536) {
    sendJson(res, 413, { ok: false, error: 'Request body too large' });
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host ?? `${HOST}:${PORT}`}`);

  // POST /internal/broadcast — localhost-only push channel for agentRunner events
  // Must be before the GET-only guard below.
  if (url.pathname === '/internal/broadcast' && req.method === 'POST') {
    const ip = req.socket?.remoteAddress ?? '';
    if (!ip.includes('127.0.0.1') && !ip.includes('::1') && !ip.includes('localhost')) {
      sendJson(res, 403, { ok: false, error: 'Forbidden' });
      return;
    }
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try {
        const event = JSON.parse(body || '{}');
        broadcast(event);
        sendJson(res, 200, { ok: true, clients: wsClients.size });
      } catch {
        sendJson(res, 400, { ok: false, error: 'Invalid JSON' });
      }
    });
    return;
  }

  // POST /api/plan — handled before the GET-only guard below.
  if (url.pathname === '/api/plan' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      if (!requireAuth(req, res)) return;
      try {
        const { goal } = JSON.parse(body);
        if (!goal || typeof goal !== 'string' || goal.trim().length === 0) {
          sendJson(res, 400, { ok: false, error: 'missing_goal', message: 'goal is required' });
          return;
        }
        const tasks = await generateClaudePlan(goal.trim().slice(0, 400));
        sendJson(res, 200, { ok: true, tasks });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Plan generation failed';
        const isKeyMissing = message.includes('ANTHROPIC_API_KEY');
        sendJson(res, isKeyMissing ? 501 : 502, {
          ok: false,
          error: isKeyMissing ? 'api_key_missing' : 'plan_failed',
          message,
        });
      }
    });
    return;
  }

  if (url.pathname === '/api/crypto/futures-baseline/reset' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      if (!requireAuth(req, res)) return;
      try {
        const parsed = body ? JSON.parse(body) : {};
        const baseline = resetFuturesPnlBaseline({
          resetBy: typeof parsed.resetBy === 'string' && parsed.resetBy.trim() ? parsed.resetBy.trim().slice(0, 80) : 'operator',
          note: typeof parsed.note === 'string' && parsed.note.trim() ? parsed.note.trim().slice(0, 200) : 'Manual futures PnL baseline reset',
        });
        sendJson(res, 200, { ok: true, baseline });
      } catch (error) {
        sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : 'baseline_reset_failed' });
      }
    });
    return;
  }

  if (url.pathname === '/api/intelligence/supervisor/run' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      if (!requireAuth(req, res)) return;
      try {
        const parsed = body ? JSON.parse(body) : {};
        if (parsed?.apply === true) {
          sendJson(res, 400, {
            ok: false,
            error: 'apply_not_supported',
            message: 'Supervisor v1 is advisory only and cannot apply recommendations.',
          });
          return;
        }
        const result = await runIntelligenceSupervisor();
        sendJson(res, result.ok ? 200 : 503, {
          ok: result.ok,
          advisoryOnly: true,
          applied: false,
          run: result.run,
          state: result.state,
          error: result.error ?? null,
        });
      } catch (error) {
        sendJson(res, 500, {
          ok: false,
          advisoryOnly: true,
          applied: false,
          error: error instanceof Error ? error.message : 'supervisor_run_failed',
        });
      }
    });
    return;
  }

  const intelligenceApplyMatch = url.pathname.match(/^\/api\/intelligence\/supervisor\/([^/]+)\/apply$/);
  if (intelligenceApplyMatch && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      if (!requireAuth(req, res)) return;
      try {
        const parsed = body ? JSON.parse(body) : {};
        const result = applyIntelligenceSupervisorRun(
          intelligenceApplyMatch[1],
          typeof parsed.appliedBy === 'string' && parsed.appliedBy.trim()
            ? parsed.appliedBy.trim().slice(0, 80)
            : 'operator',
        );
        sendJson(res, 200, {
          ok: true,
          advisoryOnly: false,
          applied: true,
          result,
          state: getIntelligenceSupervisorLatest(),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'supervisor_apply_failed';
        const status = ['supervisor_run_not_found', 'supervisor_run_not_recommended', 'no_applicable_changes'].includes(message) ? 400 : 500;
        sendJson(res, status, {
          ok: false,
          advisoryOnly: false,
          applied: false,
          error: message,
        });
      }
    });
    return;
  }

  if (url.pathname === '/api/intelligence/supervisor/rollback' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      if (!requireAuth(req, res)) return;
      try {
        const parsed = body ? JSON.parse(body) : {};
        const result = rollbackIntelligenceSupervisorOverrides(
          typeof parsed.appliedBy === 'string' && parsed.appliedBy.trim()
            ? parsed.appliedBy.trim().slice(0, 80)
            : 'operator',
          typeof parsed.reason === 'string' && parsed.reason.trim()
            ? parsed.reason.trim().slice(0, 160)
            : 'manual rollback',
        );
        sendJson(res, 200, {
          ok: true,
          advisoryOnly: false,
          applied: false,
          result,
          state: getIntelligenceSupervisorLatest(),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'supervisor_rollback_failed';
        const status = message === 'no_active_overrides' ? 400 : 500;
        sendJson(res, status, {
          ok: false,
          advisoryOnly: false,
          applied: false,
          error: message,
        });
      }
    });
    return;
  }

  // POST /api/agents/:id/task — submit a real task to a specific agent
  const agentTaskMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/task$/);
  if (agentTaskMatch && req.method === 'POST') {
    const agentId = agentTaskMatch[1];
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', async () => {
      if (!requireAuth(req, res)) return;
      try {
        const { task } = JSON.parse(body || '{}');
        if (!task || typeof task !== 'string' || !task.trim()) {
          sendJson(res, 400, { ok: false, error: 'missing_task', message: 'task field is required' });
          return;
        }
        // Run async — returns immediately with execId
        const result = await agentExecuteTask(agentId, task.trim().slice(0, 2000));
        sendJson(res, 200, { ok: result.ok, ...result });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const isBusy = message.includes('busy');
        sendJson(res, isBusy ? 409 : 500, { ok: false, error: isBusy ? 'agent_busy' : 'execution_failed', message });
      }
    });
    return;
  }

  // All other routes are GET-only.
  if (req.method !== 'GET') {
    sendJson(res, 405, {
      ok: false,
      error: 'method_not_allowed',
      message: 'Only GET is allowed',
    });
    return;
  }

  // ── Real AI Agents ──────────────────────────────────────────────────────────

  if (url.pathname === '/api/agents/real') {
    sendJson(res, 200, { ok: true, agents: getAllAgentStatuses(), providers: getProviderStatus() });
    return;
  }

  if (url.pathname === '/api/agents/providers') {
    sendJson(res, 200, { ok: true, providers: getProviderStatus() });
    return;
  }

  const agentStatusMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/status$/);
  if (agentStatusMatch) {
    const status = getAgentWithHistory(agentStatusMatch[1]);
    if (!status) { sendJson(res, 404, { ok: false, error: 'agent_not_found' }); return; }
    sendJson(res, 200, { ok: true, agent: status });
    return;
  }

  const agentLogsMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/logs$/);
  if (agentLogsMatch) {
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200);
    const logs = getAgentLogs(agentLogsMatch[1], limit);
    sendJson(res, 200, { ok: true, logs });
    return;
  }

  // ── Agent memory endpoints ──────────────────────────────────────────────────

  if (url.pathname === '/api/agent/status') {
    try {
      const snapshot = await getSnapshot();
      sendJson(res, 200, { ok: true, ...snapshot });
    } catch (err) {
      // NEVER return fake financial data — return a clear error instead
      console.error('[api/agent/status] snapshot failed:', err?.message);
      sendJson(res, 503, { ok: false, error: 'snapshot_unavailable', message: err?.message ?? 'Internal error' });
    }
    return;
  }

  if (url.pathname === '/api/agent/trades') {
    try {
      // Read from SQLite (where agent runner writes), fall back to JSON store
      const trades = getRecentTrades(50);
      sendJson(res, 200, { ok: true, trades });
    } catch {
      try {
        const trades = await getTrades();
        sendJson(res, 200, { ok: true, trades: trades.slice(-50) });
      } catch { sendJson(res, 200, { ok: true, trades: [] }); }
    }
    return;
  }

  if (url.pathname === '/api/agent/learning-health' && req.method === 'GET') {
    try {
      const byCategory = db.prepare(`
        SELECT category,
               COUNT(*) AS total,
               SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) AS critical,
               SUM(CASE WHEN severity = 'warning'  THEN 1 ELSE 0 END) AS warnings,
               SUM(times_retrieved)      AS total_retrieved,
               SUM(times_prevented_loss) AS total_prevented
        FROM lessons WHERE deprecated = 0
        GROUP BY category ORDER BY total DESC
      `).all();

      const topLessons = db.prepare(`
        SELECT id, lesson_text, category, severity,
               times_retrieved, times_prevented_loss, created_at
        FROM lessons
        WHERE deprecated = 0
        ORDER BY times_prevented_loss DESC, times_retrieved DESC
        LIMIT 5
      `).all();

      const unreadCount = db.prepare(
        `SELECT COUNT(*) AS cnt FROM lessons WHERE deprecated = 0 AND times_retrieved = 0`
      ).get()?.cnt ?? 0;

      const patterns = db.prepare(`
        SELECT pattern_desc, triggered_count, true_positive, false_positive, active, lesson_id
        FROM mistake_patterns
        ORDER BY triggered_count DESC
      `).all();

      const activePatterns = patterns.filter(p => p.active).length;
      const totalTriggered = patterns.reduce((s, p) => s + (p.triggered_count ?? 0), 0);
      const totalFp        = patterns.reduce((s, p) => s + (p.false_positive ?? 0), 0);

      const allTwenty = db.prepare(`
        SELECT pnl FROM trades
        WHERE status = 'closed' AND ${getPredictionOnlyWhere()}
        ORDER BY closed_at DESC LIMIT 20
      `).all();
      const recentTen = allTwenty.slice(0, 10);
      const olderTen  = allTwenty.slice(10);
      const recentWinRate = recentTen.length > 0 ? recentTen.filter(t => t.pnl > 0).length / recentTen.length : null;
      const olderWinRate  = olderTen.length  > 0 ? olderTen.filter(t => t.pnl > 0).length  / olderTen.length  : null;
      const direction = recentWinRate != null && olderWinRate != null
        ? recentWinRate > olderWinRate ? 'improving' : recentWinRate < olderWinRate ? 'declining' : 'stable'
        : 'insufficient_data';

      return sendJson(res, 200, {
        ok: true,
        learning: {
          totalLessons:  byCategory.reduce((s, c) => s + c.total, 0),
          unreadLessons: unreadCount,
          byCategory,
          topLessons,
        },
        vetoPrevention: {
          activePatterns,
          totalTriggered,
          falsePositiveRate: totalTriggered > 0 ? totalFp / totalTriggered : 0,
          patterns: patterns.slice(0, 5),
        },
        winRateTrend: {
          recent10:  recentWinRate,
          prior10:   olderWinRate,
          direction,
        },
        generatedAt: new Date().toISOString(),
      });
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: err.message });
    }
  }

  if (url.pathname === '/api/agent/lessons') {
    try {
      // Read from SQLite lessons table
      const lessons = db.prepare(`
        SELECT id, lesson_text, why_failed, new_rule, category, severity,
               times_prevented_loss, created_at
        FROM lessons WHERE deprecated = 0
        ORDER BY created_at DESC LIMIT 20
      `).all();
      sendJson(res, 200, { ok: true, lessons });
    } catch {
      try {
        const lessons = await getLessons();
        sendJson(res, 200, { ok: true, lessons: lessons.slice(-20) });
      } catch { sendJson(res, 200, { ok: true, lessons: [] }); }
    }
    return;
  }

  if (url.pathname === '/api/agent/stats') {
    try {
      const stats = await getAgentStats();
      sendJson(res, 200, { ok: true, stats });
    } catch { sendJson(res, 200, { ok: true, stats: {} }); }
    return;
  }

  // ── Trading system endpoints ─────────────────────────────────────────────────

  if (url.pathname === '/api/trading/dashboard') {
    try {
      const [metrics, liveTreasury] = await Promise.all([
        Promise.resolve(getDashboardMetrics()),
        getTreasuryAsync(),
      ]);
      sendJson(res, 200, { ok: true, ...metrics, treasury: {
        ...metrics.treasury,
        unrealizedPnl: liveTreasury.unrealizedPnl,
        netWorth: liveTreasury.netWorth,
      }});
    } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  if (url.pathname === '/api/trading/edge-scorecard') {
    try {
      const scorecard = computeEdgeScorecard();
      const crypto = computeCryptoEdgeScorecard();
      sendJson(res, 200, { ok: true, ...scorecard, crypto });
    } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  // ── PnL Engine endpoints ───────────────────────────────────────────────────

  if (url.pathname === '/api/pnl/summary') {
    try {
      sendJson(res, 200, { ok: true, pnl: getPnLDashboard() });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
    return;
  }

  if (url.pathname === '/api/pnl/attribution') {
    const limit = Math.min(Number(url.searchParams.get('limit') || 20), 100);
    try {
      sendJson(res, 200, { ok: true, attribution: getAttributionList(limit) });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
    return;
  }

  const pnlAttributionMatch = url.pathname.match(/^\/api\/pnl\/attribution\/([^/]+)$/);
  if (pnlAttributionMatch) {
    try {
      const attribution = getTradeAttribution(pnlAttributionMatch[1]);
      if (!attribution) { sendJson(res, 404, { ok: false, error: 'trade_not_found' }); return; }
      sendJson(res, 200, { ok: true, attribution });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
    return;
  }

  if (url.pathname === '/api/pnl/freshness') {
    try {
      const stale = detectStalePositions(48);
      const freshness = getPnLFreshness();
      sendJson(res, 200, { ok: true, freshness, stalePositions: stale });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
    return;
  }

  // ── Treasury ───────────────────────────────────────────────────────────────

  if (url.pathname === '/api/trading/treasury') {
    try {
      const treasury = await getTreasuryAsync();
      sendJson(res, 200, { ok: true, treasury });
    } catch (e) {
      console.warn('[treasury] live P&L fetch failed, falling back to sync:', e?.message);
      try {
        const treasury = getTreasury();   // fallback to sync on error
        sendJson(res, 200, { ok: true, treasury });
      } catch (e2) { sendJson(res, 500, { ok: false, error: e2.message }); }
    }
    return;
  }

  if (url.pathname === '/api/genesis/context') {
    // Derivatives positioning context for a pair (real Binance futures data + Fear&Greed).
    try {
      const symbol = (url.searchParams.get('pair') || 'COTIUSDT').toUpperCase();
      const { getContext } = await import('./genesis/derivativesContext.mjs');
      const ctx = await getContext(symbol);
      sendJson(res, 200, { ok: true, context: ctx });
    } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  if (url.pathname === '/api/genesis/candles') {
    // Real candles for the Quant Lab chart (public Binance data via existing fetcher).
    try {
      const pair = (url.searchParams.get('pair') || 'COTIUSDT').toUpperCase();
      const tf = url.searchParams.get('tf') || '1h';
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '300', 10) || 300, 1000);
      const { fetchKlines } = await import('./crypto/backtest/historicalData.mjs');
      const klines = await fetchKlines(pair, { days: Math.ceil(limit / 24) + 2, interval: tf });
      const candles = klines.slice(-limit).map(k => ({
        time: Math.floor(k[0] / 1000),
        open: +k[1], high: +k[2], low: +k[3], close: +k[4],
      }));
      sendJson(res, 200, { ok: true, pair, tf, candles });
    } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  if (url.pathname === '/api/genesis/live') {
    // Genesis Quant Lab live state: ALL paper bots + treasury (read-only, no auth — public paper data).
    try {
      const liveDir = join(__dir, '..', 'data');
      const stateFiles = readdirSync(liveDir)
        .filter(f => /^genesis_live_state_.+\.json$/.test(f))
        .sort();
      const bots = [];
      for (const f of stateFiles) {
        try {
          const raw = JSON.parse(readFileSync(join(liveDir, f), 'utf8'));
          if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
          // derive pair/tf from filename genesis_live_state_<PAIR>_<TF>.json if the state lacks them
          let pair = raw.pair, tf = raw.tf;
          if (!pair) {
            const m = f.match(/^genesis_live_state_(.+)_(\w+)\.json$/);
            if (m) { pair = m[1]; if (!tf) tf = m[2]; }
          }
          bots.push({ pair, tf, ...raw });
        } catch { /* skip corrupt state file */ }
      }
      let treasury = null;
      try { treasury = JSON.parse(readFileSync(join(liveDir, 'genesis_treasury_state.json'), 'utf8')); } catch { /* no treasury yet */ }
      // Back-compat: expose the first bot's full state as `bot` (bots entries are flattened {pair, tf, ...state})
      sendJson(res, 200, { ok: true, bots, bot: bots[0] ?? null, treasury, updatedAt: new Date().toISOString() });
    } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  if (url.pathname === '/api/crypto/overview') {
    try {
      const overview = getCryptoOverview();
      sendJson(res, 200, { ok: true, ...overview });
    } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  if (url.pathname === '/api/crypto/futures-desk') {
    try {
      const runCycle = ['1', 'true', 'yes', 'on'].includes((url.searchParams.get('run') ?? '').toLowerCase());
      const snapshot = await getFuturesDeskSnapshot({ runCycle });
      sendJson(res, 200, { ok: true, ...snapshot });
    } catch (e) {
      sendJson(res, 200, {
        ok: false,
        mode: 'status',
        generatedAt: new Date().toISOString(),
        warnings: [{ section: 'handler', error: e.message, at: new Date().toISOString() }],
        config: {
          breakoutPeriod: null,
          regimeSmaPeriod: null,
          tpPct: null,
          slPct: null,
          minExpectedNetUsd: null,
          minRewardRisk: null,
          timeoutHours: null,
          maxMargin: null,
          leverage: null,
          governor: { profiles: [], journal: [] },
          profiles: [],
        },
        cycle: null,
        governorJournal: [],
        baseline: null,
        treasury: {
          total: 10000,
          available: 10000,
          inTrades: 0,
          unrealizedPnl: 0,
          netWorth: 10000,
          drawdownPct: 0,
          isPaused: false,
        },
        futuresCapital: {
          startCapital: 10000,
          reservedMargin: 0,
          realizedPnl: 0,
          unrealizedPnl: 0,
          netPnl: 0,
          equity: 10000,
          available: 10000,
          openPositions: 0,
        },
        openPositions: [],
        closedSummary: [],
        equityCurve: [],
        recentLifecycle: [],
        today: { openCount: 0, closedTrades: 0, wins: 0, losses: 0, winRate: null, totalPnl: 0, avgPnl: 0 },
        cycleHistory: [],
        profileScoreboard: [],
        supervisor: {
          scope: 'futures_supervisor',
          latest: null,
          latestAttempt: null,
          appliedPolicy: {
            active: false,
            sourceRunId: null,
            appliedAt: null,
            appliedBy: null,
            expiresAt: null,
            overrides: [],
            latestApply: null,
            impact: null,
          },
        },
        recentEntries: [],
        error: e.message,
      });
    }
    return;
  }

  if (url.pathname === '/api/intelligence/supervisor/latest') {
    try {
      const state = getIntelligenceSupervisorLatest();
      sendJson(res, 200, { ok: true, advisoryOnly: true, applied: Boolean(state.appliedPolicy?.active), ...state });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message });
    }
    return;
  }

  if (url.pathname === '/api/intelligence/supervisor/history') {
    try {
      const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10)));
      const history = getIntelligenceSupervisorHistory(limit);
      sendJson(res, 200, { ok: true, advisoryOnly: true, applied: false, history });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message });
    }
    return;
  }

  const intelligenceRunMatch = url.pathname.match(/^\/api\/intelligence\/supervisor\/([^/]+)$/);
  if (intelligenceRunMatch) {
    try {
      const run = getIntelligenceSupervisorRunById(intelligenceRunMatch[1]);
      if (!run) {
        sendJson(res, 404, { ok: false, error: 'supervisor_run_not_found' });
        return;
      }
      sendJson(res, 200, { ok: true, advisoryOnly: true, applied: false, run });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message });
    }
    return;
  }

  // GET /api/crypto/candles?pair=BTCUSDT&interval=1h&limit=120
  if (url.pathname === '/api/crypto/candles') {
    try {
      const pair     = url.searchParams.get('pair') ?? 'BTCUSDT';
      const interval = url.searchParams.get('interval') ?? '1h';
      const limit    = Math.min(500, parseInt(url.searchParams.get('limit') ?? '120', 10));
      const binanceBase = process.env.BINANCE_BASE || 'https://data-api.binance.vision/api/v3';
      const r = await fetch(
        `${binanceBase}/klines?symbol=${pair}&interval=${interval}&limit=${limit}`,
        { signal: AbortSignal.timeout(6000) }
      );
      if (!r.ok) { sendJson(res, 502, { ok: false, error: `Binance ${r.status}` }); return; }
      const raw = await r.json();
      // [openTime, open, high, low, close, volume, closeTime, ...]
      const candles = raw.map(k => ({
        time:   Math.floor(k[0] / 1000),
        open:   parseFloat(k[1]),
        high:   parseFloat(k[2]),
        low:    parseFloat(k[3]),
        close:  parseFloat(k[4]),
        volume: parseFloat(k[5]),
      }));
      sendJson(res, 200, { ok: true, pair, interval, candles });
    } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  // POST /api/crypto/order — manual trade order
  if (url.pathname === '/api/crypto/order' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      if (!requireAuth(req, res)) return;
      try {
        const { pair = 'BTCUSDT', side, capitalUsed = 100 } = JSON.parse(body);
        if (!['LONG', 'SHORT'].includes(side)) {
          sendJson(res, 400, { ok: false, error: 'side must be LONG or SHORT' }); return;
        }
        // SAFETY GATE (authoritative): never bypass safe mode / risk systems.
        const gate = assertTradeAllowed({ pair });
        if (gate.blocked) {
          sendJson(res, 403, { ok: false, blocked: true, error: gate.reasons[0], reasons: gate.reasons });
          return;
        }
        const { getCurrentPrice } = await import('./crypto/priceFeeder.mjs');
        const { executeCryptoPaperTrade } = await import('./crypto/cryptoExecution.mjs');
        const entryPrice = await getCurrentPrice(pair);
        const symbol = pair.replace('USDT', '');
        const result = executeCryptoPaperTrade({
          asset: { symbol, pair, volume24h: null },
          side,
          entryPrice,
          capitalUsed,
          confidence: 0.7,
          reason: `Manual order from Crypto Lab UI`,
          evidence: [`Manual ${side} at $${entryPrice}`],
        });
        sendJson(res, 200, { ok: true, result });
      } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    });
    return;
  }

  if (url.pathname === '/api/crypto/feed') {
    try {
      const limit = Math.min(100, parseInt(url.searchParams.get('limit') ?? '60', 10));
      const events = getCryptoFeedEvents(limit);
      sendJson(res, 200, { ok: true, events });
    } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  if (url.pathname === '/api/crypto/market-intelligence') {
    try {
      const intel = getMarketIntelligence();
      sendJson(res, 200, { ok: true, ...intel });
    } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  // GET /api/crypto/depth?pair=BTCUSDT&levels=20
  if (url.pathname === '/api/crypto/depth') {
    try {
      const pair   = (url.searchParams.get('pair') ?? 'BTCUSDT').toUpperCase();
      const levels = Math.min(50, Math.max(5, parseInt(url.searchParams.get('levels') ?? '20', 10)));
      const data   = await fetchDepth(pair, levels);
      sendJson(res, 200, { ok: true, ...data });
    } catch (e) { sendJson(res, 502, { ok: false, error: e.message }); }
    return;
  }

  // GET /api/crypto/pro-validation?pair=BTCUSDT
  if (url.pathname === '/api/crypto/pro-validation') {
    try {
      const pair = (url.searchParams.get('pair') ?? 'BTCUSDT').toUpperCase();
      const validation = await getProValidation(pair);
      sendJson(res, 200, { ok: true, ...validation });
    } catch (e) { sendJson(res, 502, { ok: false, error: e.message }); }
    return;
  }

  // GET /api/crypto/commentary?limit=40 — AI commentary feed
  if (url.pathname === '/api/crypto/commentary') {
    try {
      const limit = Math.min(120, Math.max(1, parseInt(url.searchParams.get('limit') ?? '40', 10)));
      const commentary = await getCommentary({ limit });
      sendJson(res, 200, { ok: true, commentary });
    } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  // GET /api/crypto/trades?limit=40&pair=BTCUSDT — trade stories for chart overlay
  if (url.pathname === '/api/crypto/trades') {
    try {
      const limit = Math.min(120, Math.max(1, parseInt(url.searchParams.get('limit') ?? '40', 10)));
      const pair  = url.searchParams.get('pair') || null;
      const trades = getTradeStories({ limit, pair: pair ? pair.toUpperCase() : null });
      sendJson(res, 200, { ok: true, trades });
    } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  // GET /api/crypto/regime-backtest — Phase 6B.1 before/after validation over closed trades
  if (url.pathname === '/api/crypto/regime-backtest') {
    try {
      const { runRegimeBiasBacktest } = await import('./crypto/backtest/regimeBiasBacktest.mjs');
      const res2 = await runRegimeBiasBacktest();
      // Strip the heavy per-trade array from the HTTP response.
      const { evaluated, ...summary } = res2;
      sendJson(res, 200, { ok: true, ...summary });
    } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  // GET /api/crypto/shadow-candidate — read-only candidate diagnostics
  if (url.pathname === '/api/crypto/shadow-candidate') {
    try {
      const shadow = await getShadowCandidateDiagnostics();
      sendJson(res, 200, { ok: true, ...shadow });
    } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  // GET /api/crypto/breakout-shadow — read-only 4h regime-switch breakout shadow (never executes)
  if (url.pathname === '/api/crypto/breakout-shadow') {
    try {
      const shadow = await getBreakoutShadowDiagnostics();
      sendJson(res, 200, { ok: true, ...shadow });
    } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  // GET /api/db/health — hybrid persistence diagnostics (sqlite + postgres + replication)
  if (url.pathname === '/api/db/health') {
    try {
      sendJson(res, 200, { ok: true, ...getDbHealth() });
    } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  // GET /api/crypto/council — Decision Council: latest decision, verdicts,
  // approval stats, per-setup performance and blocked setups. Read-only.
  if (url.pathname === '/api/crypto/council') {
    try {
      const latest = getLatestCouncilDecision();
      const recent = getRecentCouncilDecisions(parseInt(url.searchParams.get('limit') ?? '20', 10));
      // Desk state for the dashboard badge:
      //   HUNTING   — no decision yet / last decision older than 10 min
      //   EXECUTING — latest approved decision has an open trade attached
      //   APPROVED / REJECTED — latest decision verdict (recent)
      let state = 'HUNTING';
      if (latest) {
        const ageMs = Date.now() - new Date(latest.timestamp).getTime();
        if (latest.final_decision === 'approved' && latest.trade_id) {
          const open = db.prepare("SELECT 1 FROM trades WHERE id = ? AND status = 'open'").get(latest.trade_id);
          state = open ? 'EXECUTING' : (ageMs < 600_000 ? 'APPROVED' : 'HUNTING');
        } else if (ageMs < 600_000) {
          state = latest.final_decision === 'approved' ? 'APPROVED' : 'REJECTED';
        }
      }
      sendJson(res, 200, {
        ok: true,
        state,
        latest,
        recent,
        stats: getCouncilStats(),
        config: getCouncilConfig(),
        performance: {
          byStrategy: getCouncilPerformance('strategy'),
          bySymbol: getCouncilPerformance('symbol'),
          byRegime: getCouncilPerformance('market_regime'),
          bySetup: getCouncilPerformance('setup'),
        },
        blockedSetups: getBlockedSetups(),
      });
    } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  // GET /api/crypto/diagnostics — execution telemetry (loop status + rejections + gates)
  if (url.pathname === '/api/crypto/diagnostics') {
    try {
      const sched = getSchedulerStatus();
      // Loop status comes from the shared-SQLite heartbeat the scheduler writes from the
      // AGENT process (this route runs in the SERVER process). Fall back to in-memory for
      // single-process/local dev.
      const hb = readHeartbeat();
      const src = hb ?? sched;
      const now = Date.now();
      // A loop is "live" if it ticked within 2× its own interval (+15s buffer) — so the
      // 5-min SLOW loop isn't flagged offline just because it's between ticks.
      const isLive = (iso, expectedMs) => iso ? (now - new Date(iso).getTime()) < (expectedMs * 2 + 15_000) : false;

      // Recent rejection / scan reasons for operator "why no trade" visibility
      const recent = (() => {
        try {
          return getTimeline({ limit: 12, category: 'SCAN' }).map(e => ({
            ts: e.ts, reason: e.reason, subsystem: e.subsystem,
          }));
        } catch { return []; }
      })();

      // ── Training progress extras (computed from existing SQL — no extra polling) ──
      const trainingExtras = (() => {
        try {
          const canonical = getClosedCryptoMetrics();
          const counts = getCryptoTradeCounts();
          const t = sched.training;
          // Best engine: highest win rate among engines with ≥3 closed trades
          let bestEngine = null, bestRate = -1;
          const ENGINE_LABEL = {
            scalp_v2: 'SCALP',
            swing_v1: 'SWING',
            breakout_v1: 'BREAKOUT',
            crypto_futures_breakout_short_micro: 'FUTURES MICRO',
            crypto_futures_breakout_short: 'FUTURES SHORT',
            crypto_futures_breakout_short_alt: 'FUTURES SHORT ALT',
            crypto_futures_breakout_long: 'FUTURES LONG',
            'event-alpha': 'EVENT',
          };
          for (const e of (t?.byType ?? [])) {
            if (e.trades >= 3 && (e.winRate ?? 0) > bestRate) { bestRate = e.winRate ?? 0; bestEngine = ENGINE_LABEL[e.tradeType] ?? e.tradeType; }
          }
          // Training day: days since the first crypto trade (1–30 window)
          const first = db.prepare(`
            SELECT MIN(opened_at) m
            FROM trades
            WHERE trade_type IN ('crypto_scalp','scalp_v2','swing_v1','breakout_v1','crypto_futures_breakout_short_micro','crypto_futures_breakout_short','crypto_futures_breakout_short_alt','crypto_futures_breakout_long')
          `).get()?.m;
          const trainingDay = first
            ? Math.min(30, Math.max(1, Math.ceil((Date.now() - new Date(first).getTime()) / 86_400_000)))
            : 1;
          // Confidence accuracy: calibration = 1 - avg(|confidence - won|) over closed crypto trades
          const cal = getClosedCryptoConfidenceRows(50);
          const confidenceAccuracy = cal.length >= 5
            ? Math.round((1 - cal.reduce((s, r) => s + Math.abs((r.confidence ?? 0) - r.won), 0) / cal.length) * 100)
            : null;
          return {
            total: counts.total,
            open: counts.open,
            closed: counts.closed,
            wins: canonical.wins,
            winRate: canonical.winRate != null ? Math.round(canonical.winRate * 100) / 100 : null,
            totalPnl: canonical.totalPnl,
            bestEngine,
            trainingDay,
            confidenceAccuracy,
          };
        } catch { return { bestEngine: null, trainingDay: 1, confidenceAccuracy: null }; }
      })();

      sendJson(res, 200, {
        ok: true,
        loops: {
          scalping: { running: src.started && isLive(src.lastRun?.fast, src.intervals?.fastMs ?? 5000),  ticks: src.ticks?.fast ?? 0, lastRun: src.lastRun?.fast ?? null, errors: src.errors?.fast ?? 0, expectedMs: src.intervals?.fastMs ?? 5000 },
          event:    { running: src.started && isLive(src.lastRun?.mid,  src.intervals?.midMs ?? 30000),  ticks: src.ticks?.mid ?? 0,  lastRun: src.lastRun?.mid ?? null,  errors: src.errors?.mid ?? 0,  expectedMs: src.intervals?.midMs ?? 30000 },
          swing:    { running: src.started && isLive(src.lastRun?.slow, src.intervals?.slowMs ?? 300000), ticks: src.ticks?.slow ?? 0, lastRun: src.lastRun?.slow ?? null, errors: src.errors?.slow ?? 0, expectedMs: src.intervals?.slowMs ?? 300000 },
        },
        gates: {
          scalp: scalpConfig(),
          swing: swingConfig(),
          event: eventConfig(),
        },
        training: sched.training ? { ...sched.training, ...trainingExtras } : trainingExtras,
        mode: sched.mode,
        recentScans: recent,
        scanSnapshot: hb?.scanSnapshot ?? (() => { try { return getLastScanSnapshot(); } catch { return { at: null, assets: [] }; } })(),
        regimePerformance: (() => { try { return getRegimeBiasPerformance(); } catch { return []; } })(),
        autopsy: (() => { try { return getAutopsy(); } catch { return null; } })(),
        fatigueIntelligence: (() => { try { return getFatigueIntelligenceSummary(); } catch { return null; } })(),
        llm: getCryptoLlmStatus(),
        scalpingV2: (() => {
          try {
            const diag  = getScalpV2Diagnostics();
            const today = getScalpV2TodayStats();
            return { ...diag, today };
          } catch { return null; }
        })(),
      });
    } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  // POST /api/crypto/copilot { pair, side } — pre-trade co-pilot analysis
  if (url.pathname === '/api/crypto/copilot' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      if (!requireAuth(req, res)) return;
      try {
        const { pair = 'BTCUSDT', side } = JSON.parse(body || '{}');
        if (!['LONG', 'SHORT'].includes(side)) {
          sendJson(res, 400, { ok: false, error: 'side must be LONG or SHORT' }); return;
        }
        const analysis = await analyzeTrade({ pair: pair.toUpperCase(), side });
        sendJson(res, 200, { ok: true, analysis });
      } catch (e) { sendJson(res, 502, { ok: false, error: e.message }); }
    });
    return;
  }

  if (url.pathname === '/api/trading/risk') {
    try {
      const risk = getRiskMetrics();
      sendJson(res, 200, { ok: true, risk });
    } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  if (url.pathname === '/api/trading/debates') {
    try {
      const debates = getRecentDebates(20);
      sendJson(res, 200, { ok: true, debates });
    } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  if (url.pathname === '/api/trading/leaderboard') {
    try {
      const agents = getLeaderboard();
      sendJson(res, 200, { ok: true, agents });
    } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  if (url.pathname === '/api/trading/vetoes') {
    try {
      const vetoes = getVetoStats();
      sendJson(res, 200, { ok: true, vetoes });
    } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  if (url.pathname === '/api/agent/skills') {
    try {
      const deployed = getAllDeployed();
      const agent = url.searchParams.get('agent');
      const history = agent ? getSkillHistory(agent) : null;

      // trajectory count: resolved closed trades
      const trajRow = db.prepare(
        `SELECT COUNT(*) as cnt FROM trades WHERE status = 'closed' AND resolved_outcome IS NOT NULL`
      ).get();
      const trajectoryCount = trajRow ? (trajRow.cnt || 0) : 0;

      // last optimized per agent from skill_versions
      let lastOptimizedMap = {};
      try {
        const optRows = db.prepare(
          `SELECT agent, MAX(deployed_at) as last_optimized_at FROM skill_versions WHERE status = 'deployed' GROUP BY agent`
        ).all();
        for (const row of optRows) {
          lastOptimizedMap[row.agent] = row.last_optimized_at || null;
        }
      } catch { /* skill_versions table may not exist yet */ }

      // enrich each deployed skill entry
      const enriched = (deployed || []).map(skill => ({
        ...skill,
        trajectory_count: trajectoryCount,
        last_optimized_at: lastOptimizedMap[skill.agent] || null,
        skillopt_ready: trajectoryCount >= 50,
      }));

      sendJson(res, 200, { ok: true, deployed: enriched, history });
    } catch (e) { sendJson(res, 200, { ok: true, deployed: [], history: null }); }
    return;
  }

  if (url.pathname === '/api/agent/marketing') {
    try {
      const { readFile } = await import('node:fs/promises');
      const { join, dirname } = await import('node:path');
      const { fileURLToPath } = await import('node:url');
      const __dir = dirname(fileURLToPath(import.meta.url));
      const raw = await readFile(join(__dir, '..', 'data', 'memory', 'marketing.json'), 'utf8');
      sendJson(res, 200, { ok: true, ...JSON.parse(raw) });
    } catch {
      sendJson(res, 200, { ok: true, content: null, message: 'No marketing content generated yet. Start npm run agent.' });
    }
    return;
  }

  if (url.pathname === '/api/agent/signals') {
    try {
      const signals = db.prepare(`
        SELECT id, source, signal_text, category, confidence, proved_correct, created_at
        FROM signals ORDER BY created_at DESC LIMIT 20
      `).all();
      const accuracy = getSignalAccuracy();
      sendJson(res, 200, { ok: true, signals, accuracy });
    } catch (e) { sendJson(res, 200, { ok: true, signals: [], accuracy: { total: 0, correct: 0, rate: null } }); }
    return;
  }

  if (url.pathname === '/api/agent/performance') {
    try {
      sendJson(res, 200, { ok: true, performance: getAgentPerformance() });
    } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  if (url.pathname === '/api/agent/decisions') {
    try {
      const limit = Math.min(Number(url.searchParams.get('limit') || 50), 200);
      const decisions = getRecentDecisions(limit);
      const stats     = getDecisionStats();
      sendJson(res, 200, { ok: true, decisions, stats });
    } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  if (url.pathname === '/api/agent/consensus') {
    try {
      const limit  = Math.min(Number(url.searchParams.get('limit') || 20), 200);
      const ticker = url.searchParams.get('ticker');
      const data   = ticker
        ? getConsensusForTicker(ticker, limit)
        : getRecentConsensus(limit);
      sendJson(res, 200, { ok: true, consensus: data });
    } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  if (url.pathname === '/api/trading/capital-history') {
    try {
      const history = getCapitalHistory(100);
      sendJson(res, 200, { ok: true, history });
    } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  if (url.pathname === '/api/agent/runner-status') {
    try {
      const raw = readFileSync(join(__dir, '..', 'data', 'agent-status.json'), 'utf8');
      sendJson(res, 200, { ok: true, running: true, status: JSON.parse(raw) });
    } catch {
      sendJson(res, 200, { ok: true, running: false, status: null });
    }
    return;
  }

  // GET /api/trading/trade/:id/price-history
  const priceHistoryMatch = url.pathname.match(/^\/api\/trading\/trade\/([^/]+)\/price-history$/);
  if (priceHistoryMatch) {
    try {
      const tradeId = priceHistoryMatch[1];
      const trade = db.prepare('SELECT * FROM trades WHERE id = ?').get(tradeId);
      if (!trade) { sendJson(res, 404, { ok: false, error: 'Trade not found' }); return; }
      const snapshots = db.prepare(`
        SELECT yes_price, no_price, recorded_at FROM price_snapshots
        WHERE trade_id = ? ORDER BY recorded_at ASC
      `).all(tradeId);
      sendJson(res, 200, { ok: true, trade, snapshots });
    } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  if (url.pathname === '/api/trading/pause' && req.method === 'POST') {
    try {
      const { setOrgState } = await import('./command/orgState.mjs');
      setOrgState({ mode: 'rest' });
      sendJson(res, 200, { ok: true, message: 'Trading paused' });
    } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  if (url.pathname === '/api/trading/resume' && req.method === 'POST') {
    try {
      const { setOrgState } = await import('./command/orgState.mjs');
      setOrgState({ mode: 'active' });
      sendJson(res, 200, { ok: true, message: 'Trading resumed' });
    } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  // Legacy order endpoint (kept for backwards compat)
  if (url.pathname === '/api/agent/order' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      if (!requireAuth(req, res)) return;
      try {
        const { order, priority = 'high' } = JSON.parse(body);
        if (!order?.trim()) { sendJson(res, 400, { ok: false, error: 'order required' }); return; }
        await addHumanOrder({ order, priority, source: 'human' });
        sendJson(res, 200, { ok: true, message: 'Order received. Agents will reorganize.' });
      } catch (e) { sendJson(res, 400, { ok: false, error: e.message }); }
    });
    return;
  }

  // ── Command system — natural language founder control ─────────────────────────

  if (url.pathname === '/api/command' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      if (!requireAuth(req, res)) return;
      try {
        const { command } = JSON.parse(body);
        if (!command?.trim()) { sendJson(res, 400, { ok: false, error: 'command required' }); return; }
        const result = await executeCommand(command);
        sendJson(res, 200, { ok: true, ...result });
      } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    });
    return;
  }

  if (url.pathname === '/api/command/history') {
    try {
      const history = getCommandHistory(30);
      sendJson(res, 200, { ok: true, history });
    } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  if (url.pathname === '/api/command/status') {
    try {
      const state   = getOrgState();
      const summary = getStatusSummary();
      sendJson(res, 200, { ok: true, state, summary });
    } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  // POST /api/skillopt/run — trigger SkillOpt for an agent (non-blocking)
  if (url.pathname === '/api/skillopt/run' && req.method === 'POST') {
    if (skilloptJob.running) {
      sendJson(res, 409, { ok: false, error: 'SkillOpt already running', agent: skilloptJob.agent });
      return;
    }
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      if (!requireAuth(req, res)) return;
      let parsed = {};
      try { parsed = JSON.parse(body || '{}'); } catch { /* ignore */ }
      const agent = parsed?.agent ?? 'market-scanner';
      const ALLOWED_AGENTS = ['market-scanner', 'risk-guardian', 'polymarket_agent', 'kalshi_agent', 'research_agent', 'marketing_agent', 'risk_agent'];
      if (!ALLOWED_AGENTS.includes(agent)) {
        sendJson(res, 400, { ok: false, error: `Unknown agent: ${agent}` });
        return;
      }
      skilloptJob.running = true;
      skilloptJob.startedAt = new Date().toISOString();
      skilloptJob.agent = agent;
      skilloptJob.lastResult = null;
      // Run in background — don't await
      runSkillOpt(agent)
        .then(result => {
          skilloptJob.lastResult = { ...result, completedAt: new Date().toISOString() };
          skilloptJob.running = false;
        })
        .catch(err => {
          skilloptJob.lastResult = { deployed: false, reason: err.message, completedAt: new Date().toISOString() };
          skilloptJob.running = false;
        });
      sendJson(res, 200, { ok: true, status: 'running', agent, startedAt: skilloptJob.startedAt });
    });
    return;
  }

  // GET /api/skillopt/status — current job state
  if (url.pathname === '/api/skillopt/status') {
    sendJson(res, 200, {
      ok: true,
      running: skilloptJob.running,
      agent: skilloptJob.agent,
      startedAt: skilloptJob.startedAt,
      lastResult: skilloptJob.lastResult,
    });
    return;
  }

  // ─── OPERATOR OBSERVABILITY ──────────────────────────────────────────────────

  // GET /api/operator/timeline — append-only event stream
  if (url.pathname === '/api/operator/timeline') {
    try {
      const limit    = Math.min(Number(url.searchParams.get('limit') ?? 100), 500);
      const category = url.searchParams.get('category') ?? null;
      const severity = url.searchParams.get('severity') ?? null;
      const since    = url.searchParams.get('since') ?? null;
      sendJson(res, 200, { ok: true, events: getTimeline({ limit, category, severity, since }) });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
    return;
  }

  // GET /api/operator/decision/:tradeId — per-trade explanation
  if (url.pathname.startsWith('/api/operator/decision/')) {
    try {
      const tradeId = url.pathname.replace('/api/operator/decision/', '').trim();
      const explanation = buildDecisionExplanation(tradeId);
      if (!explanation) {
        sendJson(res, 404, { ok: false, error: `Trade ${tradeId} not found` });
      } else {
        sendJson(res, 200, { ok: true, explanation });
      }
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
    return;
  }

  // GET /api/operator/system-summary — answers "why is Genesis not trading now?"
  if (url.pathname === '/api/operator/system-summary') {
    try {
      const risk       = getGlobalRiskDiagnostics();
      const confidence = getConfidenceDiagnostics();
      const learning   = getLearningDiagnostics();
      const blockers   = getCurrentBlockers();
      const warnings   = getActiveWarnings();
      const topFailure = getTopFailureReason();
      const blocked24h = countBlockedTrades();

      // Reconciliation
      const recon = getReconciliationStatus();

      // Is Genesis trading?
      const tradingBlocked = risk.safeMode || recon.status === 'degraded';

      sendJson(res, 200, {
        ok: true,
        summary: {
          tradingBlocked,
          currentBlockers: blockers,
          topFailureReason24h: topFailure,
          blockedTrades24h: blocked24h,
        },
        confidence: {
          lastScore: confidence.lastScore,
          lastBand: confidence.lastBand,
          averageScore: confidence.averageScore,
          blockedTrades: confidence.blockedTrades,
          topNoTradeReason: Object.entries(confidence.noTradeReasonCounts ?? {})
            .sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
        },
        risk: {
          score: risk.score,
          band: risk.band,
          safeMode: risk.safeMode,
          activeFlags: risk.activeFlags,
          dimensions: risk.dimensions,
          lastRefreshAt: risk.lastRefreshAt,
        },
        learning: {
          totalTradesAnalyzed: learning.totalTradesAnalyzed,
          recentAccuracy: learning.recentAccuracy,
          highBandWinRate: learning.highBandWinRate,
          lastCycleTime: learning.lastCycleTime,
          lastCycleChanges: learning.lastCycleChanges,
        },
        reconciliation: {
          status: recon.status,
          issueCount: recon.issues?.length ?? 0,
          safeMode: recon.safeMode,
        },
        activeWarnings: warnings.slice(0, 10),
        recentEvents: getRecentEvents(15),
      });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
    return;
  }

  // ─── ALPHA RESEARCH ──────────────────────────────────────────────────────────

  // GET /api/research/edge — full edge analytics report
  if (url.pathname === '/api/research/edge') {
    try {
      sendJson(res, 200, getAlphaReport());
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
    return;
  }

  // GET /api/research/agents — agent edge scores only
  if (url.pathname === '/api/research/agents') {
    try {
      sendJson(res, 200, { ok: true, ...computeAgentEdgeScores() });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
    return;
  }

  // GET /api/research/regimes — regime analysis only
  if (url.pathname === '/api/research/regimes') {
    try {
      sendJson(res, 200, { ok: true, ...computeRegimeAnalysis() });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
    return;
  }

  // ─── LIVE TRADING STATUS (Phase 6A) ──────────────────────────────────────────

  // GET /api/trading/live-status — scheduler status + training metrics
  if (url.pathname === '/api/trading/live-status') {
    try {
      sendJson(res, 200, { ok: true, ...getSchedulerStatus() });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
    return;
  }

  // GET /api/trading/training — training mode metrics only
  if (url.pathname === '/api/trading/training') {
    try {
      sendJson(res, 200, { ok: true, ...getTrainingMetrics() });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
    return;
  }

  if (url.pathname === '/api/version') {
    sendJson(res, 200, {
      ok: true,
      commit: process.env.RENDER_GIT_COMMIT ?? 'local',
      deployedAt: process.env.RENDER_SERVICE_INSTANCE_ID ?? 'dev',
      solanaModule: _solana ? 'loaded' : (_solanaError ? `error: ${_solanaError}` : 'loading'),
      node: process.version,
    });
    return;
  }

  if (url.pathname === '/api/health') {
    try {
      const treasury = getTreasury();
      const openTrades = FUTURES_ONLY_MODE
        ? (db.prepare(`SELECT COUNT(*) AS n FROM trades WHERE status = 'open' AND trade_type LIKE 'crypto_futures_%'`).get()?.n ?? 0)
        : getRecentTrades(500).filter((t) => t.status === 'open').length;
      const futuresCapital = FUTURES_ONLY_MODE ? await getLiveFuturesCapitalSnapshot() : null;
      const schedulerHeartbeat = readHeartbeat();
      let heartbeat = null;
      try {
        const { readFile } = await import('node:fs/promises');
        const { join, dirname } = await import('node:path');
        const { fileURLToPath } = await import('node:url');
        const __hdir = dirname(fileURLToPath(import.meta.url));
        heartbeat = JSON.parse(
          await readFile(join(__hdir, '..', 'data', 'memory', 'agent_heartbeat.json'), 'utf8')
        );
      } catch { /* heartbeat not written yet — first boot */ }
      const schedulerLastTickAt = latestIso(
        schedulerHeartbeat?.lastRun?.slow,
        schedulerHeartbeat?.lastRun?.mid,
        schedulerHeartbeat?.lastRun?.fast,
      );
      const lastTickAt = heartbeat?.lastTickAt ?? schedulerLastTickAt ?? null;
      const schedulerAlive = schedulerLastTickAt
        ? (Date.now() - new Date(schedulerLastTickAt).getTime()) < 10 * 60 * 1000
        : false;
      const agentAlive = lastTickAt
        ? (Date.now() - new Date(lastTickAt).getTime()) < 10 * 60 * 1000
        : schedulerAlive;
      sendJson(res, 200, {
        ok: true,
        service: 'genesis-hq-lab-backend',
        now: new Date().toISOString(),
        agent: {
          capital: FUTURES_ONLY_MODE ? (futuresCapital?.equity ?? treasury.total) : treasury.total,
          isPaused: treasury.isPaused ?? false,
          openTrades,
          lastTickAt,
          agentAlive,
          totalCycles: heartbeat?.totalCycles
            ?? schedulerHeartbeat?.ticks?.slow
            ?? schedulerHeartbeat?.ticks?.fast
            ?? 0,
          claudeEnabled: heartbeat?.claudeEnabled ?? !!process.env.ANTHROPIC_API_KEY,
        },
        futuresMode: FUTURES_ONLY_MODE,
        futuresCapital: futuresCapital ? {
          startCapital: futuresCapital.startCapital,
          reservedMargin: futuresCapital.reservedMargin,
          realizedPnl: futuresCapital.realizedPnl,
          unrealizedPnl: futuresCapital.unrealizedPnl,
          netPnl: futuresCapital.netPnl,
          equity: futuresCapital.equity,
          available: futuresCapital.available,
          openPositions: futuresCapital.openPositions,
        } : null,
        optimizer: getOptimizerHeartbeat(),
      });
    } catch {
      sendJson(res, 200, {
        ok: true,
        service: 'genesis-hq-lab-backend',
        now: new Date().toISOString(),
      });
    }
    return;
  }

  // GET /api/system/health — granular truth layer diagnostics
  if (url.pathname === '/api/system/health') {
    try {
      const truth = getSystemTruth(wsClients.size);
      sendJson(res, truth.ok ? 200 : 503, truth);
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
    return;
  }

  // GET /api/reconciliation/status — startup reconciliation diagnostics
  if (url.pathname === '/api/reconciliation/status') {
    try {
      sendJson(res, 200, { ok: true, reconciliation: getReconciliationStatus() });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
    return;
  }

  // POST /api/reconciliation/clear — operator clears safe mode after review
  if (url.pathname === '/api/reconciliation/clear' && req.method === 'POST') {
    if (!requireAuth(req, res)) return;
    try {
      const cleared = clearReconciliationSafeMode();
      sendJson(res, 200, { ok: true, reconciliation: cleared, message: 'Safe mode cleared — trading resumed' });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
    return;
  }

  // GET /api/metrics — readable by MCP server and external tools
  if (url.pathname === '/api/metrics') {
    sendJson(res, 200, {
      ok: true,
      service: 'genesis-hq-lab',
      note: 'Trading metrics from SQLite via /api/trading/dashboard and /api/agent/trades.',
      endpoints: {
        health: '/api/health',
        plan: 'POST /api/plan',
        polymarket: '/api/polymarket/events',
      },
    });
    return;
  }

  if (url.pathname === '/api/kalshi/status') {
    sendJson(res, 200, getKalshiStatus());
    return;
  }

  // ── Quant Lab routes (/api/quant/*) ──────────────────────────────────────────
  if (url.pathname === '/api/quant/status') {
    try {
      const state = getQuantState();
      sendJson(res, 200, { ok: true, ...state.edgeVerdict, updatedAt: state.updatedAt, errors: state.errors });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
    return;
  }

  if (url.pathname === '/api/quant/strategies') {
    try {
      sendJson(res, 200, { ok: true, ...getStrategyRegistry() });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
    return;
  }

  if (url.pathname === '/api/quant/validation') {
    try {
      sendJson(res, 200, { ok: true, ...runSystemValidation() });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
    return;
  }

  if (url.pathname === '/api/quant/allocation') {
    try {
      sendJson(res, 200, { ok: true, ...computeAllocation() });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
    return;
  }

  if (url.pathname === '/api/quant/report') {
    try {
      sendJson(res, 200, { ok: true, ...generateQuantReport() });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
    return;
  }

  if (url.pathname === '/api/quant/wf/status') {
    const cache = getWfCache();
    sendJson(res, 200, {
      ok: true,
      running: isWfRunning(),
      stale: isWfCacheStale(24),
      cache: cache
        ? { completedAt: cache.completedAt, startedAt: cache.startedAt, durationMs: cache.durationMs }
        : null,
      summary: cache?.summary ?? null,
      scheduler: getWfSchedulerStatus(),
    });
    return;
  }

  if (url.pathname === '/api/quant/wf/run') {
    if (isWfRunning()) {
      sendJson(res, 200, { ok: true, running: true, message: 'Walk-forward already in progress' });
      return;
    }
    // Fire-and-forget — do not await
    executeWalkForward().catch(err =>
      console.error('[WF] background run failed:', err.message)
    );
    sendJson(res, 202, { ok: true, running: true, message: 'Walk-forward started' });
    return;
  }

  if (url.pathname === '/api/quant/diagnostics') {
    try {
      // Trade counts
      const total  = db.prepare(`SELECT COUNT(*) as n FROM trades`).get()?.n ?? 0;
      const open   = db.prepare(`SELECT COUNT(*) as n FROM trades WHERE status = 'open'`).get()?.n ?? 0;
      const closed = db.prepare(`SELECT COUNT(*) as n FROM trades WHERE status = 'closed'`).get()?.n ?? 0;
      const byType = db.prepare(`
        SELECT trade_type, status, COUNT(*) as n
        FROM trades GROUP BY trade_type, status ORDER BY n DESC LIMIT 20
      `).all();
      const recentClosed = db.prepare(`
        SELECT trade_type, exit_reason, pnl, closed_at
        FROM trades WHERE status = 'closed'
        ORDER BY closed_at DESC LIMIT 10
      `).all();

      // Futures cycle history from org_state
      let cycleHistory = [];
      try {
        const row = db.prepare(`SELECT value FROM org_state WHERE key = 'futures_cycle_history'`).get();
        if (row?.value) cycleHistory = JSON.parse(row.value).slice(-5);
      } catch { /* non-fatal */ }

      sendJson(res, 200, {
        ok: true,
        trades: { total, open, closed, byType, recentClosed },
        wf: {
          running: isWfRunning(),
          stale: isWfCacheStale(24),
          scheduler: getWfSchedulerStatus(),
        },
        futuresCycles: cycleHistory,
        gate: (() => {
          try {
            const v = runSystemValidation();
            return { approved: v.approved, status: v.status, checks: v.checks?.map(c => ({ name: c.name, pass: c.pass, code: c.code })) };
          } catch (e) {
            return { error: e.message };
          }
        })(),
      });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
    return;
  }

  // GET /api/quant/strategy-log?strategyId=<id>&limit=50 — transition history
  if (url.pathname === '/api/quant/strategy-log') {
    try {
      const strategyId = url.searchParams.get('strategyId') || undefined;
      const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') ?? '50', 10)));
      const history = getTransitionHistory({ strategyId, limit });
      const overrides = getAllOverrides();
      sendJson(res, 200, { ok: true, history, overrides });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
    return;
  }

  // POST /api/quant/strategy-override — set a manual status override
  // Body: { strategyId, status, reason? }
  if (url.pathname === '/api/quant/strategy-override' && req.method === 'POST') {
    if (!requireAuth(req, res)) return;
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      try {
        const { strategyId, status, reason } = JSON.parse(raw || '{}');
        const VALID_STATUSES = ['RESEARCH', 'BACKTESTING', 'PAPER', 'PROMOTED', 'REJECTED', 'DISABLED'];
        if (!strategyId || typeof strategyId !== 'string') {
          sendJson(res, 400, { ok: false, error: 'strategyId required' });
          return;
        }
        if (!VALID_STATUSES.includes(status)) {
          sendJson(res, 400, { ok: false, error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
          return;
        }
        setStatusOverride(strategyId, status, { reason: reason ?? null, setBy: 'operator-api' });
        sendJson(res, 200, { ok: true, strategyId, status, reason: reason ?? null });
      } catch (err) {
        sendJson(res, 500, { ok: false, error: err.message });
      }
    });
    return;
  }

  // DELETE /api/quant/strategy-override/:strategyId — clear a manual override
  if (url.pathname.startsWith('/api/quant/strategy-override/') && req.method === 'DELETE') {
    if (!requireAuth(req, res)) return;
    try {
      const strategyId = decodeURIComponent(url.pathname.slice('/api/quant/strategy-override/'.length));
      if (!strategyId) {
        sendJson(res, 400, { ok: false, error: 'strategyId required in path' });
        return;
      }
      clearStatusOverride(strategyId);
      sendJson(res, 200, { ok: true, strategyId, cleared: true });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
    return;
  }

  // ── Prediction Markets module routes (/api/prediction-markets/*) ─────────────
  if (url.pathname.startsWith('/api/prediction-markets')) {
    const handled = await handlePredictionMarketsRoute(req, res, url, {
      apiSecret: process.env.API_SECRET?.trim() || null,
    });
    if (handled) return;
  }

  if (url.pathname === '/api/polymarket/health') {
    const health = await fetchPolymarketHealth();
    sendJson(res, health.ok ? 200 : 502, health);
    return;
  }

  if (url.pathname === '/api/polymarket/events') {
    try {
      const limit = Number(url.searchParams.get('limit') || '8');
      const offset = Number(url.searchParams.get('offset') || '0');
      const order = url.searchParams.get('order') || 'volume_24hr';

      const snapshot = await fetchPolymarketEventsSnapshot({
        limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 20) : 8,
        offset: Number.isFinite(offset) ? Math.max(offset, 0) : 0,
        order,
      });

      sendJson(res, 200, snapshot);
    } catch (error) {
      sendJson(res, 502, {
        ok: false,
        error: 'provider_unreachable',
        message: error instanceof Error ? error.message : 'Provider unreachable',
      });
    }
    return;
  }

  // ── Solana Alpha Lab routes (/api/solana/*) ───────────────────────────────────

  if (url.pathname.startsWith('/api/solana')) {
    if (!_solana) {
      sendJson(res, 503, { ok: false, error: _solanaError ?? 'solana module loading', loading: !_solanaError });
      return;
    }

    if (url.pathname === '/api/solana/status') {
      try { sendJson(res, 200, { ok: true, ..._solana.getSolanaStatus() }); } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
      return;
    }
    if (url.pathname === '/api/solana/tokens') {
      try {
        const limit = Math.min(200, parseInt(url.searchParams.get('limit') ?? '50', 10));
        sendJson(res, 200, { ok: true, tokens: _solana.getSolanaTokens(limit) });
      } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
      return;
    }
    if (url.pathname === '/api/solana/wallets') {
      try {
        const limit = Math.min(200, parseInt(url.searchParams.get('limit') ?? '50', 10));
        sendJson(res, 200, { ok: true, wallets: _solana.getSolanaWallets(limit), summary: _solana.getWalletSummary() });
      } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
      return;
    }
    if (url.pathname === '/api/solana/signals') {
      try {
        const limit = Math.min(100, parseInt(url.searchParams.get('limit') ?? '30', 10));
        sendJson(res, 200, { ok: true, signals: _solana.getSolanaSignals(limit) });
      } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
      return;
    }
    if (url.pathname === '/api/solana/paper/stats') {
      try { sendJson(res, 200, { ok: true, ..._solana.getPaperStats() }); } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
      return;
    }
    if (url.pathname === '/api/solana/paper/positions') {
      try { sendJson(res, 200, { ok: true, positions: _solana.getOpenPaperPositions() }); } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
      return;
    }
    if (url.pathname === '/api/solana/paper/trades') {
      try {
        const limit = Math.min(200, parseInt(url.searchParams.get('limit') ?? '50', 10));
        sendJson(res, 200, { ok: true, trades: _solana.getClosedPaperTrades(limit) });
      } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
      return;
    }
    if (url.pathname === '/api/solana/paper/equity') {
      try {
        const limit = Math.min(500, parseInt(url.searchParams.get('limit') ?? '200', 10));
        sendJson(res, 200, { ok: true, curve: _solana.getEquityCurve(limit) });
      } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
      return;
    }
    if (url.pathname === '/api/solana/paper/reset' && req.method === 'POST') {
      if (!requireAuth(req, res)) return;
      try { sendJson(res, 200, { ok: true, ..._solana.resetPaperBalance() }); } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
      return;
    }
    notFound(res);
    return;
  }

  notFound(res);
});

// Heartbeat: push current state every 15s so clients don't need to poll
setInterval(() => {
  if (wsClients.size === 0) return;
  try {
    const treasury = getTreasury();
    broadcast({ type: 'agent:tick', treasury, ts: Date.now() });
  } catch { /* ignore */ }
}, 15_000);

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[genesis-hq-lab-backend] Port ${PORT} is already in use. ` +
      `Another server is running — stop it first (e.g. close the other 'npm start'), ` +
      `or set PORT in .env to a free port.`);
    process.exit(1);
  }
  throw err;
});

// WebSocket upgrade at /ws
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[genesis-hq-lab-backend] listening on http://${HOST}:${PORT}`);
  kalshiStartWS();
  // Wire solana broadcast + init once the dynamic import resolves
  (async () => {
    let attempts = 0;
    while (!_solana && !_solanaError && attempts < 20) {
      await new Promise(r => setTimeout(r, 500));
      attempts++;
    }
    if (_solana) {
      _solana.setBroadcast(broadcast);
      _solana.initSolanaAlpha();
    } else {
      console.error('[solana-alpha] init skipped:', _solanaError ?? 'timeout');
    }
  })();

  // Hybrid persistence — async replication of SQLite → Supabase (no-op without DATABASE_URL).
  startReplication();

  // Walk-forward auto-scheduler: refreshes OOS evidence every hour when trades ≥ 30.
  startWfScheduler();

  // Self-ping to stay alive on Railway / Render free tiers
  const selfUrl = process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : process.env.RENDER_EXTERNAL_URL;
  if (selfUrl) {
    console.log(`[keepalive] Self-ping active → ${selfUrl}/api/health every 4 min`);
    setInterval(() => {
      fetch(`${selfUrl}/api/health`, { signal: AbortSignal.timeout(10000) })
        .then(() => {})
        .catch(() => {});
    }, 4 * 60 * 1000);
  }
});
