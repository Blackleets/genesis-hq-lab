import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
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
    } catch {
      sendJson(res, 200, { ok: true, capital: { total: 10000, available: 10000 }, trades: { open: 0, closed: 0, all: [] }, lessons: [], agentStats: {}, performance: { totalTrades: 0, winRate: 0, totalPnL: 0 } });
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

  // GET /api/crypto/candles?pair=BTCUSDT&interval=1h&limit=120
  if (url.pathname === '/api/crypto/candles') {
    try {
      const pair     = url.searchParams.get('pair') ?? 'BTCUSDT';
      const interval = url.searchParams.get('interval') ?? '1h';
      const limit    = Math.min(500, parseInt(url.searchParams.get('limit') ?? '120', 10));
      const r = await fetch(
        `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${interval}&limit=${limit}`,
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
      try {
        const { pair = 'BTCUSDT', side, capitalUsed = 100 } = JSON.parse(body);
        if (!['LONG', 'SHORT'].includes(side)) { sendJson(res, 400, { ok: false, error: 'side must be LONG or SHORT' }); return; }
        const { executeScalp } = await import('./crypto/cryptoExecution.mjs');
        const price = await (await import('./crypto/priceFeeder.mjs')).getCurrentPrice(pair);
        const asset = { symbol: pair.replace('USDT',''), pair };
        const result = await executeScalp({
          asset, side, entryPrice: price, capitalUsed,
          reason: 'Manual order from Crypto Lab UI',
          confidence: 0.7,
          targetPrice: side === 'LONG' ? price * 1.02 : price * 0.98,
          stopPrice: side === 'LONG' ? price * 0.985 : price * 1.015,
        });
        sendJson(res, 200, { ok: true, result });
      } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
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
      sendJson(res, 200, {
        ok: true,
        service: 'genesis-hq-lab-backend',
        now: new Date().toISOString(),
        agent: {
          capital: treasury.total,
          isPaused: treasury.isPaused ?? false,
          openTrades,
          lastTickAt: heartbeat?.lastTickAt ?? null,
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
});
