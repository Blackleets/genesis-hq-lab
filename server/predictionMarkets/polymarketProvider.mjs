// polymarketProvider.mjs — thin wrapper around existing server/polymarket.mjs.
// Translates Gamma API events into normalized MarketSnapshot arrays.
// Uses Polymarket Gamma API (public, no auth required).

import { fetchPolymarketEventsSnapshot } from '../polymarket.mjs';
import { normalizePolymarketMarket, validateSnapshot } from './normalizer.mjs';

/**
 * Fetch and normalize active Polymarket markets.
 *
 * @param {{ limit?: number, offset?: number, order?: string }} opts
 * @returns {Promise<{ ok: boolean, mode: string, markets: MarketSnapshot[], error?: string, fetchedAt: string }>}
 */
export async function fetchPolymarketMarkets({ limit = 20, offset = 0, order = 'volume_24hr' } = {}) {
  const fetchedAt = new Date().toISOString();

  try {
    const snapshot = await fetchPolymarketEventsSnapshot({ limit, offset, order });

    const markets = [];
    let normalizeFailCount = 0;

    for (const event of snapshot.events) {
      const category = event.tags?.[0] ?? 'general';
      for (const rawMarket of event.markets ?? []) {
        try {
          const snap = normalizePolymarketMarket(rawMarket, category);
          const { ok, errors } = validateSnapshot(snap);
          if (!ok) {
            console.warn(`[predMarkets:polymarket] NORMALIZE_FAIL marketId=${rawMarket.id}: ${errors.join(', ')}`);
            normalizeFailCount++;
            continue;
          }
          markets.push(snap);
        } catch (err) {
          console.warn(`[predMarkets:polymarket] NORMALIZE_FAIL: ${err.message}`);
          normalizeFailCount++;
        }
      }
    }

    console.log(`[predMarkets:polymarket] DATA_FETCH_OK events=${snapshot.events.length} markets=${markets.length} normalizeFails=${normalizeFailCount}`);

    return {
      ok: true,
      mode: 'read-only',
      source: 'polymarket',
      markets,
      eventCount: snapshot.events.length,
      normalizeFailCount,
      fetchedAt,
    };
  } catch (err) {
    console.warn(`[predMarkets:polymarket] DATA_FETCH_FAIL: ${err.message}`);
    return {
      ok: false,
      mode: 'degraded',
      source: 'polymarket',
      markets: [],
      error: err.message,
      fetchedAt,
    };
  }
}

/**
 * Health check for Polymarket provider.
 */
export async function getPolymarketProviderStatus() {
  try {
    const result = await fetchPolymarketMarkets({ limit: 1 });
    return {
      provider: 'polymarket',
      ok: result.ok,
      mode: result.mode,
      authRequired: false,
      marketCount: result.markets.length,
      error: result.error ?? null,
    };
  } catch (err) {
    return {
      provider: 'polymarket',
      ok: false,
      mode: 'degraded',
      authRequired: false,
      error: err.message,
    };
  }
}
