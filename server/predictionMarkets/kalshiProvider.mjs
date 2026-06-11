// kalshiProvider.mjs — wraps the existing kalshi/adapter.mjs for the unified data layer.
// The kalshi adapter already normalizes to market_update events internally;
// this module re-normalizes those to MarketSnapshot format.
// Requires KALSHI_API_KEY. Returns degraded mode without it.

import { getKalshiStatus, normalizeMarket as kalshiNormalizeRaw } from '../kalshi/adapter.mjs';
import { normalizeKalshiMarket, validateSnapshot } from './normalizer.mjs';

const KALSHI_REST_BASE = 'https://trading-api.kalshi.com/trade-api/v2';
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Fetch active Kalshi markets directly via REST (separate from the WS adapter poll).
 * This is a read-only fetch for the data layer.
 *
 * @param {{ limit?: number }} opts
 * @returns {Promise<{ ok: boolean, mode: string, markets: MarketSnapshot[], error?: string, fetchedAt: string }>}
 */
export async function fetchKalshiMarkets({ limit = 50 } = {}) {
  const fetchedAt = new Date().toISOString();
  const apiKey = process.env.KALSHI_API_KEY;

  if (!apiKey) {
    console.log('[predMarkets:kalshi] DATA_FETCH_FAIL no KALSHI_API_KEY — returning degraded');
    return {
      ok: false,
      mode: 'degraded',
      source: 'kalshi',
      markets: [],
      error: 'BLOCKED_BY_SECRET_OR_API: KALSHI_API_KEY not configured',
      fetchedAt,
    };
  }

  try {
    const res = await fetch(
      `${KALSHI_REST_BASE}/markets?limit=${limit}&status=open`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }
    );

    if (!res.ok) {
      const msg = `Kalshi REST HTTP ${res.status}`;
      console.warn(`[predMarkets:kalshi] DATA_FETCH_FAIL: ${msg}`);
      return { ok: false, mode: 'degraded', source: 'kalshi', markets: [], error: msg, fetchedAt };
    }

    const body = await res.json();
    const rawMarkets = Array.isArray(body?.markets) ? body.markets : Array.isArray(body) ? body : [];

    const markets = [];
    let normalizeFailCount = 0;

    for (const raw of rawMarkets) {
      try {
        // Use existing kalshi normalizeMarket to get the market_update shape,
        // then re-normalize to our common MarketSnapshot
        const marketUpdate = kalshiNormalizeRaw(raw);
        // Attach title from raw (market_update doesn't carry title)
        marketUpdate.title = raw.title ?? raw.event_title ?? raw.ticker ?? 'Untitled';
        const snap = normalizeKalshiMarket(marketUpdate);
        const { ok, errors } = validateSnapshot(snap);
        if (!ok) {
          console.warn(`[predMarkets:kalshi] NORMALIZE_FAIL ticker=${raw.ticker}: ${errors.join(', ')}`);
          normalizeFailCount++;
          continue;
        }
        markets.push(snap);
      } catch (err) {
        console.warn(`[predMarkets:kalshi] NORMALIZE_FAIL: ${err.message}`);
        normalizeFailCount++;
      }
    }

    console.log(`[predMarkets:kalshi] DATA_FETCH_OK markets=${markets.length} normalizeFails=${normalizeFailCount}`);

    return {
      ok: true,
      mode: 'read-only',
      source: 'kalshi',
      markets,
      normalizeFailCount,
      fetchedAt,
    };
  } catch (err) {
    console.warn(`[predMarkets:kalshi] DATA_FETCH_FAIL: ${err.message}`);
    return {
      ok: false,
      mode: 'degraded',
      source: 'kalshi',
      markets: [],
      error: err.message,
      fetchedAt,
    };
  }
}

/**
 * Health/status of the Kalshi provider.
 */
export function getKalshiProviderStatus() {
  const adapterStatus = getKalshiStatus();
  const hasKey = !!process.env.KALSHI_API_KEY;

  return {
    provider: 'kalshi',
    ok: hasKey && adapterStatus.wsConnected,
    mode: hasKey ? 'read-only' : 'degraded',
    authRequired: true,
    keyConfigured: hasKey,
    wsConnected: adapterStatus.wsConnected,
    marketPollActive: adapterStatus.marketPollActive,
    error: !hasKey ? 'BLOCKED_BY_SECRET_OR_API: KALSHI_API_KEY not configured' : null,
  };
}
