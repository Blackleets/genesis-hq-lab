import { sendJson, sendMethodNotAllowed } from './_lib/http.js';
import {
  solanaEquityCurve,
  solanaLimit,
  solanaPaperPositions,
  solanaPaperStats,
  solanaPaperTrades,
  solanaSignals,
  solanaStatus,
  solanaTokens,
  solanaWallets,
} from './_lib/solanaFallback.js';

// Single Solana route. The catch-all api/solana/[...path].js did not route
// reliably on Vercel (sub-paths 404'd, the path param arrived empty), so the
// whole Pump.fun feed was dead in prod. This consolidates to one function fed by
// a vercel.json rewrite: /api/solana/:path*  ->  /api/solana?path=:path*
function routeKey(req) {
  const raw = req.query?.path;
  if (Array.isArray(raw)) return raw.join('/');
  return String(raw ?? '').replace(/^\/+/, '');
}

export default async function handler(req, res) {
  const key = routeKey(req);

  if (req.method === 'GET') {
    if (key === 'status') return sendJson(res, 200, await solanaStatus());
    if (key === 'tokens') return sendJson(res, 200, await solanaTokens(solanaLimit(req, 50)));
    if (key === 'wallets') return sendJson(res, 200, await solanaWallets(solanaLimit(req, 50)));
    if (key === 'signals') return sendJson(res, 200, await solanaSignals(solanaLimit(req, 30)));
    if (key === 'paper/stats') return sendJson(res, 200, await solanaPaperStats());
    if (key === 'paper/positions') return sendJson(res, 200, await solanaPaperPositions());
    if (key === 'paper/trades') return sendJson(res, 200, await solanaPaperTrades(solanaLimit(req, 50)));
    if (key === 'paper/equity') return sendJson(res, 200, await solanaEquityCurve(solanaLimit(req, 200)));
  }

  if (req.method === 'POST' && key === 'paper/reset') {
    return sendJson(res, 409, {
      ok: false,
      error: 'Provider not configured',
      message: 'Paper reset is only available on the live backend runner, not the read-only Vercel snapshot.',
    });
  }

  if (key === 'paper/reset') return sendMethodNotAllowed(res, 'POST');
  return sendJson(res, 404, { ok: false, error: 'not_found', path: key });
}
