// predictionMarkets/index.mjs — route handler for /api/prediction-markets/*
// Mount this in server/index.mjs by calling handlePredictionMarketsRoute(req, res, url).
// All modules are lazy-imported so a broken sub-module never kills the server.

import { getDataProviderStatus, getAllMarkets, findOpportunities, refreshAllProviders, startAutoRefresh } from './dataProvider.mjs';
import { runBacktest, getBacktestOptions } from './backtesting/backtestEngine.mjs';
import { executePaperOrder, getPaperOrders, getPaperStats } from './execution/paperExecutor.mjs';
import { executeLiveOrder } from './execution/liveExecutor.mjs';
import { validateOrder } from './execution/orderValidator.mjs';
import { getExecutionStatus, getPortfolioSnapshot } from './execution/portfolioReader.mjs';
import { getLPRecommendations } from './liquidity/lpRecommendations.mjs';
import { getMarket } from './marketStore.mjs';
import { logEvent, SEVERITY } from '../observability/eventTimeline.mjs';

// Start auto-refresh when module is imported
startAutoRefresh();

// ── Helper: send JSON ────────────────────────────────────────────────────────

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

// ── Route handler ────────────────────────────────────────────────────────────

/**
 * Handle /api/prediction-markets/* requests.
 *
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 * @param {URL} url
 * @param {object} opts
 * @param {string} [opts.apiSecret] - for write endpoint auth
 * @returns {boolean} true if route was handled
 */
export async function handlePredictionMarketsRoute(req, res, url, { apiSecret } = {}) {
  const method = req.method;
  const path = url.pathname;

  // ── GET /api/prediction-markets/status ──────────────────────────────────────
  if (method === 'GET' && path === '/api/prediction-markets/status') {
    try {
      const status = await getDataProviderStatus();
      const execStatus = getExecutionStatus();
      sendJson(res, 200, {
        ok: true,
        module: 'prediction-markets',
        providers: status.providers,
        store: status.store,
        autoRefresh: status.autoRefreshActive,
        execution: execStatus,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
    return true;
  }

  // ── GET /api/prediction-markets/markets ─────────────────────────────────────
  if (method === 'GET' && path === '/api/prediction-markets/markets') {
    try {
      const source = url.searchParams.get('source') ?? undefined;
      const limit = Math.min(Number(url.searchParams.get('limit') || '20'), 50);
      const markets = getAllMarkets({ source }).slice(0, limit);

      // If store empty, trigger a refresh
      if (markets.length === 0) {
        const refreshResult = await refreshAllProviders();
        const refreshedMarkets = getAllMarkets({ source }).slice(0, limit);
        sendJson(res, 200, {
          ok: true,
          source: source ?? 'all',
          markets: refreshedMarkets,
          total: refreshedMarkets.length,
          refreshTriggered: true,
          refreshResult,
        });
        return true;
      }

      sendJson(res, 200, {
        ok: true,
        source: source ?? 'all',
        markets,
        total: markets.length,
      });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
    return true;
  }

  // ── GET /api/prediction-markets/opportunities ────────────────────────────────
  if (method === 'GET' && path === '/api/prediction-markets/opportunities') {
    try {
      const limit = Math.min(Number(url.searchParams.get('limit') || '10'), 20);
      const opportunities = findOpportunities({ limit });
      sendJson(res, 200, {
        ok: true,
        opportunities,
        total: opportunities.length,
        note: 'Opportunities are analytical only — not trading signals.',
      });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
    return true;
  }

  // ── GET /api/prediction-markets/market/:id ───────────────────────────────────
  if (method === 'GET' && /^\/api\/prediction-markets\/market\/[^/]+$/.test(path)) {
    try {
      const marketId = path.split('/').pop();
      const source = url.searchParams.get('source') ?? 'polymarket';
      const market = getMarket(source, marketId);

      if (!market) {
        sendJson(res, 404, { ok: false, error: 'market_not_found', marketId, source });
      } else {
        sendJson(res, 200, { ok: true, market });
      }
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
    return true;
  }

  // ── POST /api/prediction-markets/backtest ────────────────────────────────────
  if (method === 'POST' && path === '/api/prediction-markets/backtest') {
    try {
      const body = await readBody(req);
      const result = await runBacktest(body);
      sendJson(res, result.ok ? 200 : 400, result);
    } catch (err) {
      sendJson(res, 400, { ok: false, error: err.message });
    }
    return true;
  }

  // ── GET /api/prediction-markets/backtest/status ──────────────────────────────
  if (method === 'GET' && path === '/api/prediction-markets/backtest/status') {
    sendJson(res, 200, {
      ok: true,
      options: getBacktestOptions(),
      note: 'Only fixture data is available. Real historical data requires a data provider.',
    });
    return true;
  }

  // ── GET /api/prediction-markets/execution/status ────────────────────────────
  if (method === 'GET' && path === '/api/prediction-markets/execution/status') {
    try {
      const portfolio = getPortfolioSnapshot();
      sendJson(res, 200, { ok: true, ...portfolio });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
    return true;
  }

  // ── POST /api/prediction-markets/execution/validate-order ────────────────────
  if (method === 'POST' && path === '/api/prediction-markets/execution/validate-order') {
    try {
      const body = await readBody(req);
      const result = validateOrder(body);
      sendJson(res, result.ok ? 200 : 400, result);
    } catch (err) {
      sendJson(res, 400, { ok: false, error: err.message });
    }
    return true;
  }

  // ── POST /api/prediction-markets/execution/paper-order ───────────────────────
  if (method === 'POST' && path === '/api/prediction-markets/execution/paper-order') {
    // Optional auth check (same pattern as rest of Genesis)
    if (apiSecret && req.headers['x-api-secret'] !== apiSecret) {
      sendJson(res, 401, { ok: false, error: 'unauthorized' });
      return true;
    }
    try {
      const body = await readBody(req);
      const result = executePaperOrder(body);
      sendJson(res, result.ok ? 200 : 400, result);
    } catch (err) {
      sendJson(res, 400, { ok: false, error: err.message });
    }
    return true;
  }

  // ── POST /api/prediction-markets/execution/live-order ────────────────────────
  if (method === 'POST' && path === '/api/prediction-markets/execution/live-order') {
    if (apiSecret && req.headers['x-api-secret'] !== apiSecret) {
      sendJson(res, 401, { ok: false, error: 'unauthorized' });
      return true;
    }
    try {
      const body = await readBody(req);
      const confirmationToken = req.headers['x-confirmation-token'] ?? body.confirmationToken;
      const result = executeLiveOrder(body, confirmationToken);
      // Always returns blocked — this is expected
      logEvent('PREDICTION', SEVERITY.HIGH, 'routes', 'PREDICTION_LIVE_ORDER_BLOCKED', {
        reason: result.reason,
        marketId: body.marketId,
      });
      sendJson(res, 403, result);
    } catch (err) {
      sendJson(res, 400, { ok: false, error: err.message });
    }
    return true;
  }

  // ── GET /api/prediction-markets/liquidity/opportunities ──────────────────────
  if (method === 'GET' && path === '/api/prediction-markets/liquidity/opportunities') {
    try {
      const limit = Math.min(Number(url.searchParams.get('limit') || '15'), 30);
      const result = await getLPRecommendations({ limit });
      sendJson(res, 200, result);
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
    return true;
  }

  // ── POST /api/prediction-markets/refresh ────────────────────────────────────
  if (method === 'POST' && path === '/api/prediction-markets/refresh') {
    try {
      const result = await refreshAllProviders();
      sendJson(res, 200, { ok: true, result });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
    return true;
  }

  return false; // route not handled here
}
