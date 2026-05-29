import { createServer } from 'node:http';
import { fetchPolymarketEventsSnapshot, fetchPolymarketHealth } from './polymarket.mjs';
import { generateClaudePlan } from './claudePlanner.mjs';

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 8787);

function applyCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
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
