// liquidityMatrix.mjs — Genesis Liquidity Matrix.
// Fetches Binance public order book, computes imbalance, walls, Genesis Reading,
// and order flow signals. 3s in-memory cache per pair.
// getOrderFlowState() is consumed by marketIntelligence.mjs.

const BINANCE_BASE    = 'https://api.binance.com/api/v3';
const CACHE_TTL_MS    = 3_000;
const WALL_MULTIPLIER = 4;
const THIN_THRESHOLD  = 5;

// ── Module-level cache + shared state ─────────────────────────────────────────
let _cache     = { data: null, ts: 0, pair: null };
let _orderFlow = null;

export function getOrderFlowState() {
  return _orderFlow;
}

// ── Computation helpers ────────────────────────────────────────────────────────

function computeImbalance(totalBid, totalAsk) {
  const total = totalBid + totalAsk;
  return total === 0 ? 0 : (totalBid - totalAsk) / total;
}

function buildLevels(rawPairs) {
  // rawPairs: [[priceStr, qtyStr], ...]
  const parsed  = rawPairs.map(([p, q]) => ({ price: parseFloat(p), size: parseFloat(q) }));
  const maxSize = parsed.reduce((m, l) => Math.max(m, l.size), 0);
  const avgSize = parsed.length > 0 ? parsed.reduce((s, l) => s + l.size, 0) / parsed.length : 0;
  return parsed.map(l => ({
    price:  l.price,
    size:   l.size,
    pct:    maxSize > 0 ? l.size / maxSize : 0,
    isWall: avgSize > 0 && l.size >= avgSize * WALL_MULTIPLIER,
    isVoid: false,
  }));
}

function buildSignals(imbalance, bids, asks, midPrice) {
  const maxAsk  = asks.length ? Math.max(...asks.map(a => a.size)) : 0;
  const maxBid  = bids.length ? Math.max(...bids.map(b => b.size)) : 0;
  const avgAsk  = asks.length ? asks.reduce((s, a) => s + a.size, 0) / asks.length : 0;
  const avgBid  = bids.length ? bids.reduce((s, b) => s + b.size, 0) / bids.length : 0;
  const top3Bid = bids.slice(0, 3).reduce((s, b) => s + b.size, 0);
  return {
    buyPressure:      imbalance > 0.20,
    sellPressure:     imbalance < -0.20,
    sellWall:         avgAsk > 0 && maxAsk >= avgAsk * WALL_MULTIPLIER,
    bidWall:          avgBid > 0 && maxBid >= avgBid * WALL_MULTIPLIER,
    thinLiquidity:    (bids.reduce((s, b) => s + b.size, 0) + asks.reduce((s, a) => s + a.size, 0)) < THIN_THRESHOLD,
    absorptionZone:   midPrice > 0 && (top3Bid / midPrice) > 0.003,
    momentumBuilding: imbalance > 0.15 && imbalance <= 0.30,
  };
}

function deriveReading(imbalance, signals, totalBid, totalAsk) {
  if (totalBid + totalAsk < THIN_THRESHOLD)
    return { reading: 'THIN LIQUIDITY',     readingColor: '#6b7280', readingBg: 'rgba(107,114,128,0.06)' };
  if (signals.sellWall)
    return { reading: 'SELL WALL DETECTED', readingColor: '#ef4444', readingBg: 'rgba(239,68,68,0.08)'   };
  if (signals.bidWall && imbalance > 0)
    return { reading: 'BID WALL DETECTED',  readingColor: '#f97316', readingBg: 'rgba(249,115,22,0.08)'  };
  if (imbalance > 0.30)
    return { reading: 'BUY PRESSURE HIGH',  readingColor: '#22c55e', readingBg: 'rgba(34,197,94,0.08)'   };
  if (imbalance < -0.30)
    return { reading: 'SELL PRESSURE HIGH', readingColor: '#ef4444', readingBg: 'rgba(239,68,68,0.08)'   };
  if (signals.absorptionZone)
    return { reading: 'ABSORPTION ZONE',    readingColor: '#3b82f6', readingBg: 'rgba(59,130,246,0.08)'  };
  if (imbalance > 0.15)
    return { reading: 'MOMENTUM BUILDING',  readingColor: '#a855f7', readingBg: 'rgba(168,85,247,0.08)'  };
  return   { reading: 'BALANCED BOOK',      readingColor: '#6b7280', readingBg: 'rgba(107,114,128,0.06)' };
}

// ── Main export ────────────────────────────────────────────────────────────────

export async function fetchDepth(pair = 'BTCUSDT', levels = 20) {
  const now = Date.now();
  if (_cache.data && _cache.pair === pair && now - _cache.ts < CACHE_TTL_MS) {
    return _cache.data;
  }

  const r = await fetch(
    `${BINANCE_BASE}/depth?symbol=${pair}&limit=${levels}`,
    { signal: AbortSignal.timeout(5000) }
  );
  if (!r.ok) throw new Error(`Binance depth HTTP ${r.status}`);
  const raw = await r.json();

  const bids = buildLevels(raw.bids ?? []).sort((a, b) => b.price - a.price); // best bid first
  const asks = buildLevels(raw.asks ?? []).sort((a, b) => a.price - b.price); // best ask first

  const totalBidSize = bids.reduce((s, b) => s + b.size, 0);
  const totalAskSize = asks.reduce((s, a) => s + a.size, 0);
  const imbalance    = computeImbalance(totalBidSize, totalAskSize);

  const bestBid   = bids[0]?.price ?? 0;
  const bestAsk   = asks[0]?.price ?? 0;
  const midPrice  = bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : 0;
  const spread    = bestAsk - bestBid;
  const spreadPct = midPrice > 0 ? spread / midPrice : 0;

  const signals = buildSignals(imbalance, bids, asks, midPrice);
  const { reading, readingColor, readingBg } = deriveReading(imbalance, signals, totalBidSize, totalAskSize);

  const data = {
    pair,
    midPrice:     Math.round(midPrice  * 100)   / 100,
    spread:       Math.round(spread    * 100)   / 100,
    spreadPct:    Math.round(spreadPct * 10000) / 10000,
    imbalance:    Math.round(imbalance * 1000)  / 1000,
    imbalancePct: Math.round(imbalance * 1000)  / 10,
    totalBidSize: Math.round(totalBidSize * 1000) / 1000,
    totalAskSize: Math.round(totalAskSize * 1000) / 1000,
    bids:         bids.slice(0, Math.floor(levels / 2)),
    asks:         asks.slice(0, Math.floor(levels / 2)),
    reading,
    readingColor,
    readingBg,
    signals,
    fetchedAt: new Date().toISOString(),
  };

  _cache     = { data, ts: now, pair };
  _orderFlow = { imbalance, signals, reading, pair, ts: data.fetchedAt };

  return data;
}
