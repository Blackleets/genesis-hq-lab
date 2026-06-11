// historicalProvider.mjs — fetches resolved Polymarket markets and builds tick series.
//
// Data modes returned:
//   REAL_DATA     — market from Gamma API + full price history from CLOB API
//   DEGRADED_MODE — market from Gamma API, no CLOB history (sparse 3-tick series)
//   FIXTURE_DATA  — Gamma API unreachable; caller should fall back to fixtures
//
// Both endpoints are public (no auth required).
//   Gamma:  GET https://gamma-api.polymarket.com/markets?closed=true
//   CLOB:   GET https://clob.polymarket.com/prices-history?market={tokenId}&fidelity=1440

import { logEvent, SEVERITY } from '../../observability/eventTimeline.mjs';

const GAMMA_API = 'https://gamma-api.polymarket.com';
const CLOB_API  = 'https://clob.polymarket.com';

// Minimum CLOB history points required to qualify as REAL_DATA
const MIN_REAL_TICKS = 5;
// Minimum ticks for a market to be usable in a backtest at all
const MIN_USABLE_TICKS = 3;

const GAMMA_TIMEOUT_MS = 10_000;
const CLOB_TIMEOUT_MS  =  8_000;

function tryParseJson(str, fallback) {
  if (str == null) return fallback;
  if (Array.isArray(str) || typeof str === 'object') return str;
  try { return JSON.parse(str); } catch { return fallback; }
}

