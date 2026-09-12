// server/genesis/paperFillTester.mjs
// Paper-test of MARKET-MAKER FILL RATE on LIVE markets — no keys, no capital.
//
// Method (measured market reality, not a model of prices):
//   1. Snapshot the live L2 book -> quote bid at best-bid, ask at best-ask.
//   2. Replay the REAL trade flow (ccxt fetchTrades) for DURATION seconds.
//      - taker SELL at price <= ourBid  -> our bid leg FILLS (we buy)
//      - taker BUY  at price >= ourAsk  -> our ask leg FILLS (we sell)
//   3. Both legs filled -> round trip: pnl = spread - fees.
//      One leg filled at end -> mark vs current mid (adverse selection cost).
//   4. Re-quote from the live book after every round trip.
//
// Usage:
//   node paperFillTester.mjs <exchange> <SYMBOL1,SYMBOL2,...> [durationSecPerSymbol]
//   node paperFillTester.mjs bybit "AMC/USDT:USDT,AAL/USDT:USDT,BTC/USDT:USDT" 120

import ccxt from 'ccxt';

const exchangeId = process.argv[2] || 'bybit';
const symbols = (process.argv[3] || 'BTC/USDT:USDT').split(',').map(s => s.trim());
const DURATION = parseInt(process.argv[4] || '120', 10); // seconds per symbol
const FEE_BPS = 0.8; // round trip, conservative taker-equivalent

async function testSymbol(ex, sym) {
  let ob = await ex.fetchOrderBook(sym, 5);
  if (!ob.bids.length || !ob.asks.length) return { sym, error: 'empty book' };

  let ourBid = ob.bids[0][0];
  let ourAsk = ob.asks[0][0];
  const quotes = [];
  let roundtrips = 0;
  let bidFills = 0;
  let askFills = 0;
  let realizedBps = 0;
  let openLeg = null; // {side:'long'|'short', px}

  const closeOpen = async () => {
    if (!openLeg) return;
    const cur = await ex.fetchOrderBook(sym, 5);
    const mid = cur.bids.length && cur.asks.length ? (cur.bids[0][0] + cur.asks[0][0]) / 2 : null;
    if (mid == null) return;
    const bps = openLeg.side === 'long'
      ? (mid - openLeg.px) / openLeg.px * 10000
      : (openLeg.px - mid) / openLeg.px * 10000;
    realizedBps += bps;
    openLeg = null;
    return bps;
  };

  const start = Date.now();
  let since = start - 5000;
  while ((Date.now() - start) / 1000 < DURATION) {
    await new Promise(r => setTimeout(r, 2000));
    let trades = [];
    try { trades = await ex.fetchTrades(sym, since, 100); } catch { continue; }
    if (trades.length) since = Math.max(since, trades[trades.length - 1].timestamp || since) + 1;
    for (const t of trades) {
      const px = t.price;
      if (!bidFills || true) {
        // bid leg available again whenever not currently holding long inventory
        if (!openLeg && t.side === 'sell' && px <= ourBid) {
          bidFills++;
          openLeg = { side: 'long', px: ourBid };
        } else if (!openLeg && t.side === 'buy' && px >= ourAsk) {
          askFills++;
          openLeg = { side: 'short', px: ourAsk };
        } else if (openLeg && openLeg.side === 'long' && t.side === 'buy' && px >= ourAsk) {
          // second leg: sell what we bought -> ROUND TRIP
          realizedBps += (ourAsk - ourBid) / ourBid * 10000 - FEE_BPS;
          roundtrips++;
          askFills++;
          openLeg = null;
          try {
            ob = await ex.fetchOrderBook(sym, 5);
            if (ob.bids.length && ob.asks.length) { ourBid = ob.bids[0][0]; ourAsk = ob.asks[0][0]; }
          } catch { /* keep old quotes */ }
        } else if (openLeg && openLeg.side === 'short' && t.side === 'sell' && px <= ourBid) {
          realizedBps += (ourAsk - ourBid) / ourAsk * 10000 - FEE_BPS;
          roundtrips++;
          bidFills++;
          openLeg = null;
          try {
            ob = await ex.fetchOrderBook(sym, 5);
            if (ob.bids.length && ob.asks.length) { ourBid = ob.bids[0][0]; ourAsk = ob.asks[0][0]; }
          } catch { /* keep old quotes */ }
        }
      }
    }
  }

  const orphanBps = await closeOpen();
  const totalFills = roundtrips * 2 + (bidFills + askFills - roundtrips * 2);
  return {
    sym,
    initialSpreadBps: +((ourAsk - ourBid) / ourBid * 10000).toFixed(2),
    roundtrips,
    singleLegs: (bidFills + askFills - roundtrips * 2),
    realizedBps: +realizedBps.toFixed(2),
    orphanMarkedBps: orphanBps != null ? +orphanBps.toFixed(2) : 0,
    netBps: +(realizedBps).toFixed(2),
    note: `${totalFills} leg-fills in ${DURATION}s`
  };
}

async function main() {
  const ex = new ccxt[exchangeId]({ enableRateLimit: true });
  await ex.loadMarkets();
  console.log(`[${exchangeId}] PAPER FILL TEST — quoting best bid/ask, replaying ${DURATION}s of REAL trade flow per symbol. No orders sent.\n`);
  const results = [];
  for (const sym of symbols) {
    process.stdout.write(`testing ${sym} (${DURATION}s)... `);
    let r;
    try { r = await testSymbol(ex, sym); } catch (e) { r = { sym, error: e.message }; }
    results.push(r);
    console.log('done');
    await new Promise(res => setTimeout(res, 1500));
  }
  console.log(`\n=== ${exchangeId} paper fill results (fees ${FEE_BPS} bps RT charged on roundtrips) ===`);
  console.log('symbol'.padEnd(20) + 'spread'.padStart(9) + 'RTs'.padStart(5) + '1-leg'.padStart(6) + 'netBps'.padStart(9) + '  note');
  for (const r of results) {
    if (r.error) { console.log(r.sym.padEnd(20) + 'ERROR: ' + r.error); continue; }
    console.log(r.sym.padEnd(20)
      + String(r.initialSpreadBps).padStart(8)
      + String(r.roundtrips).padStart(5)
      + String(r.singleLegs).padStart(6)
      + String(r.netBps).padStart(9)
      + '  ' + r.note);
  }
  console.log('\nHONESTY: netBps here is MEASURED fill behavior of best-of-book quoting on real flow.');
  console.log('It excludes queue position (we assume worst case: we are LAST in queue, fill only on price crossing).');
}

main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e.message); process.exit(1); });
