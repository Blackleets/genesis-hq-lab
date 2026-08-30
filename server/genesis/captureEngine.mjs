// server/genesis/captureEngine.mjs
// Paper capture: if harvest says QUOTE on the FIRST half of the tape, replay
// the SECOND half as last-in-queue maker fills at GLFT (not at the touch).
// Books USDT PnL. Never sends an order. Never flips REAL_TRADING.
//
// A fill happens only when a print goes THROUGH our quote:
//   taker sell px <= glft.bid  → we buy
//   taker buy  px >= glft.ask  → we sell
// Same worst-case queue assumption as paperFillTester, but quotes are GLFT
// (deeper / skewed) and VPIN can still halt mid-replay if flow turns toxic.
//
// Paper capital default $10,000. 10% notional per fill, 50% inventory cap.
// Maker fee via feeAccountant.computeFee(isMaker:true).

import { computeFee } from './feeAccountant.mjs';
import { glftQuotes } from './math/glft.mjs';
import { vpinFromTrades, sigmaFromTrades } from './math/toxicity.mjs';
import { VPIN_HALT } from './math/harvest.mjs';
import {
  LIVE_OFF,
  scoreTapeAndBook,
} from './captureCore.mjs';

export const PAPER_CAPITAL = 10000;
const QUOTE_FRAC = 0.10;
const INVENTORY_CAP = 0.5;
const WARMUP = 10;

function schemaOf(makerFeePct) {
  const m = Math.max(0, +makerFeePct || 0.0002);
  return { makerPercent: m, takerPercent: Math.max(m, 0.0004), addedToCost: true };
}

function fillLot(state, side, px, coins, fee, fills) {
  const { cash, qty, avg } = state;
  if (!(coins > 0) || !(px > 0)) return 0;
  let realized = 0;
  if (side === 'buy') {
    if (qty >= 0) {
      const nq = qty + coins;
      state.avg = nq > 0 ? (avg * qty + px * coins) / nq : 0;
      state.qty = nq;
      state.cash = cash - px * coins - fee;
    } else {
      const cover = Math.min(coins, -qty);
      realized = (avg - px) * cover - fee * (cover / coins);
      const leftover = coins - cover;
      state.qty = qty + coins;
      state.cash = cash - px * coins - fee;
      state.avg = leftover > 0 ? px : 0;
    }
  } else {
    if (qty <= 0) {
      const nq = qty - coins;
      state.avg = nq < 0 ? (avg * (-qty) + px * coins) / (-nq) : 0;
      state.qty = nq;
      state.cash = cash + px * coins - fee;
    } else {
      const cover = Math.min(coins, qty);
      realized = (px - avg) * cover - fee * (cover / coins);
      const leftover = coins - cover;
      state.qty = qty - coins;
      state.cash = cash + px * coins - fee;
      state.avg = leftover > 0 ? px : (state.qty === 0 ? 0 : avg);
    }
  }
  fills.push({ side, px, coins, fee, realized });
  return realized;
}

function lotCoins(state, cap, px, side) {
  const maxNotional = cap * INVENTORY_CAP;
  const signed = state.qty * px;
  const nextDir = side === 'buy' ? 1 : -1;
  const projected = Math.abs(signed + nextDir * cap * QUOTE_FRAC);
  if (projected > maxNotional + 1e-9 && Math.abs(signed) >= maxNotional - 1e-9) return 0;
  let usd = cap * QUOTE_FRAC;
  const room = maxNotional - Math.abs(signed);
  if (nextDir * signed > 0 && room < usd) usd = Math.max(0, room);
  if (!(usd > 0) || !(px > 0)) return 0;
  return usd / px;
}

/**
 * Walk-forward paper capture on one name.
 * Gate = first half of `trades`. Fills = second half, last-in-queue vs GLFT.
 */
