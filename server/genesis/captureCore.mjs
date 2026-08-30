// server/genesis/captureCore.mjs
// Pure score: book + tape → harvest / VPIN / GLFT. No I/O. No ccxt. No orders.
// captureDesk.mjs re-exports these and owns the CLI scanner (ccxt).
// The Vercel Capture API imports THIS file so Hobby functions never bundle ccxt.

import { glftQuotes } from './math/glft.mjs';
import { harvestScore, rankHarvest, DEFAULT_MIN_EDGE_BPS } from './math/harvest.mjs';
import {
  vpinFromTrades,
  kyleLambda,
  markoutAsBps,
  sigmaFromTrades,
} from './math/toxicity.mjs';

export const LIVE_OFF = true; // desk never arms live. human + 6 gates elsewhere.

export function bookSpreadBps(bid, ask) {
  const b = +bid;
  const a = +ask;
  if (!(b > 0) || !(a > b)) return null;
  return ((a - b) / ((a + b) / 2)) * 10000;
}

/** True if GLFT quotes would take (cross) the live book. Maker-only desk refuses. */
export function wouldCross(quotes, bid, ask) {
  if (!quotes) return true;
  if (quotes.postBid && quotes.bid >= ask) return true;
  if (quotes.postAsk && quotes.ask <= bid) return true;
  return false;
}

/**
 * Score one name from a live (or synthetic) book + trade tape.
 * Pure given inputs. No I/O. No orders.
 */
export function scoreTapeAndBook({
  symbol = 'SYNTH',
  bid,
  ask,
  trades = [],
  makerFeePct = 0.0002,
  minEdgeBps = DEFAULT_MIN_EDGE_BPS,
  q = 0,
} = {}) {
  const spreadBps = bookSpreadBps(bid, ask);
  if (spreadBps == null) {
    return {
      symbol,
      bid: +bid || 0,
      ask: +ask || 0,
      spreadBps: 0,
      vpin: 0,
      asBps: 0,
      harvestBps: Number.NEGATIVE_INFINITY,
      quote: false,
      reason: 'DEAD_BOOK',
      makerFeePct,
      liveOff: LIVE_OFF,
    };
  }
  const mid = (+bid + +ask) / 2;
  const { vpin, buckets } = vpinFromTrades(trades);
  const { asBps: markout } = markoutAsBps(trades, 5);
  const { lambda } = kyleLambda(trades);
  const typical = typicalFill(trades);
  const kyleAs = Math.max(0, lambda * typical * 10000);
  const asBps = Math.max(markout, kyleAs);
  const sigma = sigmaFromTrades(trades);
  const quotes = glftQuotes({
    fair: mid,
    sigma,
    q,
    makerFee: makerFeePct,
    minEdgeBps,
  });
  const h = harvestScore({
    spreadBps,
    makerFeePct,
    asBps,
    vpin,
    minEdgeBps,
  });
  let quote = h.quote;
  let reason = h.reason;
  if (wouldCross(quotes, +bid, +ask)) {
    quote = false;
    reason = 'WOULD_CROSS';
  }
  return {
    symbol,
    bid: +bid,
    ask: +ask,
    mid,
    spreadBps: +spreadBps.toFixed(4),
    makerFeePct,
    feeBps: h.feeBps,
    vpin: +vpin.toFixed(4),
    vpinBuckets: buckets,
    asBps: +asBps.toFixed(4),
    sigma,
    harvestBps: Number.isFinite(h.harvestBps) ? +h.harvestBps.toFixed(4) : h.harvestBps,
    quote,
    reason,
    widen: h.widen,
    glft: quotes
      ? {
          bid: quotes.bid,
          ask: quotes.ask,
          spreadBps: quotes.spreadBps,
          postBid: quotes.postBid,
          postAsk: quotes.postAsk,
        }
      : null,
    liveOff: LIVE_OFF,
  };
}

function typicalFill(trades) {
  const amts = (Array.isArray(trades) ? trades : [])
    .map((t) => Math.max(0, +t.amount || 0))
    .filter((x) => x > 0);
  if (!amts.length) return 0;
  amts.sort((a, b) => a - b);
  return amts[Math.floor(amts.length / 2)];
}

export function rankQuoteable(rows) {
  return rankHarvest((rows || []).filter((r) => r && r.quote));
}

