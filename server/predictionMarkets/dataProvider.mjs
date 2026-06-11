// dataProvider.mjs — aggregates Polymarket + Kalshi into the unified market store.
// Handles degraded mode gracefully: if one provider fails, the other still works.
// Logs all events using the Genesis observability layer.

import { fetchPolymarketMarkets, getPolymarketProviderStatus } from './polymarketProvider.mjs';
import { fetchKalshiMarkets, getKalshiProviderStatus } from './kalshiProvider.mjs';
import { upsertMarkets, getMarkets, getStoreStatus } from './marketStore.mjs';
import { logEvent, CATEGORY, SEVERITY } from '../observability/eventTimeline.mjs';

// ── Auto-refresh interval ─────────────────────────────────────────────────────

const REFRESH_INTERVAL_MS = 90_000; // 90 seconds
let _refreshTimer = null;

export function startAutoRefresh() {
  if (_refreshTimer) return;
  // Immediate first fetch
  refreshAllProviders().catch(() => {});
  _refreshTimer = setInterval(() => {
    refreshAllProviders().catch(() => {});
  }, REFRESH_INTERVAL_MS);
}

export function stopAutoRefresh() {
  clearInterval(_refreshTimer);
  _refreshTimer = null;
}

// ── Core refresh ─────────────────────────────────────────────────────────────

/**
 * Refresh all providers and populate the market store.
 * Never throws — errors are logged and returned.
 */
export async function refreshAllProviders() {
  const results = { polymarket: null, kalshi: null };

  // Fetch in parallel
  const [pmResult, kResult] = await Promise.allSettled([
    fetchPolymarketMarkets({ limit: 20 }),
    fetchKalshiMarkets({ limit: 50 }),
  ]);

  // Polymarket
  if (pmResult.status === 'fulfilled' && pmResult.value.ok) {
    upsertMarkets(pmResult.value.markets);
    results.polymarket = { ok: true, count: pmResult.value.markets.length };
    logEvent(
      'PREDICTION', SEVERITY.INFO, 'dataProvider',
      'PREDICTION_DATA_FETCHED',
      { source: 'polymarket', count: pmResult.value.markets.length }
    );
  } else {
    const err = pmResult.status === 'rejected'
      ? pmResult.reason?.message
      : pmResult.value?.error;
    results.polymarket = { ok: false, error: err };
    logEvent(
      'PREDICTION', SEVERITY.WARNING, 'dataProvider',
      'PREDICTION_DATA_FAILED',
      { source: 'polymarket', error: err }
    );
  }

  // Kalshi
  if (kResult.status === 'fulfilled' && kResult.value.ok) {
    upsertMarkets(kResult.value.markets);
    results.kalshi = { ok: true, count: kResult.value.markets.length };
    logEvent(
      'PREDICTION', SEVERITY.INFO, 'dataProvider',
      'PREDICTION_DATA_FETCHED',
      { source: 'kalshi', count: kResult.value.markets.length }
    );
  } else {
    const err = kResult.status === 'rejected'
      ? kResult.reason?.message
      : kResult.value?.error;
    results.kalshi = { ok: false, error: err };
    // Only log as WARNING if key is configured (DEGRADED expected without key)
    if (process.env.KALSHI_API_KEY) {
      logEvent(
        'PREDICTION', SEVERITY.WARNING, 'dataProvider',
        'PREDICTION_DATA_FAILED',
        { source: 'kalshi', error: err }
      );
    }
  }

  return results;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Get all markets from the store, optionally filtered.
 */
export function getAllMarkets({ source, onlyFresh } = {}) {
  return getMarkets({ source, onlyFresh });
}

/**
 * Get a consolidated status of all providers + store.
 */
export async function getDataProviderStatus() {
  const [pmStatus, kStatus] = await Promise.allSettled([
    getPolymarketProviderStatus(),
    Promise.resolve(getKalshiProviderStatus()),
  ]);

  return {
    store: getStoreStatus(),
    providers: {
      polymarket: pmStatus.status === 'fulfilled' ? pmStatus.value : { ok: false, error: pmStatus.reason?.message },
      kalshi: kStatus.status === 'fulfilled' ? kStatus.value : { ok: false, error: kStatus.reason?.message },
    },
    autoRefreshActive: _refreshTimer != null,
    refreshIntervalMs: REFRESH_INTERVAL_MS,
  };
}

/**
 * Find trading opportunities: markets with positive EV indicators.
 * Returns top-ranked snapshots with opportunity metadata.
 */
export function findOpportunities({ limit = 10 } = {}) {
  const markets = getMarkets({ onlyFresh: false });

  const ranked = markets
    .filter((m) => m.status === 'active' && m.yesPrice != null && m.noPrice != null)
    .map((m) => {
      // Simple EV proxy: look for mispriced binary markets
      // EV = max(yesPrice, noPrice) → higher = more confident market → lower LP opportunity
      // Spread = gap → higher spread = more inefficiency / higher LP edge
      const ev = Math.max(m.yesPrice ?? 0, m.noPrice ?? 0);
      const spreadScore = m.spread ?? 0;
      const liquidityScore = m.liquidity ?? 0;
      const volumeScore = m.volume24h ?? 0;

      // Opportunity score: higher spread + decent liquidity
      const score = spreadScore * 100 + (liquidityScore > 1000 ? 5 : 0) + (volumeScore > 10000 ? 3 : 0);

      return {
        ...m,
        _ev: Math.round(ev * 1000) / 1000,
        _spreadScore: Math.round(spreadScore * 10000) / 10000,
        _opportunityScore: Math.round(score * 100) / 100,
      };
    })
    .sort((a, b) => b._opportunityScore - a._opportunityScore)
    .slice(0, limit);

  logEvent(
    'PREDICTION', SEVERITY.INFO, 'dataProvider',
    'PREDICTION_OPPORTUNITY_FOUND',
    { count: ranked.length }
  );

  return ranked;
}
