// RESEARCH_ONLY fixed-window OKX taker-flow evidence.
// Public read-only endpoints only. Never places orders or alters trading gates.

const BASE = 'https://www.okx.com';

async function okx(path, fetchImpl = fetch) {
  const res = await fetchImpl(`${BASE}${path}`, {
    headers: { 'user-agent': 'genesis-hq-research-only/1.0' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path.split('?')[0]}`);
  const payload = await res.json();
  if (String(payload?.code ?? '') !== '0' || !Array.isArray(payload?.data)) {
    throw new Error(`OKX ${payload?.code ?? 'invalid'} for ${path.split('?')[0]}`);
  }
  return payload.data;
}

function normalizeTrade(row) {
  const time = Number(row?.ts);
  const size = Number(row?.sz);
  const price = Number(row?.px);
  const side = row?.side;
  if (!Number.isFinite(time) || !Number.isFinite(size) || size <= 0 || !Number.isFinite(price) || price <= 0) return null;
  if (side !== 'buy' && side !== 'sell') return null;
  return { time, size, price, side, tradeId: String(row?.tradeId ?? '') };
}

export function aggregateFixedWindowTaker(rows = [], {
  windowMs = 60_000,
  minimumCoverageRatio = 0.9,
} = {}) {
  const deduped = new Map();
  for (const raw of rows) {
    const row = normalizeTrade(raw);
    if (!row) continue;
    const key = row.tradeId || `${row.time}:${row.side}:${row.price}:${row.size}`;
    if (!deduped.has(key)) deduped.set(key, row);
  }
  const trades = [...deduped.values()].sort((a, b) => a.time - b.time);
  if (!trades.length) return { available: false, reason: 'NO_VALID_TRADES' };

  const latestTime = trades.at(-1).time;
  const cutoff = latestTime - windowMs;
  const inWindow = trades.filter(row => row.time >= cutoff && row.time <= latestTime);
  const earliestTime = inWindow.at(0)?.time ?? latestTime;
  const coverageMs = latestTime - earliestTime;
  const minimumCoverageMs = windowMs * minimumCoverageRatio;
  if (coverageMs < minimumCoverageMs) {
    return {
      available: false,
      reason: 'INSUFFICIENT_WINDOW_COVERAGE',
      targetWindowMs: windowMs,
      coverageMs,
      tradeCount: inWindow.length,
      latestTime,
      earliestTime,
    };
  }

  let buyContracts = 0;
  let sellContracts = 0;
  let buyNotional = 0;
  let sellNotional = 0;
  for (const row of inWindow) {
    const notional = row.size * row.price;
    if (row.side === 'buy') {
      buyContracts += row.size;
      buyNotional += notional;
    } else {
      sellContracts += row.size;
      sellNotional += notional;
    }
  }
  const totalContracts = buyContracts + sellContracts;
  const totalNotional = buyNotional + sellNotional;
  if (totalContracts <= 0 || totalNotional <= 0) return { available: false, reason: 'ZERO_VOLUME_WINDOW' };

  return {
    available: true,
    time: latestTime,
    windowStartTime: cutoff,
    windowEndTime: latestTime,
    targetWindowMs: windowMs,
    coverageMs,
    tradeCount: inWindow.length,
    buyContracts,
    sellContracts,
    buyFraction: buyContracts / totalContracts,
    buySellRatio: sellContracts > 0 ? buyContracts / sellContracts : null,
    buyNotional,
    sellNotional,
    notionalBuyFraction: buyNotional / totalNotional,
    source: 'okx_public_history_trades_fixed_window',
  };
}

export async function fetchFixedWindowTaker(instId = 'BTC-USDT-SWAP', {
  windowMs = 60_000,
  minimumCoverageRatio = 0.9,
  maxPages = 20,
  fetchImpl = fetch,
} = {}) {
  const all = [];
  const latest = await okx(`/api/v5/market/trades?instId=${encodeURIComponent(instId)}&limit=100`, fetchImpl);
  all.push(...latest);
  const normalizedLatest = latest.map(normalizeTrade).filter(Boolean).sort((a, b) => a.time - b.time);
  if (!normalizedLatest.length) return { available: false, reason: 'NO_VALID_TRADES' };

  const latestTime = normalizedLatest.at(-1).time;
  const cutoff = latestTime - windowMs;
  let oldestTime = normalizedLatest.at(0).time;
  let pages = 1;

  while (oldestTime > cutoff && pages < maxPages) {
    const page = await okx(`/api/v5/market/history-trades?instId=${encodeURIComponent(instId)}&type=2&after=${oldestTime}&limit=100`, fetchImpl);
    if (!page.length) break;
    all.push(...page);
    const normalized = page.map(normalizeTrade).filter(Boolean).sort((a, b) => a.time - b.time);
    if (!normalized.length) break;
    const nextOldest = normalized.at(0).time;
    if (nextOldest >= oldestTime) break;
    oldestTime = nextOldest;
    pages += 1;
  }

  const out = aggregateFixedWindowTaker(all, { windowMs, minimumCoverageRatio });
  return {
    ...out,
    pagesFetched: pages,
    maxPages,
    endpointLatest: '/api/v5/market/trades',
    endpointHistory: '/api/v5/market/history-trades',
    paginationType: 'timestamp',
    researchUse: 'OBSERVATIONAL_ONLY_NOT_FOR_RANKING',
  };
}
