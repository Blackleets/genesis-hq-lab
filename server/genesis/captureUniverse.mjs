// Shared OKX universe for Vercel API + harvest worker.
// Rank by USDT notional (volCcy24h × mid). Maker sleeve: notional floor +
// spread wide enough that a maker quote is not an instant cross of ETH/BTC.
// Never invents a name. Empty tape → empty list.

export const OKX = 'https://www.okx.com';
export const MIN_NOTIONAL = 1_000_000;
export const MIN_MAKER_SPREAD_BPS = 5;

export function spreadBps(bid, ask) {
  const mid = (bid + ask) / 2;
  if (!(mid > 0)) return 0;
  return ((ask - bid) / mid) * 1e4;
}

export function tickerRows(data) {
  const rows = Array.isArray(data) ? data : [];
  const out = [];
  for (const t of rows) {
    const bid = +t.bidPx;
    const ask = +t.askPx;
    const vol = +t.volCcy24h;
    if (!(bid > 0) || !(ask > bid) || !(vol > 0)) continue;
    const instId = String(t.instId || '');
    if (!instId.endsWith('-USDT-SWAP')) continue;
    const mid = (bid + ask) / 2;
    const notional = vol * mid;
    out.push({
      instId,
      bid,
      ask,
      vol,
      mid,
      notional,
      spread: spreadBps(bid, ask),
    });
  }
  out.sort((a, b) => b.notional - a.notional);
  return out;
}

/**
 * Maker-first: liquid names with spread >= MIN_MAKER_SPREAD_BPS.
 * Fill remaining slots with top notional (ETH/BTC watch) so the blotter
 * still shows why those books refuse a maker quote. Unique instId.
 */
export function pickUniverseFromTickers(data, limit = 40) {
  const all = tickerRows(data);
  const maker = all.filter(
    (s) => s.notional >= MIN_NOTIONAL && s.spread >= MIN_MAKER_SPREAD_BPS,
  );
  const seen = new Set();
  const out = [];
  for (const s of maker) {
    if (out.length >= limit) break;
    seen.add(s.instId);
    out.push({ ...s, sleeve: 'maker' });
  }
  for (const s of all) {
    if (out.length >= limit) break;
    if (seen.has(s.instId)) continue;
    seen.add(s.instId);
    out.push({ ...s, sleeve: 'watch' });
  }
  return out;
}

export async function fetchOkxTickers(ms = 9000) {
  const r = await fetch(`${OKX}/api/v5/market/tickers?instType=SWAP`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(ms),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} tickers`);
  const j = await r.json();
  return Array.isArray(j.data) ? j.data : [];
}

export async function pickUniverse(limit = 40) {
  const data = await fetchOkxTickers();
  return pickUniverseFromTickers(data, limit);
}
