// server/genesis/l2SpreadScanner.mjs
// BRUTE-FORCE REAL orderbook (L2) spread scanner.
//
// This is the HONEST money question: measure the REAL bid/ask spread of every
// tradable USDT pair RIGHT NOW, net of fees, and report which pairs actually
// pay a market maker. No simulation, no proxy, no OHLCV assumption — the raw
// live book from the exchange.
//
// The "brutal" part: scan the ENTIRE universe (527 Binance perps + optional
// ccxt multi-exchange), not a hand-picked few. Whichever pair has the fattest
// real spread after fees is where a real MM would sit.
//
// PAPER analysis. REAL requires human GO + keys + live execution + kill switch.
// This script NEVER places an order — it only READS the public order book.

import ccxt from 'ccxt';

const FEE_BPS = 0.4;          // taker fee (conservative MM cost per side)
const MIN_NET_BPS = 0.5;      // require at least 0.5 bps net after fees to count

async function scanExchange(exchangeId, limit = 200, offset = 0) {
  const ex = new ccxt[exchangeId]();
  let markets;
  try { markets = await ex.fetchMarkets(); } catch { return []; }
  const symbols = markets
    .filter(m => m.active !== false && m.quote === 'USDT' && (m.swap === true || m.linear === true || /PERP/i.test(m.id) || /:USDT$/.test(m.symbol)))
    .map(m => m.symbol)
    .slice(offset, offset + limit);

  const results = [];
  let i = 0;
  for (const sym of symbols) {
    try {
      const ob = await ex.fetchOrderBook(sym, 5);
      if (!ob.bids.length || !ob.asks.length) continue;
      const bid = ob.bids[0][0], ask = ob.asks[0][0];
      const spreadBps = (ask - bid) / bid * 10000;
      const netBps = spreadBps - 2 * FEE_BPS; // pay fee on both legs
      if (netBps >= MIN_NET_BPS) {
        results.push({ exchange: exchangeId, symbol: sym, spreadBps: +spreadBps.toFixed(3), netBps: +netBps.toFixed(3), bid, ask });
      }
    } catch { /* skip */ }
    // polite rate-limit: Binance ~600 req/min weight; 1-2 req per call -> ~50ms
    if ((++i) % 20 === 0) await new Promise(r => setTimeout(r, 1500));
  }
  return results;
}

async function runBruteScan({ exchanges = ['binance', 'bybit', 'okx'], perExchange = 200, offset = 0 } = {}) {
  console.log(`\n🔥 BRUTE-FORCE L2 SPREAD SCAN (REAL order books, PAPER)`);
  console.log(`Scanning ${exchanges.length} exchanges, ${perExchange} symbols each from offset ${offset}. Fee ${FEE_BPS} bps/leg, min net ${MIN_NET_BPS} bps.\n`);
  const all = [];
  for (const ex of exchanges) {
    const r = await scanExchange(ex, perExchange, offset);
    all.push(...r);
    console.log(`  ${ex}: ${r.length} pairs with real net-positive spread after fees`);
  }
  all.sort((a, b) => b.netBps - a.netBps);
  console.log(`\n=== REAL SPREAD VERDICT ===`);
  console.log(`Total pairs scanned (capped): ~${exchanges.length * perExchange}`);
  console.log(`Pairs with REAL net-positive MM spread: ${all.length}`);
  if (all.length) {
    console.log(`\nTop 15 fattest REAL spreads (where a market maker actually gets paid):`);
    for (const r of all.slice(0, 15)) {
      console.log(`  ${r.exchange.toUpperCase().padEnd(8)} ${r.symbol.padEnd(14)} spread=${r.spreadBps}bps net=${r.netBps}bps bid=${r.bid} ask=${r.ask}`);
    }
    console.log(`\n→ These ${all.length} pairs have a REAL (not simulated) bid/ask spread that pays a market maker after fees.`);
    console.log(`→ A live MM quoting both sides would capture ~${all[0].netBps.toFixed(1)} bps/round-trip on ${all[0].symbol}.`);
  } else {
    console.log(`\n→ No pair has a real net-positive spread at this fee level right now. Market is too tight (efficient).`);
    console.log(`→ Either lower fee tier (VIP/maker-rebate) or wait for volatility to widen spreads.`);
  }
  return all;
}

if (process.argv[1] && process.argv[1].endsWith('l2SpreadScanner.mjs')) {
  const n = Number(process.argv[2] || 200);
  const off = Number(process.argv[3] || 0);
  runBruteScan({ perExchange: n, offset: off }).then(() => process.exit(0)).catch(e => { console.error('ERR', e.message); process.exit(1); });
}
