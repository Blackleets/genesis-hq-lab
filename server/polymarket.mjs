const DEFAULT_GAMMA_BASE = 'https://gamma-api.polymarket.com';

function asNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeOutcomeBook(outcomes, prices) {
  const labels = parseJsonArray(outcomes);
  const rawPrices = parseJsonArray(prices);

  return labels
    .map((label, index) => ({
      label: typeof label === 'string' ? label : String(label ?? ''),
      price: asNumber(rawPrices[index]),
    }))
    .filter((entry) => entry.label.length > 0);
}

function normalizeMarket(market) {
  return {
    id: String(market.id ?? ''),
    slug: market.slug ?? '',
    question: market.question ?? market.title ?? 'Untitled market',
    description: market.description ?? '',
    endDate: market.endDate ?? null,
    active: Boolean(market.active),
    closed: Boolean(market.closed),
    acceptingOrders: Boolean(market.acceptingOrders),
    liquidity: asNumber(market.liquidity ?? market.liquidityNum ?? market.liquidityClob),
    volume: asNumber(market.volume ?? market.volumeNum ?? market.volumeClob),
    volume24hr: asNumber(market.volume24hr ?? market.volume24hrClob),
    lastTradePrice: asNumber(market.lastTradePrice),
    bestBid: asNumber(market.bestBid),
    bestAsk: asNumber(market.bestAsk),
    spread: asNumber(market.spread),
    outcomes: normalizeOutcomeBook(market.outcomes, market.outcomePrices),
  };
}

function normalizeEvent(event) {
  const markets = Array.isArray(event.markets) ? event.markets.map(normalizeMarket) : [];

  return {
    id: String(event.id ?? ''),
    slug: event.slug ?? '',
    title: event.title ?? 'Untitled event',
    description: event.description ?? '',
    endDate: event.endDate ?? null,
    image: event.image ?? event.icon ?? null,
    active: Boolean(event.active),
    closed: Boolean(event.closed),
    liquidity: asNumber(event.liquidity ?? event.liquidityClob),
    volume: asNumber(event.volume),
    volume24hr: asNumber(event.volume24hr),
    openInterest: asNumber(event.openInterest),
    tags: Array.isArray(event.tags)
      ? event.tags
          .map((tag) => tag?.label)
          .filter((label) => typeof label === 'string' && label.length > 0)
      : [],
    url: event.slug ? `https://polymarket.com/event/${event.slug}` : null,
    markets,
  };
}

export async function fetchPolymarketEventsSnapshot({
  limit = 8,
  offset = 0,
  order = 'volume_24hr',
} = {}) {
  const gammaBase = process.env.POLYMARKET_GAMMA_BASE || DEFAULT_GAMMA_BASE;
  const params = new URLSearchParams({
    active: 'true',
    closed: 'false',
    order,
    ascending: 'false',
    limit: String(limit),
    offset: String(offset),
  });
  const url = `${gammaBase}/events?${params.toString()}`;

  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'genesis-hq-lab/markets-readonly',
    },
  });

  if (!response.ok) {
    throw new Error(`Gamma API returned ${response.status}`);
  }

  const payload = await response.json();
  const events = Array.isArray(payload) ? payload.map(normalizeEvent) : [];

  return {
    ok: true,
    provider: 'polymarket',
    mode: 'read-only',
    source: 'gamma-api',
    fetchedAt: new Date().toISOString(),
    events,
  };
}

export async function fetchPolymarketHealth() {
  try {
    const snapshot = await fetchPolymarketEventsSnapshot({ limit: 1, offset: 0 });
    return {
      ok: true,
      provider: 'polymarket',
      mode: 'read-only',
      fetchedAt: snapshot.fetchedAt,
      eventsVisible: snapshot.events.length,
    };
  } catch (error) {
    return {
      ok: false,
      provider: 'polymarket',
      mode: 'read-only',
      error: error instanceof Error ? error.message : 'Unknown provider error',
    };
  }
}
