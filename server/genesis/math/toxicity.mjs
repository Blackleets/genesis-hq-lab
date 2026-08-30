// server/genesis/math/toxicity.mjs
// Flow toxicity for the Capture Desk. PAPER. Pure. No I/O.
//
// VPIN (Easley / López de Prado / O'Hara): volume-synchronised |buy-sell|
// imbalance. High VPIN => informed flow; the rational maker widens or leaves.
// Kyle's lambda: Δmid / signed-volume, a bps tax on being filled.
//
// Trades: { price, amount, side?: 'buy'|'sell' }. Missing side => tick rule.
// OHLCV proxy: close-to-close tick rule × candle volume.

const EPS = 1e-12;

export function tickSide(price, prevPrice, fallback = 'buy') {
  const p = +price;
  const q = +prevPrice;
  if (!Number.isFinite(p)) return fallback;
  if (!Number.isFinite(q) || p === q) return fallback;
  return p > q ? 'buy' : 'sell';
}

export function signedAmount(tr, prevPrice) {
  const amt = Math.max(0, +tr.amount || 0);
  if (!(amt > 0)) return 0;
  const side = (tr.side === 'buy' || tr.side === 'sell')
    ? tr.side
    : tickSide(tr.price, prevPrice, 'buy');
  return side === 'buy' ? amt : -amt;
}

/**
 * Volume-bucket VPIN.
 * @param {Array<{price:number,amount:number,side?:string}>} trades
 * @param {{bucketVolume?: number, nBuckets?: number}} [opts]
 * @returns {{vpin: number, buckets: number, buyVol: number, sellVol: number}}
 */
export function vpinFromTrades(trades, opts = {}) {
  const list = Array.isArray(trades) ? trades : [];
  const vols = list.map((t) => Math.max(0, +t.amount || 0)).filter((v) => v > 0);
  if (vols.length < 2) return { vpin: 0, buckets: 0, buyVol: 0, sellVol: 0 };

  const total = vols.reduce((a, b) => a + b, 0);
  const nWant = Math.max(2, Math.min(50, +opts.nBuckets || 10));
  const V = Number.isFinite(+opts.bucketVolume) && +opts.bucketVolume > 0
    ? +opts.bucketVolume
    : total / nWant;

  const imbalances = [];
  let accBuy = 0;
  let accSell = 0;
  let acc = 0;
  let prev = null;
  let buyVol = 0;
  let sellVol = 0;

  const flush = () => {
    const den = accBuy + accSell;
    if (den > EPS) imbalances.push(Math.abs(accBuy - accSell) / den);
    accBuy = 0;
    accSell = 0;
    acc = 0;
  };

  for (const t of list) {
    const amt = Math.max(0, +t.amount || 0);
    if (!(amt > 0)) continue;
    const s = signedAmount(t, prev);
    prev = Number.isFinite(+t.price) ? +t.price : prev;
    let left = amt;
    while (left > EPS) {
      const room = V - acc;
      const take = Math.min(left, room);
      if (s >= 0) { accBuy += take; buyVol += take; }
      else { accSell += take; sellVol += take; }
      acc += take;
      left -= take;
      if (acc >= V - EPS) flush();
    }
  }
  if (acc > EPS) flush();

  const vpin = imbalances.length
    ? imbalances.reduce((a, b) => a + b, 0) / imbalances.length
    : 0;
  return {
    vpin: Math.max(0, Math.min(1, vpin)),
    buckets: imbalances.length,
    buyVol,
    sellVol,
  };
}

/** OHLCV rows: [ts, o, h, l, c, v] or {close, volume}. */
export function vpinFromCandles(candles, opts = {}) {
  const rows = Array.isArray(candles) ? candles : [];
  const trades = [];
  let prevC = null;
  for (const c of rows) {
    const close = Array.isArray(c) ? +c[4] : +c.close;
    const vol = Array.isArray(c) ? +(c[5] ?? 0) : +c.volume || 0;
    if (!Number.isFinite(close) || !(vol > 0)) continue;
    const side = tickSide(close, prevC, 'buy');
    trades.push({ price: close, amount: vol, side });
    prevC = close;
  }
  return vpinFromTrades(trades, opts);
}

/**
 * Kyle λ ≈ cov(Δmid, signedVol) / var(signedVol), returned as relative
 * price impact per unit volume. asBps ≈ λ * typicalFill * 10000 / mid.
 */
export function kyleLambda(trades) {
  const list = Array.isArray(trades) ? trades : [];
  if (list.length < 8) return { lambda: 0, asBpsPerUnit: 0, n: list.length };
  const dp = [];
  const xv = [];
  let prevP = null;
  let prevSigned = 0;
  for (const t of list) {
    const p = +t.price;
    if (!Number.isFinite(p) || p <= 0) continue;
    const s = signedAmount(t, prevP);
    if (prevP != null) {
      dp.push((p - prevP) / prevP);
      xv.push(prevSigned);
    }
    prevP = p;
    prevSigned = s;
  }
  const n = dp.length;
  if (n < 5) return { lambda: 0, asBpsPerUnit: 0, n };
  const mx = xv.reduce((a, b) => a + b, 0) / n;
  const my = dp.reduce((a, b) => a + b, 0) / n;
  let cov = 0;
  let vx = 0;
  for (let i = 0; i < n; i++) {
    const dx = xv[i] - mx;
    cov += dx * (dp[i] - my);
    vx += dx * dx;
  }
  const lambda = vx > EPS ? cov / vx : 0;
  return {
    lambda,
    asBpsPerUnit: lambda * 10000,
    n,
  };
}

/**
 * Markout after hypothetical maker fills at the touch.
 * Bid fill (taker sell) then mid T ticks later: (mid_T - bid)/bid.
 * Negative mean = dumped on = adverse selection cost (we flip the sign).
 * @returns {{asBps: number, nBid: number, nAsk: number}}
 */
export function markoutAsBps(trades, horizon = 5) {
  const list = Array.isArray(trades) ? trades : [];
  const H = Math.max(1, +horizon || 5);
  const costs = [];
  let nBid = 0;
  let nAsk = 0;
  for (let i = 0; i < list.length - H; i++) {
    const t = list[i];
    const p = +t.price;
    if (!Number.isFinite(p) || p <= 0) continue;
    const later = +list[i + H].price;
    if (!Number.isFinite(later) || later <= 0) continue;
    const side = t.side === 'buy' || t.side === 'sell'
      ? t.side
      : tickSide(p, i > 0 ? list[i - 1].price : p, 'buy');
    // taker sell hits our bid → we are long; AS if later < p
    if (side === 'sell') {
      costs.push(((p - later) / p) * 10000);
      nBid++;
    } else {
      costs.push(((later - p) / p) * 10000);
      nAsk++;
    }
  }
  const asBps = costs.length
    ? costs.reduce((a, b) => a + b, 0) / costs.length
    : 0;
  return { asBps: Math.max(0, asBps), nBid, nAsk };
}

export function sigmaFromTrades(trades) {
  const list = Array.isArray(trades) ? trades : [];
  const rets = [];
  let prev = null;
  for (const t of list) {
    const p = +t.price;
    if (!Number.isFinite(p) || p <= 0) continue;
    if (prev != null) rets.push(Math.abs(Math.log(p / prev)));
    prev = p;
  }
  if (!rets.length) return 0;
  const a = 2 / (Math.min(20, rets.length) + 1);
  let e = rets[0];
  for (let i = 1; i < rets.length; i++) e = a * rets[i] + (1 - a) * e;
  return e;
}