export function replayCapture({
  symbol = 'SYNTH',
  bid,
  ask,
  trades = [],
  makerFeePct = 0.0002,
  minEdgeBps = 0.5,
  capital = PAPER_CAPITAL,
} = {}) {
  const cap = Number.isFinite(+capital) && +capital > 0 ? +capital : PAPER_CAPITAL;
  const list = Array.isArray(trades) ? trades : [];
  const empty = (reason) => ({
    symbol,
    reason,
    quote: false,
    fills: [],
    roundTrips: 0,
    qty: 0,
    netPnl: 0,
    equity: cap,
    capital: cap,
    netBps: 0,
    liveOff: LIVE_OFF,
  });

  if (!LIVE_OFF) return empty('LIVE_BLOCK'); // belt: this file cannot arm live
  if (list.length < WARMUP * 2) return empty('SHORT_TAPE');

  const split = Math.max(WARMUP, Math.floor(list.length / 2));
  const gateTape = list.slice(0, split);
  const fillTape = list.slice(split);
  const scored = scoreTapeAndBook({
    symbol, bid, ask, trades: gateTape, makerFeePct, minEdgeBps,
  });
  if (!scored.quote) return empty(scored.reason);

  const schema = schemaOf(makerFeePct);
  const state = { cash: cap, qty: 0, avg: 0 };
  const fills = [];
  let realized = 0;
  let fair = scored.mid || (+bid + +ask) / 2;
  let lastPx = fair;
  const trail = gateTape.slice();

  // Quotes are posted on the PREVIOUS fair. The new print either hits them
  // (last in queue) or it does not. Chasing the print with a new fair would
  // make through-fills impossible.
  for (const t of fillTape) {
    const px = +t.price;
    if (!Number.isFinite(px) || px <= 0) continue;
    const vp = vpinFromTrades(trail);
    if (vp.vpin >= VPIN_HALT) {
      trail.push(t);
      lastPx = px;
      fair = px;
      continue;
    }

    const maxNotional = cap * INVENTORY_CAP;
    const q = maxNotional > 0
      ? Math.max(-1, Math.min(1, (state.qty * fair) / maxNotional))
      : 0;
    const quotes = glftQuotes({
      fair,
      sigma: sigmaFromTrades(trail),
      q,
      makerFee: makerFeePct,
      minEdgeBps,
    });
    // Do not test wouldCross vs the snapshot book: the book moved with the tape.
    // Gate already refused a crossing quote on the snapshot.
    if (quotes && quotes.ask > quotes.bid) {
      const side = t.side === 'buy' || t.side === 'sell' ? t.side : undefined;
      const hitBid = quotes.postBid && side !== 'buy' && px <= quotes.bid;
      const hitAsk = quotes.postAsk && side !== 'sell' && px >= quotes.ask;
      if (hitBid !== hitAsk) {
        const fillSide = hitBid ? 'buy' : 'sell';
        const fillPx = hitBid ? quotes.bid : quotes.ask;
        const coins = lotCoins(state, cap, fillPx, fillSide);
        if (coins > 0) {
          const fee = computeFee({ schema, isMaker: true, cost: coins * fillPx });
          realized += fillLot(state, fillSide, fillPx, coins, fee, fills);
        }
      }
    }
    trail.push(t);
    lastPx = px;
    fair = px;
  }

  const equity = state.cash + state.qty * lastPx;
  const netPnl = equity - cap;
  const roundTrips = fills.reduce((n, f) => n + (f.realized ? 1 : 0), 0);
  return {
    symbol,
    reason: fills.length ? 'CAPTURED' : 'NO_THROUGH_FILL',
    quote: true,
    fills,
    roundTrips,
    qty: state.qty,
    netPnl: +netPnl.toFixed(6),
    equity: +equity.toFixed(6),
    capital: cap,
    netBps: cap > 0 ? +((netPnl / cap) * 10000).toFixed(4) : 0,
    realized: +realized.toFixed(6),
    liveOff: LIVE_OFF,
    gate: { harvestBps: scored.harvestBps, vpin: scored.vpin, reason: scored.reason },
  };
}

/** Apply a session's net PnL onto an in-memory paper ledger. No files, no live. */
export function applyToPaperLedger(ledger, session) {
  const prev = ledger && typeof ledger === 'object' ? ledger : {};
  const bal0 = Number.isFinite(+prev.paperBalanceUSDT)
    ? +prev.paperBalanceUSDT
    : PAPER_CAPITAL;
  const pnl = session && Number.isFinite(+session.netPnl) ? +session.netPnl : 0;
  const fills = (prev.fills || 0) + ((session && session.fills && session.fills.length) || 0);
  return {
    paperBalanceUSDT: +(bal0 + pnl).toFixed(6),
    fills,
    lastSymbol: session?.symbol ?? prev.lastSymbol ?? null,
    lastPnl: pnl,
    lastReason: session?.reason ?? null,
    liveOff: LIVE_OFF,
  };
}

export function replayUniverse(rows, opts = {}) {
  const capital = opts.capital ?? PAPER_CAPITAL;
  let ledger = { paperBalanceUSDT: capital, fills: 0, liveOff: LIVE_OFF };
  const sessions = [];
  for (const r of rows || []) {
    const session = replayCapture({
      symbol: r.symbol,
      bid: r.bid,
      ask: r.ask,
      trades: r.tape || r.trades || [],
      makerFeePct: r.makerFeePct,
      minEdgeBps: opts.minEdgeBps,
      capital,
    });
    sessions.push(session);
    if (session.quote && session.netPnl) ledger = applyToPaperLedger(ledger, session);
    else if (session.fills?.length) ledger = applyToPaperLedger(ledger, session);
  }
  // always book sessions that captured (including 0 pnl with fills)
  return { ledger, sessions };
}