function clamp01(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

// ── Gamma API ─────────────────────────────────────────────────────────────────

/**
 * Fetch resolved markets from the Gamma API.
 * Returns a raw array. Throws on HTTP/network error.
 */
export async function fetchClosedMarketsFromGamma(limit = 100) {
  const url = new URL(`${GAMMA_API}/markets`);
  url.searchParams.set('closed', 'true');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('order', 'volume');
  url.searchParams.set('ascending', 'false');

  const resp = await fetch(url.toString(), {
    signal: AbortSignal.timeout(GAMMA_TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`Gamma API /markets → HTTP ${resp.status}`);
  const data = await resp.json();
  // Gamma may return a bare array or { markets: [...] } / { results: [...] }
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.markets)) return data.markets;
  if (Array.isArray(data.results)) return data.results;
  return [];
}

// ── CLOB price history ────────────────────────────────────────────────────────

/**
 * Fetch daily price history for the YES outcome token.
 * Returns raw { t: unixSeconds, p: string|number }[] or throws on error.
 */
export async function fetchClobPriceHistory(yesTokenId) {
  const url = new URL(`${CLOB_API}/prices-history`);
  url.searchParams.set('market', yesTokenId);
  url.searchParams.set('fidelity', '1440'); // daily granularity

  const resp = await fetch(url.toString(), {
    signal: AbortSignal.timeout(CLOB_TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`CLOB /prices-history → HTTP ${resp.status}`);
  const data = await resp.json();
  return Array.isArray(data.history) ? data.history : [];
}

// ── Tick builders ─────────────────────────────────────────────────────────────

/**
 * Build rich ticks from CLOB price history.
 * Each {t, p} entry: t=unix seconds, p=YES probability.
 * Sorted ascending by timestamp.
 */
export function buildTicksFromClobHistory(history, market) {
  const liq = parseFloat(market.liquidity) || 0;
  const vol = parseFloat(market.volume)    || 0;
  const perTick = history.length > 0 ? vol / history.length : 0;

  return history
    .map(({ t, p }) => {
      const yesPrice = clamp01(p);
      return {
        ts:        new Date(Number(t) * 1000).toISOString(),
        yesPrice,
        noPrice:   clamp01(1 - yesPrice),
        volume24h: perTick,
        liquidity: liq,
      };
    })
    .sort((a, b) => new Date(a.ts) - new Date(b.ts));
}

/**
 * Build a 3-point sparse tick series from market metadata alone.
 *
 * Tick 0 (open):  neutral 0.50 / 0.50 — no price data at open
 * Tick 1 (mid):   neutral 0.50 / 0.50 — no intra-market data
 * Tick 2 (close): resolved price (1.0 YES wins, 0.0 NO wins)
 *
 * This is DEGRADED_MODE: real market identity and resolution, estimated prices.
 */
export function buildSparseTicksFromMetadata(market) {
  const startTs = market.startDate ? Date.parse(market.startDate) : NaN;
  const endRaw  = market.endDate ?? market.resolutionTime ?? null;
  const endTs   = endRaw ? Date.parse(endRaw) : NaN;

  if (isNaN(startTs) || isNaN(endTs) || endTs <= startTs) return [];

  const midTs    = Math.floor((startTs + endTs) / 2);
  const winnerYes = resolveWinner(market.winner);
  if (winnerYes === null) return []; // unresolved market — skip

  const yesEnd = winnerYes ? 1.0 : 0.0;
  const liq    = parseFloat(market.liquidity) || 0;
  const vol    = parseFloat(market.volume)    || 0;

  return [
    { ts: new Date(startTs).toISOString(), yesPrice: 0.50, noPrice: 0.50, volume24h: 0,   liquidity: liq },
    { ts: new Date(midTs).toISOString(),   yesPrice: 0.50, noPrice: 0.50, volume24h: vol, liquidity: liq },
    { ts: new Date(endTs).toISOString(),   yesPrice: yesEnd, noPrice: 1 - yesEnd, volume24h: 0, liquidity: liq },
  ];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Normalize the winner field to a boolean (true=YES, false=NO, null=unresolved).
 */
function resolveWinner(winner) {
  if (winner == null) return null;
  const w = String(winner).trim().toLowerCase();
  if (w === 'yes' || w === '1' || w === 'true')  return true;
  if (w === 'no'  || w === '0' || w === 'false') return false;
  return null;
}

/**
 * Derive a stable marketId from a raw Gamma market object.
 */
function extractMarketId(market, index) {
  return String(market.id ?? market.conditionId ?? `pm-hist-${index}`);
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Load historical market records ready for the backtest engine.
 *
 * @param {object} opts
 * @param {number} [opts.limit=50]        - markets to fetch from Gamma
 * @param {number} [opts.enrichLimit=10]  - markets to enrich with CLOB price history
 * @returns {Promise<{
 *   ok: boolean,
 *   dataMode: 'REAL_DATA'|'DEGRADED_MODE'|'FIXTURE_DATA',
 *   realDataCount: number,
 *   degradedCount: number,
 *   totalMarkets: number,
 *   markets: object[],
 *   error?: string,
 * }>}
 */
export async function loadHistoricalMarkets({ limit = 50, enrichLimit = 10 } = {}) {
  // ── Step 1: fetch closed markets from Gamma ──
  let rawMarkets;
  try {
    rawMarkets = await fetchClosedMarketsFromGamma(limit);
    logEvent('PREDICTION', SEVERITY.INFO, 'historicalProvider', 'PREDICTION_HISTORICAL_FETCH_OK', {
      count: rawMarkets.length,
    });
  } catch (err) {
    logEvent('PREDICTION', SEVERITY.WARNING, 'historicalProvider', 'PREDICTION_HISTORICAL_FETCH_FAIL', {
      error: err.message,
    });
    return { ok: false, error: err.message, dataMode: 'FIXTURE_DATA', realDataCount: 0, degradedCount: 0, totalMarkets: 0, markets: [] };
  }

  if (!rawMarkets.length) {
    return { ok: false, error: 'EMPTY_RESPONSE', dataMode: 'DEGRADED_MODE', realDataCount: 0, degradedCount: 0, totalMarkets: 0, markets: [] };
  }

  // ── Step 2: enrich top N with CLOB price history ──
  const enrichTargets = rawMarkets.slice(0, enrichLimit);
  const enrichResults = await Promise.allSettled(
    enrichTargets.map((market) => {
      const tokenIds   = tryParseJson(market.clobTokenIds, []);
      const yesTokenId = Array.isArray(tokenIds) ? tokenIds[0] : null;
      if (!yesTokenId) return Promise.resolve(null);
      return fetchClobPriceHistory(String(yesTokenId));
    }),
  );

  // ── Step 3: build backtest-ready records ──
  const records    = [];
  let realDataCount = 0;
  let degradedCount = 0;

  for (let i = 0; i < rawMarkets.length; i++) {
    const market     = rawMarkets[i];
    const enriched   = i < enrichLimit ? enrichResults[i] : null;
    const clobHistory = enriched?.status === 'fulfilled' ? enriched.value : null;

    let ticks, dataMode;

    if (Array.isArray(clobHistory) && clobHistory.length >= MIN_REAL_TICKS) {
      ticks    = buildTicksFromClobHistory(clobHistory, market);
      dataMode = 'REAL_DATA';
      realDataCount++;
    } else {
      ticks    = buildSparseTicksFromMetadata(market);
      dataMode = ticks.length >= MIN_USABLE_TICKS ? 'DEGRADED_MODE' : 'INSUFFICIENT_DATA';
      if (dataMode === 'DEGRADED_MODE') degradedCount++;
    }

    if (ticks.length >= MIN_USABLE_TICKS) {
      const winnerYes  = resolveWinner(market.winner);
      const resolution = winnerYes === null ? null : (winnerYes ? 'YES' : 'NO');

      records.push({
        marketId:       extractMarketId(market, i),
        title:          market.question ?? market.title ?? 'Unknown',
        category:       market.category ?? 'general',
        resolution,
        resolutionDate: market.endDate ?? market.resolutionTime ?? null,
        ticks,
        dataMode,
        source:         'polymarket',
      });
    }
  }

  const dominantMode = realDataCount > 0 ? 'REAL_DATA'
    : degradedCount > 0 ? 'DEGRADED_MODE'
    : 'INSUFFICIENT_DATA';

  logEvent('PREDICTION', SEVERITY.INFO, 'historicalProvider', 'PREDICTION_HISTORICAL_LOADED', {
    total: records.length,
    realDataCount,
    degradedCount,
  });

  return {
    ok:           records.length > 0,
    dataMode:     dominantMode,
    realDataCount,
    degradedCount,
    totalMarkets: records.length,
    markets:      records,
  };
}
