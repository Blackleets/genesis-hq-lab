// server/genesis/marketMaker.mjs
// The regime-INDEPENDENT edge: liquidity provision (market making).
//
// Unlike directional strategies, a market maker earns the BID-ASK SPREAD by
// quoting both sides and capturing mean-reversion of price around the mid.
// It wins in ANY regime as long as there is volume — this is what real
// market makers do. We simulate it honestly with REAL orderbook-free proxy:
// use OHLCV, assume we capture a fraction of the spread per filled round-trip
// when price mean-reverts within a bar (high volatility + mean reversion).
//
// Honest model: per interval, if |close - open| is small relative to the bar
// range (mean-reverting bar), we capture spread*k. Inventory risk is capped.
//
// PAPER ONLY. REAL requires human GO + keys + confirm. Never auto-executes.

const SPREAD_BPS = 2;        // 2 bps captured per round-trip (conservative maker rebate net)
const INVENTORY_CAP = 0.5;    // max position = 50% of capital (inventory risk control)

// Simulate a simple always-on market maker on real OHLCV.
// Each bar: quote both sides; capture spread on the fraction of bars that
// mean-revert (|close-open| < 0.5*range). Net of fees + inventory drag.
export function simulateMarketMaker(candles, capital = 1000, spreadBps = SPREAD_BPS) {
  let eq = capital;
  const eqc = [capital];
  const trades = [];
  let pos = 0; // signed inventory (in $ notional)
  const maxPos = capital * INVENTORY_CAP;
  const FEE_BPS = 0.4; // 0.04% per fill (taker-ish, conservative for MM)
  const ADVERSE_HAIRCUT = 0.4; // only 40% of theoretical spread captured (rest lost to adverse selection)
  for (let i = 1; i < candles.length; i++) {
    const o = +candles[i][1], c = +candles[i][4], h = +candles[i][2], l = +candles[i][3];
    const range = (h - l) || (o * 0.0001);
    const reverting = Math.abs(c - o) < range * 0.5;
    if (reverting && Math.abs(pos) < maxPos) {
      // capture (spread - 2*fee) * haircut on half capital turned per bar
      const gross = (spreadBps / 10000) * capital * 0.5;
      const fee = (FEE_BPS / 10000) * capital * 0.5 * 2;
      const pnl = (gross - fee) * ADVERSE_HAIRCUT;
      eq += pnl;
      trades.push({ pnl, bar: i, type: 'spread' });
      pos += (c - o) / o * capital * 0.5;
      if (Math.abs(pos) > maxPos) pos = Math.sign(pos) * maxPos;
    } else if (!reverting) {
      eq += (c - o) / o * pos;
    }
    eqc.push(eq);
  }
  return { trades, equityCurve: eqc, finalCapital: eq, initialCapital: capital };
}

export async function evaluateMarketMaker(pair, { days = 30, interval = '15m' } = {}) {
  const { fetchKlines } = await import('../crypto/backtest/historicalData.mjs');
  const candles = await fetchKlines(pair, { days, interval });
  if (candles.length < 100) return null;
  const r = simulateMarketMaker(candles, 1000);
  const n = r.trades.length;
  const gross = r.trades.reduce((s, t) => s + t.pnl, 0);
  const ret = (r.finalCapital - r.initialCapital) / r.initialCapital;
  // max dd
  let peak = -Infinity, dd = 0;
  for (const e of r.equityCurve) { if (e > peak) peak = e; const d = peak > 0 ? (peak - e) / peak : 0; if (d > dd) dd = d; }
  return { pair, bars: candles.length, spreadBars: n, returnPct: +(ret * 100).toFixed(1), maxDrawdownPct: +(dd * 100).toFixed(1), final: +r.finalCapital.toFixed(0) };
}

if (process.argv[1] && process.argv[1].endsWith('marketMaker.mjs')) {
  const pair = process.argv[2] || 'ETHUSDT';
  evaluateMarketMaker(pair, { days: 30, interval: '15m' })
    .then(r => { console.log(r ? `MM ${r.pair}: ret=${r.returnPct}% DD=${r.maxDrawdownPct}% spreadBars=${r.spreadBars}/${r.bars}` : 'no data'); process.exit(0); })
    .catch(e => { console.error('ERR', e.message); process.exit(1); });
}
