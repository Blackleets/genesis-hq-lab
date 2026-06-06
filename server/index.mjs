import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { fetchPolymarketEventsSnapshot, fetchPolymarketHealth } from './polymarket.mjs';
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
import { getCryptoOverview, getOptimizerHeartbeat, computeCryptoEdgeScorecard } from './crypto/cryptoAnalytics.mjs';
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
// Start MarketAnalystAgent (subscribes to internal market_update bus)
startMarketAnalyst(broadcast);

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 8787);

function applyCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res, status, payload) {
  applyCors(res);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
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
        WHERE status = 'closed' AND COALESCE(trade_type,'prediction') <> 'crypto_scalp'
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

  if (url.pathname === '/api/crypto/overview') {
    try {
      const overview = getCryptoOverview();
      sendJson(res, 200, { ok: true, ...overview });
    } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
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

  if (url.pathname === '/api/health') {
    try {
      const treasury = getTreasury();
      const openTrades = getRecentTrades(500).filter((t) => t.status === 'open').length;
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
      const lastTickAt = heartbeat?.lastTickAt ?? null;
      const agentAlive = lastTickAt
        ? (Date.now() - new Date(lastTickAt).getTime()) < 10 * 60 * 1000
        : false;
      sendJson(res, 200, {
        ok: true,
        service: 'genesis-hq-lab-backend',
        now: new Date().toISOString(),
        agent: {
          capital: treasury.total,
          isPaused: treasury.isPaused ?? false,
          openTrades,
          lastTickAt,
          agentAlive,
          totalCycles: heartbeat?.totalCycles ?? 0,
          claudeEnabled: heartbeat?.claudeEnabled ?? false,
        },
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
});
