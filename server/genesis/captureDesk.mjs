// server/genesis/captureDesk.mjs
// Capture Desk — CLI scanner (ccxt) + re-exports of the pure score.
// Does NOT send orders. Does NOT flip REAL_TRADING. Does NOT mint a 6-gate GO.
//
// CLI:
//   node captureDesk.mjs <exchange> [limit] [offset] [minEdgeBps]
//   node captureDesk.mjs okx 40 0 0.5

import { loadFeeSchema } from './feeAccountant.mjs';
import { rankHarvest, DEFAULT_MIN_EDGE_BPS } from './math/harvest.mjs';
import {
  LIVE_OFF,
  bookSpreadBps,
  wouldCross,
  scoreTapeAndBook,
  rankQuoteable,
} from './captureCore.mjs';

export {
  LIVE_OFF,
  bookSpreadBps,
  wouldCross,
  scoreTapeAndBook,
  rankQuoteable,
};

export async function scanExchange({
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
      row.tape = trades;
      rows.push(row);
    } catch { /* skip dead pairs */ }
    scanned++;
    if (scanned % 10 === 0) await new Promise((r) => setTimeout(r, 1200));
  }
  return rows;
}

function printReport(exchangeId, rows, minEdgeBps, book = null) {
  const ok = rankQuoteable(rows);
  const halted = rows.filter((r) => r.reason === 'VPIN_HALT').length;
  const dead = rows.filter((r) => r.reason === 'H_LE_EDGE' || r.reason === 'WOULD_CROSS').length;
  console.log(`\n=== captureDesk ${exchangeId}: ${ok.length}/${rows.length} quoteable after maker fee + VPIN + AS (minEdge ${minEdgeBps} bps) ===`);
  console.log(`refused: VPIN_HALT=${halted}  H_or_cross=${dead}. liveOff=${LIVE_OFF}. this is not a GO.`);
  const show = ok.length ? ok : rankHarvest(rows).slice(0, 15);
  for (const r of show.slice(0, 25)) {
    const h = Number.isFinite(r.harvestBps) ? r.harvestBps.toFixed(2) : String(r.harvestBps);
    const pnl = Number.isFinite(r.netPnl) ? r.netPnl.toFixed(4) : '';
    console.log(
      `${String(r.symbol).padEnd(22)} H=${h.padStart(8)}  spread=${String(r.spreadBps).padStart(7)}  fee=${r.feeBps.toFixed(2)}  AS=${r.asBps.toFixed(2)}  VPIN=${r.vpin.toFixed(2)}  ${r.quote ? 'QUOTE' : r.reason}  pnl=${pnl}`,
    );
  }
  if (!ok.length) {
    console.log('no name cleared harvest. desk stands down. do not invent a fill.');
  }
  if (book && book.ledger) {
    const L = book.ledger;
    const captured = (book.sessions || []).filter((s) => s.fills && s.fills.length).length;
    console.log(`\npaper book: ${L.paperBalanceUSDT} USDT  (start 10000)  sessions_with_fills=${captured}  liveOff=${L.liveOff}`);
  }
}

async function main() {
  const exchangeId = process.argv[2] || 'okx';
  const limit = parseInt(process.argv[3] || '40', 10);
  const offset = parseInt(process.argv[4] || '0', 10);
  const minEdgeBps = parseFloat(process.argv[5] || String(DEFAULT_MIN_EDGE_BPS));
  const rows = await scanExchange({ exchangeId, limit, offset, minEdgeBps });
  const { replayUniverse } = await import('./captureEngine.mjs');
  const book = replayUniverse(rows, { minEdgeBps });
  const bySym = new Map((book.sessions || []).map((s) => [s.symbol, s]));
  for (const r of rows) {
    const s = bySym.get(r.symbol);
    if (s) {
      r.netPnl = s.netPnl;
      r.captureReason = s.reason;
      r.fillCount = s.fills.length;
    }
  }
  printReport(exchangeId, rows, minEdgeBps, book);
  return { rows, book };
}

const isCli = process.argv[1] && /captureDesk\.mjs$/.test(String(process.argv[1]).replace(/\\/g, '/'));
if (isCli) {
  main().then(() => process.exit(0)).catch((e) => {
    console.error('FATAL', e.message);
    process.exit(1);
  });
}

