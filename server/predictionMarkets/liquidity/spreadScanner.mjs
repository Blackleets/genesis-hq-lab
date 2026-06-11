// spreadScanner.mjs — ranks markets by bid-ask spread width.
// Wide spreads = higher LP edge potential, but also higher risk.

/**
 * Rank markets by spread (widest first).
 *
 * @param {MarketSnapshot[]} markets
 * @param {{ minLiquidity?: number, minVolume24h?: number }} opts
 * @returns {Array}
 */
export function rankBySpread(markets, { minLiquidity = 0, minVolume24h = 0 } = {}) {
  return markets
    .filter((m) => {
      if (m.status !== 'active') return false;
      if (m.spread == null || m.spread <= 0) return false;
      if (minLiquidity > 0 && (m.liquidity ?? 0) < minLiquidity) return false;
      if (minVolume24h > 0 && (m.volume24h ?? 0) < minVolume24h) return false;
      return true;
    })
    .sort((a, b) => (b.spread ?? 0) - (a.spread ?? 0))
    .map((m) => ({
      ...m,
      _spreadRank: 'spread_ranked',
      _spreadPct: m.spread != null ? `${(m.spread * 100).toFixed(2)}%` : null,
    }));
}

/**
 * Find markets with unusually wide spreads (potential mispricing).
 * Wide = spread > threshold.
 *
 * @param {MarketSnapshot[]} markets
 * @param {number} threshold - fraction (default 0.06 = 6%)
 */
export function findWideSpreadMarkets(markets, threshold = 0.06) {
  return rankBySpread(markets).filter((m) => m.spread != null && m.spread > threshold);
}
