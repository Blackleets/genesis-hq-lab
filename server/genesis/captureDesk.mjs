// server/genesis/captureDesk.mjs
// Capture Desk — maker harvest scanner. PAPER ONLY.
//
// Does NOT send orders. Does NOT flip REAL_TRADING. Does NOT mint a 6-gate GO.
// Uses live L2 + tape (ccxt, public) only as INPUTS to a score:
//   harvest H = spread * P(two-sided) − 2·makerFee − E[adverse] − inventory
//   VPIN halt / widen from math/toxicity.mjs
//   quotes from GLFT (math/glft.mjs); refuse if the quote would cross the book
//
// CLI (foreground only, same pattern as l2SpreadScanner):
//   node captureDesk.mjs <exchange> [limit] [offset] [minEdgeBps]
//   node captureDesk.mjs okx 40 0 0.5
//
// The old L2 scanner charges 0.4 bps TAKER/leg. This desk uses the real
// maker fee from feeAccountant.loadFeeSchema. Naive touch-quoting already
// lost vs real flow (paperFillTester); this tool's job is to refuse those names.

import { loadFeeSchema } from './feeAccountant.mjs';
import { glftQuotes } from './math/glft.mjs';
import { harvestScore, rankHarvest, DEFAULT_MIN_EDGE_BPS } from './math/harvest.mjs';
import {
  vpinFromTrades,
  kyleLambda,
  markoutAsBps,
  sigmaFromTrades,
} from './math/toxicity.mjs';

const LIVE_OFF = true; // desk never arms live. human + 6 gates elsewhere.

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

async function scanExchange({
  exchangeId = 'okx',
  limit = 40,
  offset = 0,
  minEdgeBps = DEFAULT_MIN_EDGE_BPS,
} = {}) {
  const ccxt = (await import('ccxt')).default;
  if (!ccxt[exchangeId]) throw new Error(`unknown exchange ${exchangeId}`);
  const ex = new ccxt[exchangeId]({ enableRateLimit: true });
  await ex.loadMarkets();
  const symbols = Object.values(ex.markets)
    .filter((m) => m.active !== false && m.quote === 'USDT'
      && (m.swap === true || m.linear === true || /PERP/i.test(m.id)))
    .map((m) => m.symbol)
    .sort()
    .slice(offset, offset + limit);

  console.log(`[captureDesk ${exchangeId}] ${symbols.length} USDT perps (offset ${offset}, minEdge ${minEdgeBps} bps). PAPER. no orders.`);
  const rows = [];
  let scanned = 0;
  for (const sym of symbols) {
    try {
      const ob = await ex.fetchOrderBook(sym, 5);
      if (!ob.bids?.length || !ob.asks?.length) continue;
      const bid = ob.bids[0][0];
      const ask = ob.asks[0][0];
      let trades = [];
      try {
        const raw = await ex.fetchTrades(sym, undefined, 80);
        trades = (raw || []).map((t) => ({
          price: +t.price,
          amount: +t.amount,
          side: t.side === 'buy' || t.side === 'sell' ? t.side : undefined,
        }));
      } catch { /* tape optional; VPIN stays 0 */ }
      const schema = loadFeeSchema(ex, sym);
      const row = scoreTapeAndBook({
        symbol: sym,
        bid,
        ask,
        trades,
        makerFeePct: schema.makerPercent,
        minEdgeBps,
      });
      rows.push(row);
    } catch { /* skip dead pairs */ }
    scanned++;
    if (scanned % 10 === 0) await new Promise((r) => setTimeout(r, 1200));
  }
  return rows;
}

function printReport(exchangeId, rows, minEdgeBps) {
  const ok = rankQuoteable(rows);
  const halted = rows.filter((r) => r.reason === 'VPIN_HALT').length;
  const dead = rows.filter((r) => r.reason === 'H_LE_EDGE' || r.reason === 'WOULD_CROSS').length;
  console.log(`\n=== captureDesk ${exchangeId}: ${ok.length}/${rows.length} quoteable after maker fee + VPIN + AS (minEdge ${minEdgeBps} bps) ===`);
  console.log(`refused: VPIN_HALT=${halted}  H_or_cross=${dead}. liveOff=${LIVE_OFF}. this is not a GO.`);
  const show = ok.length ? ok : rankHarvest(rows).slice(0, 15);
  for (const r of show.slice(0, 25)) {
    const h = Number.isFinite(r.harvestBps) ? r.harvestBps.toFixed(2) : String(r.harvestBps);
    console.log(
      `${String(r.symbol).padEnd(22)} H=${h.padStart(8)}  spread=${String(r.spreadBps).padStart(7)}  fee=${r.feeBps.toFixed(2)}  AS=${r.asBps.toFixed(2)}  VPIN=${r.vpin.toFixed(2)}  ${r.quote ? 'QUOTE' : r.reason}`,
    );
  }
  if (!ok.length) {
    console.log('no name cleared harvest. desk stands down. do not invent a fill.');
  }
}

async function main() {
  const exchangeId = process.argv[2] || 'okx';
  const limit = parseInt(process.argv[3] || '40', 10);
  const offset = parseInt(process.argv[4] || '0', 10);
  const minEdgeBps = parseFloat(process.argv[5] || String(DEFAULT_MIN_EDGE_BPS));
  const rows = await scanExchange({ exchangeId, limit, offset, minEdgeBps });
  printReport(exchangeId, rows, minEdgeBps);
  return rows;
}

const isCli = process.argv[1] && /captureDesk\.mjs$/.test(String(process.argv[1]).replace(/\\/g, '/'));
if (isCli) {
  main().then(() => process.exit(0)).catch((e) => {
    console.error('FATAL', e.message);
    process.exit(1);
  });
}

export { scanExchange, LIVE_OFF };
