// normalizer.mjs — unified MarketSnapshot model for Polymarket + Kalshi.
// All providers funnel through here so the rest of the system is provider-agnostic.
//
// Common model:
//   { source, marketId, slug, title, outcome, yesPrice, noPrice, spread,
//     volume24h, liquidity, endDate, status, category, updatedAt }

/**
 * @typedef {Object} MarketSnapshot
 * @property {'polymarket'|'kalshi'} source
 * @property {string} marketId
 * @property {string} slug
 * @property {string} title
 * @property {string|null} outcome - primary outcome label (YES/NO or first outcome)
 * @property {number|null} yesPrice - 0..1 fraction
 * @property {number|null} noPrice  - 0..1 fraction
 * @property {number|null} spread   - noPrice - yesPrice when binary
 * @property {number|null} volume24h
 * @property {number|null} liquidity
 * @property {string|null} endDate
 * @property {'active'|'closed'|'unknown'} status
 * @property {string} category
 * @property {string} updatedAt - ISO timestamp
 */

function toFrac(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : null;
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalize a single Polymarket market (as returned by polymarketProvider).
 * Input is the nested market object from a Gamma API event.
 *
 * @param {object} raw - raw polymarket market object
 * @param {string} [eventCategory]
 * @returns {MarketSnapshot}
 */
export function normalizePolymarketMarket(raw, eventCategory = 'general') {
  const yes = raw.outcomes?.[0]; // first outcome = YES equivalent
  const no  = raw.outcomes?.[1]; // second outcome = NO equivalent

  const yesPrice = toFrac(yes?.price ?? raw.lastTradePrice ?? raw.bestAsk);
  const noPrice  = toFrac(no?.price ?? (yesPrice != null ? 1 - yesPrice : null));

  const spread = yesPrice != null && noPrice != null
    ? Math.round(Math.abs(noPrice - yesPrice) * 10000) / 10000
    : toFrac(raw.spread);

  return {
    source:    'polymarket',
    marketId:  String(raw.id ?? ''),
    slug:      raw.slug ?? '',
    title:     raw.question ?? raw.title ?? 'Untitled',
    outcome:   yes?.label ?? 'YES',
    yesPrice,
    noPrice,
    spread,
    volume24h:  toNum(raw.volume24hr ?? raw.volume24hrClob),
    liquidity:  toNum(raw.liquidity ?? raw.liquidityClob),
    endDate:    raw.endDate ?? null,
    status:     raw.active && !raw.closed ? 'active' : raw.closed ? 'closed' : 'unknown',
    category:   eventCategory,
    updatedAt:  new Date().toISOString(),
  };
}

/**
 * Normalize a Kalshi market_update event (as published by kalshi/adapter.mjs).
 *
 * @param {object} raw - kalshi market_update event
 * @returns {MarketSnapshot}
 */
export function normalizeKalshiMarket(raw) {
  const yesPrice = toFrac(raw.yesPrice);
  const noPrice  = toFrac(raw.noPrice ?? (yesPrice != null ? 1 - yesPrice : null));

  const spread = yesPrice != null && noPrice != null
    ? Math.round(Math.abs(noPrice - yesPrice) * 10000) / 10000
    : null;

  return {
    source:    'kalshi',
    marketId:  String(raw.marketId ?? raw.ticker ?? ''),
    slug:      raw.ticker ?? '',
    title:     raw.title ?? raw.ticker ?? 'Untitled',
    outcome:   'YES',
    yesPrice,
    noPrice,
    spread,
    volume24h:  toNum(raw.volume24h),
    liquidity:  toNum(raw.liquidity),
    endDate:    raw.daysToClose != null
      ? new Date(Date.now() + raw.daysToClose * 86_400_000).toISOString()
      : null,
    status:    'active',
    category:  raw.marketCategory ?? 'general',
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Validate a MarketSnapshot has the minimum required fields.
 * Returns { ok, errors }.
 *
 * @param {MarketSnapshot} snap
 */
export function validateSnapshot(snap) {
  const errors = [];
  if (!snap.source)   errors.push('missing source');
  if (!snap.marketId) errors.push('missing marketId');
  if (!snap.title)    errors.push('missing title');
  return { ok: errors.length === 0, errors };
}
