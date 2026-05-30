import { createServer } from 'node:http';
import { fetchPolymarketEventsSnapshot, fetchPolymarketHealth } from './polymarket.mjs';
import { generateClaudePlan } from './claudePlanner.mjs';
import { getSnapshot, getCapital, getTrades, getLessons, getAgentStats, addHumanOrder } from './memoryStore.mjs';
import { getDashboardMetrics } from './trading/analytics.mjs';
import { getTreasury, getCapitalHistory } from './trading/treasury.mjs';
import { getRiskMetrics } from './trading/riskManager.mjs';
import { getRecentDebates } from './trading/debateRoom.mjs';
import { getLeaderboard } from './memory/agentScoring.mjs';
import { getVetoStats } from './memory/mistakePrevention.mjs';
import { getRecentTrades } from './memory/tradingMemory.mjs';
import db from './db/database.mjs';
import { executeCommand, getCommandHistory } from './command/commandExecutor.mjs';
import { getOrgState, getStatusSummary } from './command/orgState.mjs';

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

  const url = new URL(req.url, `http://${req.headers.host ?? `${HOST}:${PORT}`}`);

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

  // All other routes are GET-only.
  if (req.method !== 'GET') {
    sendJson(res, 405, {
      ok: false,
      error: 'method_not_allowed',
      message: 'Only GET is allowed',
    });
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
      const metrics = getDashboardMetrics();
      sendJson(res, 200, { ok: true, ...metrics });
    } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  if (url.pathname === '/api/trading/treasury') {
    try {
      const treasury = getTreasury();
      sendJson(res, 200, { ok: true, treasury });
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

  if (url.pathname === '/api/health') {
    sendJson(res, 200, {
      ok: true,
      service: 'genesis-hq-lab-backend',
      mode: 'read-only',
      now: new Date().toISOString(),
    });
    return;
  }

  // GET /api/metrics — readable by MCP server and external tools
  if (url.pathname === '/api/metrics') {
    sendJson(res, 200, {
      ok: true,
      service: 'genesis-hq-lab',
      note: 'Live metrics are stored client-side. For real-time data, subscribe to SSE or use the frontend state.',
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

server.listen(PORT, HOST, () => {
  console.log(`[genesis-hq-lab-backend] listening on http://${HOST}:${PORT}`);
});
