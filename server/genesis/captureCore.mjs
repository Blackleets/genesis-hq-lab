// server/genesis/captureCore.mjs
// Pure score: book + tape → harvest / VPIN / GLFT. No I/O. No ccxt. No orders.
// captureDesk.mjs re-exports these and owns the CLI scanner (ccxt).
// The Vercel Capture API imports THIS file so Hobby functions never bundle ccxt.
// Fair = Kalman(microprice or mid) + alpha * imbalance — same math as marketMaker.

import { glftQuotes } from './math/glft.mjs';
import { harvestScore, rankHarvest, DEFAULT_MIN_EDGE_BPS } from './math/harvest.mjs';
import {
  vpinFromTrades,
  kyleLambda,
  markoutAsBps,
  sigmaFromTrades,
} from './math/toxicity.mjs';
import { createKalman, fairValue } from './math/kalman.mjs';
import { microprice, bookImbalance } from './math/ofi.mjs';
import { isDenied } from './captureDeny.mjs';

export const LIVE_OFF = true; // desk never arms live. human + 6 gates elsewhere.

const FV_ALPHA = 0.0005; // same as marketMaker.mjs

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

function observationZ(bid, ask, bidSz, askSz) {
  const mid = (+bid + +ask) / 2;
  const bs = +bidSz;
  const asz = +askSz;
  if (bs > 0 && asz > 0) {
    const z = microprice({ bid, ask, bidSz: bs, askSz: asz });
    const imb = bookImbalance({ bidSz: bs, askSz: asz });
    return {
      z: Number.isFinite(z) ? z : mid,
      imb: Number.isFinite(imb) ? imb : 0,
    };
  }
  return { z: mid, imb: 0 };
}

/**
 * Score one name from a live (or synthetic) book + trade tape.
 * Pure given inputs. No I/O. No orders.
 * Optional bidSz/askSz: when both > 0, fair is Kalman(microprice)+OFI.
 * Missing sizes → mid, imbalance 0. Harvest stays on the live book spread.
 */
export function scoreTapeAndBook({
  symbol = 'SYNTH',
  bid,
  ask,
  bidSz,
  askSz,
  trades = [],
  makerFeePct = 0.0002,
  minEdgeBps = DEFAULT_MIN_EDGE_BPS,
  q = 0,
  denyMap = null,
  now = Date.now(),
} = {}) {
  if (denyMap && isDenied(denyMap, symbol, now)) {
    return {
      symbol,
      bid: +bid || 0,
      ask: +ask || 0,
      spreadBps: 0,
      vpin: 0,
      asBps: 0,
      harvestBps: Number.NEGATIVE_INFINITY,
      quote: false,
      reason: 'DENY_NEG_PNL',
      makerFeePct,
      feeBps: 0,
      netPnl: 0,
      fills: [],
      liveOff: LIVE_OFF,
    };
  }
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
  const { z, imb } = observationZ(bid, ask, bidSz, askSz);
  const kalman = createKalman({ q: 1e-6, r: 1e-4 });
  const fv = fairValue(kalman, z, imb, FV_ALPHA);
  const { vpin, buckets } = vpinFromTrades(trades);
  const { asBps: markout } = markoutAsBps(trades, 5);
  const { lambda } = kyleLambda(trades);
  const typical = typicalFill(trades);
  const kyleAs = Math.max(0, lambda * typical * 10000);
  const asBps = Math.max(markout, kyleAs);
  const sigma = sigmaFromTrades(trades);
  const quotes = glftQuotes({
    fair: fv,
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
  const out = {
    symbol,
    bid: +bid,
    ask: +ask,
    mid,
    fair: fv,
    microprice: z,
    imbalance: imb,
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
  if (+bidSz > 0) out.bidSz = +bidSz;
  if (+askSz > 0) out.askSz = +askSz;
  return out;
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
