import { sendJson, sendMethodNotAllowed } from './_lib/http.js';
import { fetchRemoteFallback } from './_lib/remoteFallback.js';
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
//
// Read strategy mirrors api/crypto/*: try the Supabase edge fallback FIRST
// (genesis-fallback?route=solana-*), since Vercel has no POSTGRES_URL in prod
// (direct Postgres returned "Provider not configured"). Direct Postgres stays as
// a secondary path for environments that do have it (local/self-hosted).
function routeKey(req) {
  const raw = req.query?.path;
  if (Array.isArray(raw)) return raw.join('/');
  return String(raw ?? '').replace(/^\/+/, '');
}

// key -> { route: edge route name, local: () => Postgres fallback }
function resolver(req) {
  return {
    'status': { route: 'solana-status', local: () => solanaStatus() },
    'tokens': { route: 'solana-tokens', local: () => solanaTokens(solanaLimit(req, 50)), limit: solanaLimit(req, 50) },
    'wallets': { route: 'solana-wallets', local: () => solanaWallets(solanaLimit(req, 50)), limit: solanaLimit(req, 50) },
    'signals': { route: 'solana-signals', local: () => solanaSignals(solanaLimit(req, 30)), limit: solanaLimit(req, 30) },
    'paper/stats': { route: 'solana-paper-stats', local: () => solanaPaperStats() },
    'paper/positions': { route: 'solana-paper-positions', local: () => solanaPaperPositions() },
    'paper/trades': { route: 'solana-paper-trades', local: () => solanaPaperTrades(solanaLimit(req, 50)), limit: solanaLimit(req, 50) },
    'paper/equity': { route: 'solana-paper-equity', local: () => solanaEquityCurve(solanaLimit(req, 200)), limit: solanaLimit(req, 200) },
  };
}

export default async function handler(req, res) {
  const key = routeKey(req);

  if (req.method === 'GET') {
    const entry = resolver(req)[key];
    if (entry) {
      try {
        const params = entry.limit != null ? { limit: entry.limit } : {};
        return sendJson(res, 200, await fetchRemoteFallback(entry.route, params));
      } catch (remoteError) {
        try {
          return sendJson(res, 200, await entry.local());
        } catch (localError) {
          return sendJson(res, 500, {
            ok: false,
            error: localError instanceof Error
              ? localError.message
              : (remoteError instanceof Error ? remoteError.message : 'solana_route_failed'),
          });
        }
      }
    }
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
