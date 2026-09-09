// RESEARCH_ONLY OKX consolidated RPI order-book features.
// Public market data only. Never places orders or changes trading gates.

const BASE = 'https://www.okx.com';

async function getJson(path, fetchImpl = fetch) {
  const res = await fetchImpl(`${BASE}${path}`, {
    headers: { 'user-agent': 'genesis-hq-research-only/1.0' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path.split('?')[0]}`);
  const payload = await res.json();
  if (String(payload?.code ?? '') !== '0' || !Array.isArray(payload?.data) || !payload.data.length) {
    throw new Error(`OKX ${payload?.code ?? 'invalid'} for ${path.split('?')[0]}`);
  }
  return payload.data[0];
}

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseSide(rows = []) {
  return rows.map(row => ({
    price: finite(row?.[0]),
    totalQty: finite(row?.[1]),
    nonRpiQty: finite(row?.[2]),
    orderCount: finite(row?.[3]),
  })).filter(row => row.price !== null && row.totalQty !== null && row.totalQty >= 0);
}

export function deriveRpiOrderBookFeatures(snapshot = {}) {
  const bids = parseSide(snapshot?.bids);
  const asks = parseSide(snapshot?.asks);
  const bidDepth = bids.reduce((sum, row) => sum + row.totalQty, 0);
  const askDepth = asks.reduce((sum, row) => sum + row.totalQty, 0);
  const totalDepth = bidDepth + askDepth;
  const bidNonRpi = bids.reduce((sum, row) => sum + Math.max(0, row.nonRpiQty ?? row.totalQty), 0);
  const askNonRpi = asks.reduce((sum, row) => sum + Math.max(0, row.nonRpiQty ?? row.totalQty), 0);
  const nonRpiDepth = bidNonRpi + askNonRpi;
  const bestBid = bids[0]?.price ?? null;
  const bestAsk = asks[0]?.price ?? null;
  const mid = bestBid !== null && bestAsk !== null && bestAsk >= bestBid ? (bestBid + bestAsk) / 2 : null;
  const spreadBps = mid && mid > 0 ? ((bestAsk - bestBid) / mid) * 10000 : null;
  const imbalance = totalDepth > 0 ? (bidDepth - askDepth) / totalDepth : null;
  const rpiDepthShare = totalDepth > 0 ? Math.max(0, totalDepth - nonRpiDepth) / totalDepth : null;
  return {
    rpiBookLevelCount: Math.min(bids.length, asks.length),
    rpiBidDepth: bidDepth,
    rpiAskDepth: askDepth,
    rpiDepthImbalance: imbalance,
    rpiDepthShare,
    rpiSpreadBps: spreadBps,
  };
}

export async function getOkxRpiOrderBookContext(instId = 'BTC-USDT-SWAP', { depth = 20, fetchImpl = fetch } = {}) {
  const sz = Math.max(1, Math.min(Number(depth) || 20, 400));
  const snapshot = await getJson(`/api/v5/market/books-rpi?instId=${encodeURIComponent(instId)}&sz=${sz}`, fetchImpl);
  const time = finite(snapshot?.ts);
  if (time === null) throw new Error('OKX books-rpi missing timestamp');
  return {
    time,
    instId,
    source: 'okx_books_rpi',
    ...deriveRpiOrderBookFeatures(snapshot),
  };
}
