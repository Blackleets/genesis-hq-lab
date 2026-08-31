// server/genesis/marketMaker.mjs
// Liquidity provision (market making). PAPER ONLY.
//
// Internals: Kalman fair value + infinite-horizon GLFT quotes (maker-only).
// Fill model on OHLCV (no L2): bid fills if low <= bid, ask fills if high >= ask.
// Inventory is marked to close. Maker fee via feeAccountant (isMaker=true).
// This is NOT the old "reverting bar captures 2 bps" fiction.
//
// Public API UNCHANGED: simulateMarketMaker(candles, capital=1000, spreadBps=2)
// and evaluateMarketMaker(pair, {days, interval}). Default capital stays 1000.
// spreadBps is the min-edge floor (bps) so the old argument still means something.
//
// Honest limit: OHLCV cannot see queue position or adverse selection at L2.
// Research (AS/GLFT after fees) typically does NOT print; this module is the
// inventory-risk + honest fill desk, not a claimed current-regime edge.
// REAL requires human GO + keys + confirm. Never auto-executes.

import { computeFee } from './feeAccountant.mjs';
import { createKalman, fairValue } from './math/kalman.mjs';
import { barPressure, ewma } from './math/ofi.mjs';
import { glftQuotes, volRegime } from './math/glft.mjs';

const SPREAD_BPS = 2;
const INVENTORY_CAP = 0.5;
const MAKER_SCHEMA = { makerPercent: 0.0002, takerPercent: 0.001, addedToCost: true };
const QUOTE_FRAC = 0.10; // notional per side as fraction of capital

function candleOHLC(c) {
  return { o: +c[1], h: +c[2], l: +c[3], c: +c[4] };
}

function fillLot(state, side, px, coins, fee, bar, trades) {
  const { cash, qty, avg } = state;
  if (!(coins > 0) || !(px > 0)) return state;
  if (side === 'buy') {
    if (qty >= 0) {
      const nq = qty + coins;
      state.avg = nq > 0 ? (avg * qty + px * coins) / nq : 0;
      state.qty = nq;
      state.cash = cash - px * coins - fee;
      return state;
    }
    const cover = Math.min(coins, -qty);
    const pnl = (avg - px) * cover - fee * (cover / coins);
    trades.push({ pnl, bar, type: 'cover_short', price: px });
    const leftover = coins - cover;
    state.qty = qty + coins;
    state.cash = cash - px * coins - fee;
    state.avg = leftover > 0 ? px : 0;
    return state;
  }
  // sell
  if (qty <= 0) {
    const nq = qty - coins;
    state.avg = nq < 0 ? (avg * (-qty) + px * coins) / (-nq) : 0;
    state.qty = nq;
    state.cash = cash + px * coins - fee;
    return state;
  }
  const cover = Math.min(coins, qty);
  const pnl = (px - avg) * cover - fee * (cover / coins);
  trades.push({ pnl, bar, type: 'cover_long', price: px });
  const leftover = coins - cover;
  state.qty = qty - coins;
  state.cash = cash + px * coins - fee;
  state.avg = leftover > 0 ? px : (state.qty === 0 ? 0 : state.avg);
  return state;
}

