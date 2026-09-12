// server/genesis/l2SpreadScanner.mjs
// REAL (not simulated) L2 orderbook spread scan via ccxt.
// Reads the LIVE bid/ask of many pairs; edge exists wherever spread - 2*fee > 0.
// This reports MARKET REALITY (measured spreads), not profit.
//
// Usage:
//   node l2SpreadScanner.mjs <exchange> <limit> <offset> [minNetBps]
//   node l2SpreadScanner.mjs okx 150 0
//   node l2SpreadScanner.mjs bybit 250 150
//
// Foreground batches only on Windows/Hermes (stdin-tty bug kills background).

import ccxt from 'ccxt';

const exchangeId = process.argv[2] || 'okx';
const limit = parseInt(process.argv[3] || '150', 10);
const offset = parseInt(process.argv[4] || '0', 10);
const MIN_NET_BPS = parseFloat(process.argv[5] || '0.5');
const FEE_BPS = 0.4; // taker per leg, conservative

async function main() {
  const ex = new ccxt[exchangeId]({ enableRateLimit: true });
  await ex.loadMarkets();
  const symbols = Object.values(ex.markets)
    .filter(m => m.active !== false && m.quote === 'USDT'
      && (m.swap === true || m.linear === true || /PERP/i.test(m.id)))
    .map(m => m.symbol)
    .sort()
    .slice(offset, offset + limit);

  console.log(`[${exchangeId}] scanning ${symbols.length} USDT perps (offset ${offset}, min net ${MIN_NET_BPS} bps)`);
  const out = [];
  let scanned = 0;
  for (const sym of symbols) {
    try {
      const ob = await ex.fetchOrderBook(sym, 5);
      if (!ob.bids.length || !ob.asks.length) continue;
      const bid = ob.bids[0][0], ask = ob.asks[0][0];
      const spreadBps = (ask - bid) / bid * 10000;
      const netBps = spreadBps - 2 * FEE_BPS;
      if (netBps >= MIN_NET_BPS) {
        out.push({ symbol: sym, bid, ask, spreadBps: +spreadBps.toFixed(2), netBps: +netBps.toFixed(2) });
      }
    } catch { /* skip dead pairs */ }
    scanned++;
    if (scanned % 20 === 0) await new Promise(r => setTimeout(r, 1200));
  }
  out.sort((a, b) => b.netBps - a.netBps);
  console.log(`\n=== ${exchangeId}: ${out.length}/${symbols.length} pairs with NET-positive live spread (after 0.8 bps round-trip fees) ===`);
  for (const r of out.slice(0, 30)) {
    console.log(`${r.symbol.padEnd(22)} spread=${String(r.spreadBps).padStart(8)} bps  net=${String(r.netBps).padStart(8)} bps  bid=${r.bid} ask=${r.ask}`);
  }
  return out;
}

main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e.message); process.exit(1); });
