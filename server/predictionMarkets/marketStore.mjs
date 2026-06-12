// marketStore.mjs — in-memory cache for normalized MarketSnapshots.
// TTL-based: stale entries are returned but marked as stale.
// Never persists to disk — restart clears cache intentionally.

const CACHE_TTL_MS = 60_000; // 1 minute

const _store = new Map(); // key: `${source}:${marketId}` → { snap, cachedAt }

let _lastRefreshAt = null;
let _lastRefreshSource = null;

/**
 * Store an array of MarketSnapshots in the cache.
 *
 * @param {MarketSnapshot[]} snapshots
 */
export function upsertMarkets(snapshots) {
  for (const snap of snapshots) {
    const key = `${snap.source}:${snap.marketId}`;
    _store.set(key, { snap, cachedAt: Date.now() });
  }
  _lastRefreshAt = new Date().toISOString();
  if (snapshots.length > 0) {
    _lastRefreshSource = snapshots[0].source;
  }
}

/**
 * Get all cached markets, optionally filtering by source.
 * Marks stale entries with `_stale: true`.
 *
 * @param {{ source?: 'polymarket'|'kalshi', onlyFresh?: boolean }} opts
 * @returns {MarketSnapshot[]}
 */
export function getMarkets({ source, onlyFresh = false } = {}) {
  const now = Date.now();
  const results = [];

  for (const [, { snap, cachedAt }] of _store) {
    if (source && snap.source !== source) continue;
    const stale = now - cachedAt > CACHE_TTL_MS;
    if (onlyFresh && stale) continue;
    results.push(stale ? { ...snap, _stale: true } : snap);
  }

  return results;
}

/**
 * Get a single market by source + marketId.
 *
 * @param {string} source
 * @param {string} marketId
 * @returns {MarketSnapshot|null}
 */
export function getMarket(source, marketId) {
  const entry = _store.get(`${source}:${marketId}`);
  if (!entry) return null;
  const stale = Date.now() - entry.cachedAt > CACHE_TTL_MS;
  return stale ? { ...entry.snap, _stale: true } : entry.snap;
}

/**
 * Summary of the cache state.
 */
export function getStoreStatus() {
  const now = Date.now();
  let fresh = 0;
  let stale = 0;
  let bySource = {};

  for (const [, { snap, cachedAt }] of _store) {
    const isStale = now - cachedAt > CACHE_TTL_MS;
    isStale ? stale++ : fresh++;
    bySource[snap.source] = (bySource[snap.source] ?? 0) + 1;
  }

  return {
    total: _store.size,
    fresh,
    stale,
    bySource,
    lastRefreshAt: _lastRefreshAt,
    lastRefreshSource: _lastRefreshSource,
    cacheTtlMs: CACHE_TTL_MS,
  };
}

/** Clear the entire cache (for testing). */
export function clearStore() {
  _store.clear();
  _lastRefreshAt = null;
  _lastRefreshSource = null;
}