export function simulateMarketMaker(candles, capital = 1000, spreadBps = SPREAD_BPS) {
  const cap = Number.isFinite(+capital) && +capital > 0 ? +capital : 1000;
  const minEdge = Number.isFinite(+spreadBps) ? +spreadBps : SPREAD_BPS;
  const kalman = createKalman({ q: 1e-6, r: 1e-4 });
  const state = { cash: cap, qty: 0, avg: 0 };
  const eqc = [cap];
  const trades = [];
  const maxNotional = cap * INVENTORY_CAP;
  let sigS = null, sigL = null;
  let prevClose = null;

  for (let i = 1; i < candles.length; i++) {
    const { o, h, l, c } = candleOHLC(candles[i]);
    if (![o, h, l, c].every(v => Number.isFinite(v) && v > 0)) {
      eqc.push(state.cash + state.qty * (Number.isFinite(c) ? c : 0));
      continue;
    }
    const mid = (h + l) / 2;
    const pressure = barPressure(o, h, l, c);
    if (prevClose > 0) {
      const r = Math.log(c / prevClose);
      if (Number.isFinite(r)) {
        const abs = Math.abs(r);
        sigS = ewma(sigS, abs, 0.20);
        sigL = ewma(sigL, abs, 0.05);
      }
    }
    prevClose = c;
    const sigma = sigS || 0.002;
    const { regimeMult } = volRegime(sigS || sigma, sigL || sigma, 1.5);
    const invNotional = state.qty * mid;
    const q = maxNotional > 0 ? Math.max(-1, Math.min(1, invNotional / maxNotional)) : 0;
    const fv = fairValue(kalman, mid, pressure, 0.0005);
    const quotes = glftQuotes({
      fair: fv,
      sigma,
      q,
      makerFee: MAKER_SCHEMA.makerPercent,
      minEdgeBps: minEdge,
      regimeMult,
      qMax: 1,
    });
    if (!quotes) {
      eqc.push(state.cash + state.qty * c);
      continue;
    }

    const quoteNotional = cap * QUOTE_FRAC;
    const roomLong = Math.max(0, maxNotional - state.qty * quotes.bid);
    const roomShort = Math.max(0, maxNotional + state.qty * quotes.ask);

    // Same-bar two-sided fill is a round-trip when the range crosses both quotes.
    const hitBid = quotes.postBid && l <= quotes.bid && roomLong > 0;
    const hitAsk = quotes.postAsk && h >= quotes.ask && roomShort > 0;

    if (hitBid && hitAsk) {
      const notional = Math.min(quoteNotional, roomLong, roomShort);
      const coins = notional / quotes.bid;
      const coinsAsk = notional / quotes.ask;
      const matched = Math.min(coins, coinsAsk);
      if (matched > 0) {
        const feeB = computeFee({ schema: MAKER_SCHEMA, isMaker: true, cost: matched * quotes.bid });
        const feeA = computeFee({ schema: MAKER_SCHEMA, isMaker: true, cost: matched * quotes.ask });
        const pnl = (quotes.ask - quotes.bid) * matched - feeB - feeA;
        trades.push({ pnl, bar: i, type: 'spread', bid: quotes.bid, ask: quotes.ask });
        state.cash += pnl;
      }
    } else if (hitBid) {
      const notional = Math.min(quoteNotional, roomLong);
      const coins = notional / quotes.bid;
      const fee = computeFee({ schema: MAKER_SCHEMA, isMaker: true, cost: notional });
      fillLot(state, 'buy', quotes.bid, coins, fee, i, trades);
    } else if (hitAsk) {
      const notional = Math.min(quoteNotional, roomShort);
      const coins = notional / quotes.ask;
      const fee = computeFee({ schema: MAKER_SCHEMA, isMaker: true, cost: notional });
      fillLot(state, 'sell', quotes.ask, coins, fee, i, trades);
    }

    const eq = state.cash + state.qty * c;
    eqc.push(eq);
  }

  return {
    trades,
    equityCurve: eqc,
    finalCapital: eqc[eqc.length - 1],
    initialCapital: cap,
  };
}

export async function evaluateMarketMaker(pair, { days = 30, interval = '15m' } = {}) {
  const { fetchKlines } = await import('../crypto/backtest/historicalData.mjs');
  const candles = await fetchKlines(pair, { days, interval });
  if (candles.length < 100) return null;
  const r = simulateMarketMaker(candles, 1000);
  const n = r.trades.length;
  const ret = (r.finalCapital - r.initialCapital) / r.initialCapital;
  let peak = -Infinity, dd = 0;
  for (const e of r.equityCurve) {
    if (e > peak) peak = e;
    const d = peak > 0 ? (peak - e) / peak : 0;
    if (d > dd) dd = d;
  }
  return {
    pair,
    bars: candles.length,
    spreadBars: n,
    returnPct: +(ret * 100).toFixed(1),
    maxDrawdownPct: +(dd * 100).toFixed(1),
    final: +r.finalCapital.toFixed(0),
  };
}

if (process.argv[1] && process.argv[1].endsWith('marketMaker.mjs')) {
  const pair = process.argv[2] || 'ETHUSDT';
  evaluateMarketMaker(pair, { days: 30, interval: '15m' })
    .then(r => { console.log(r ? `MM ${r.pair}: ret=${r.returnPct}% DD=${r.maxDrawdownPct}% spreadBars=${r.spreadBars}/${r.bars}` : 'no data'); process.exit(0); })
    .catch(e => { console.error('ERR', e.message); process.exit(1); });
}
