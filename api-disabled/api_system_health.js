import { sendJson, sendMethodNotAllowed } from '../_lib/http.js';
import { getSystemHealthFallback } from '../_lib/cryptoFallback.js';
import { fetchRemoteFallback } from '../_lib/remoteFallback.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendMethodNotAllowed(res);
  try {
    return sendJson(res, 200, await fetchRemoteFallback('system-health'));
  } catch (error) {
    try {
      return sendJson(res, 200, await getSystemHealthFallback());
    } catch (innerError) {
      // Even if both fail, return a valid health structure (not undefined)
      console.error('[health] both remoteCache and getSystemHealthFallback failed:', innerError);
      return sendJson(res, 200, {
        ok: false,
        timestamp: new Date().toISOString(),
        probeMs: 0,
        error: innerError instanceof Error ? innerError.message : (error instanceof Error ? error.message : 'fallback_system_health_failed'),
        execution: {
          capital: 0,
          available: 0,
          openTrades: 0,
          isPaused: true,
          drawdownPct: 0,
          agentAlive: false,
          lastTickAt: null,
          realizedPnl: null,
          winRate: null,
          totalTrades: 0,
          stalePositionCount: 0,
          unrealizedDegraded: true,
          pnlFresh: false,
          unrealizedPnl: null,
          drawdownProtection: null,
          startupReconciliation: null,
          confidenceEngine: null,
          globalRisk: null,
        },
        database: { ok: false, totalTrades: 0, tables: 0 },
        agentRunner: { agentAlive: false, neverStarted: true },
        issues: [{
          severity: 'warn',
          system: 'backend',
          message: 'System health unavailable',
        }],
      });
    }
  }
}
