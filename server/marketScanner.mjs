// marketScanner — fetches real market data from Polymarket and Kalshi.
// Returns unified market objects that decisionEngine can analyze.
// Falls back gracefully when APIs are unavailable.

const POLYMARKET_BASE = 'https://gamma-api.polymarket.com';
const KALSHI_BASE = 'https://trading-api.kalshi.com/trade-api/v2';

// ─── Polymarket ───────────────────────────────────────────────────────────────

async function fetchPolymarket(limit = 15) {
  try {
    const res = await fetch(
      `${POLYMARKET_BASE}/events?limit=${limit}&active=true&archived=false&order=volume24hr&ascending=false`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return [];
    const events = await res.json();

    const markets = [];
    for (const event of (Array.isArray(events) ? events : [])) {
      for (const market of (event.markets ?? [])) {
        // Polymarket returns outcomes and outcomePrices as JSON strings
        let outcomes, prices;
        try {
          outcomes = typeof market.outcomes === 'string' ? JSON.parse(market.outcomes) : (market.outcomes ?? []);
          prices   = typeof market.outcomePrices === 'string' ? JSON.parse(market.outcomePrices) : (market.outcomePrices ?? []);
        } catch { continue; }
        const yesIdx   = outcomes.findIndex(o => o.toLowerCase() === 'yes');
        const noIdx    = outcomes.findIndex(o => o.toLowerCase() === 'no');
        if (yesIdx === -1 || noIdx === -1) continue;

        const yesPrice = parseFloat(prices[yesIdx] ?? 0.5);
        const noPrice  = parseFloat(prices[noIdx]  ?? 0.5);
        if (isNaN(yesPrice) || isNaN(noPrice)) continue;

        const volume   = parseFloat(market.volume ?? event.volume ?? 0);
        const endDate  = market.endDate ?? event.endDate ?? null;

        // Constitution Rule #1: skip markets resolving > 45 days out (too uncertain)
        const daysToClose = endDate
          ? Math.round((new Date(endDate) - Date.now()) / 86400000)
          : 999;
        if (daysToClose > 45 || daysToClose < 0) continue;

        markets.push({
          source:       'polymarket',
          id:           market.conditionId ?? market.id,
          question:     market.question ?? event.title,
          category:     event.tags?.[0]?.label ?? 'general',
          yesPrice,
          noPrice,
          volume24h:    parseFloat(market.volume24hr ?? 0),
          volumeTotal:  volume,
          daysToClose,
          liquidity:    parseFloat(market.liquidity ?? 0),
        });
      }
    }
    return markets;
  } catch (err) {
    console.warn('[marketScanner] Polymarket unavailable:', err.message);
    return [];
  }
}

// ─── Kalshi ───────────────────────────────────────────────────────────────────

async function fetchKalshi(limit = 15) {
  const apiKey = process.env.KALSHI_API_KEY;
  if (!apiKey) return []; // graceful skip if no key

  try {
    const res = await fetch(
      `${KALSHI_BASE}/markets?limit=${limit}&status=open`,
      {
        headers: { 'Authorization': `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!res.ok) return [];
    const { markets = [] } = await res.json();

    return markets
      .filter(m => m.can_close_early !== true)
      .map(m => {
        const daysToClose = m.close_time
          ? Math.round((new Date(m.close_time) - Date.now()) / 86400000)
          : 30;
        return {
          source:      'kalshi',
          id:          m.ticker,
          question:    m.title,
          category:    m.category ?? 'general',
          yesPrice:    m.yes_ask  / 100,
          noPrice:     m.no_ask   / 100,
          volume24h:   m.volume_24h ?? 0,
          volumeTotal: m.volume ?? 0,
          daysToClose,
          liquidity:   m.open_interest ?? 0,
        };
      })
      .filter(m => m.daysToClose >= 1 && m.daysToClose <= 45);
  } catch (err) {
    console.warn('[marketScanner] Kalshi unavailable:', err.message);
    return [];
  }
}

// ─── Filters (Constitution rules applied here) ────────────────────────────────

function filterMarkets(markets) {
  return markets
    .filter(m => m.volumeTotal >= 5000)      // min $5k total volume
    .filter(m => m.volume24h  >= 200)        // min $200 daily volume (active market)
    .filter(m => m.yesPrice   >= 0.05)       // avoid near-certain markets (low edge)
    .filter(m => m.yesPrice   <= 0.95)
    .sort((a, b) => b.volume24h - a.volume24h)
    .slice(0, 20);                           // top 20 by daily volume
}

// ─── Scoring (helps decisionEngine focus) ────────────────────────────────────

function scoreMarket(m) {
  // Simple score: higher volume + mid-probability = more interesting
  const volumeScore = Math.log10(Math.max(m.volume24h, 1)) / 6; // normalize
  const edgeScore   = 1 - Math.abs(m.yesPrice - 0.5) * 2;       // 0.5 = best edge
  const timeScore   = 1 - m.daysToClose / 45;                    // shorter = more certain
  return volumeScore * 0.4 + edgeScore * 0.4 + timeScore * 0.2;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function scanMarkets() {
  const [polymarkets, kalshiMarkets] = await Promise.all([
    fetchPolymarket(20),
    fetchKalshi(15),
  ]);

  const all = filterMarkets([...polymarkets, ...kalshiMarkets]);
  const scored = all.map(m => ({ ...m, score: scoreMarket(m) }))
    .sort((a, b) => b.score - a.score);

  console.log(`[marketScanner] ${scored.length} markets (${polymarkets.length} poly + ${kalshiMarkets.length} kalshi)`);
  return scored;
}

export async function getMarketStatus(source, marketId) {
  if (source === 'kalshi') {
    const apiKey = process.env.KALSHI_API_KEY;
    if (!apiKey) return null;
    try {
      const res = await fetch(`${KALSHI_BASE}/markets/${marketId}`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return null;
      const { market } = await res.json();
      return {
        status: market.status,
        result: market.result ?? null, // 'yes' | 'no' | null
      };
    } catch { return null; }
  }

  if (source === 'polymarket') {
    try {
      const res = await fetch(`${POLYMARKET_BASE}/markets/${marketId}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return null;
      const market = await res.json();
      const resolved = market.closed || market.archived;
      const winner   = market.outcomes?.find(o => o.winner);
      return {
        status: resolved ? 'resolved' : 'open',
        result: winner ? (winner.label?.toLowerCase() === 'yes' ? 'yes' : 'no') : null,
      };
    } catch { return null; }
  }

  return null;
}

// Fetch current YES/NO price for an open position
export async function fetchCurrentPrice(source, marketId) {
  if (source === 'polymarket') {
    try {
      const res = await fetch(`${POLYMARKET_BASE}/markets/${marketId}`, {
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) return null;
      const market = await res.json();
      let outcomes, prices;
      try {
        outcomes = typeof market.outcomes === 'string' ? JSON.parse(market.outcomes) : (market.outcomes ?? []);
        prices   = typeof market.outcomePrices === 'string' ? JSON.parse(market.outcomePrices) : (market.outcomePrices ?? []);
      } catch { return null; }
      const yesIdx = outcomes.findIndex(o => o.toLowerCase() === 'yes');
      const noIdx  = outcomes.findIndex(o => o.toLowerCase() === 'no');
      return {
        yesPrice: yesIdx >= 0 ? parseFloat(prices[yesIdx]) : null,
        noPrice:  noIdx  >= 0 ? parseFloat(prices[noIdx])  : null,
      };
    } catch { return null; }
  }
  if (source === 'kalshi') {
    const apiKey = process.env.KALSHI_API_KEY;
    if (!apiKey) return null;
    try {
      const res = await fetch(`${KALSHI_BASE}/markets/${marketId}`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) return null;
      const { market } = await res.json();
      return {
        yesPrice: market.yes_ask != null ? market.yes_ask / 100 : null,
        noPrice:  market.no_ask  != null ? market.no_ask  / 100 : null,
      };
    } catch { return null; }
  }
  return null;
}
