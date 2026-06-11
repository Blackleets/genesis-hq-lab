// polymarketAdapter.mjs — typed adapter for Polymarket.
// Read-only by default. Wraps the data provider for market lookups.
// Execution functions delegate to paperExecutor or liveExecutor.

import { getAllMarkets } from '../dataProvider.mjs';

/**
 * Get active Polymarket markets from the store.
 */
export function getPolymarketMarkets({ limit = 20 } = {}) {
  return getAllMarkets({ source: 'polymarket' }).slice(0, limit);
}

/**
 * Find a specific Polymarket market by ID.
 */
export function findPolymarketMarket(marketId) {
  const markets = getAllMarkets({ source: 'polymarket' });
  return markets.find((m) => m.marketId === marketId) ?? null;
}

/**
 * Current adapter capabilities (read-only vs full).
 */
export function getAdapterCapabilities() {
  const hasPrivateKey = !!process.env.POLYMARKET_PRIVATE_KEY;
  const hasApiKey = !!process.env.POLYMARKET_API_KEY;
  const liveEnabled = process.env.ENABLE_LIVE_PREDICTION_TRADING === 'true';

  return {
    source: 'polymarket',
    dataRead: true,            // always available via Gamma API
    portfolioRead: hasPrivateKey, // requires POLYMARKET_PRIVATE_KEY
    paperTrade: true,          // always available
    liveTrade: liveEnabled && hasPrivateKey,
    blockers: [
      ...(hasPrivateKey ? [] : ['BLOCKED_BY_SECRET_OR_API: POLYMARKET_PRIVATE_KEY']),
      ...(hasApiKey ? [] : ['BLOCKED_BY_SECRET_OR_API: POLYMARKET_API_KEY (for CLOB auth)']),
      ...(!liveEnabled ? ['LIVE_TRADING_DISABLED: set ENABLE_LIVE_PREDICTION_TRADING=true'] : []),
    ],
  };
}
