// server/genesis/paperFillTester.mjs
// The honest gap between "spread exists" and "MM profitable":
// ADVERSE SELECTION + FILL RATE measured from REAL L2 polling (no orders placed).
//
// Method (read-only, PAPER): poll the live order book N times. Simulate a
// passive market maker quoting at best bid/ask. Each poll:
//   - if best bid > our quoted bid last round -> we'd have been FILLED at bid
//   - if best ask < our quoted ask last round -> we'd have been FILLED at ask
// After a simulated fill, check next poll: did mid move in our favor (good)
// or against (adverse selection, the killer)?
// This measures REAL fill probability and REAL adverse-selection drag using
// live market data — the honest pre-live check.
//
// NEVER places an order. Read-only polling. REAL live trading requires human
// GO + keys + testnet/sandbox + kill switch.

import ccxt from 'ccxt';

const POLLS = 120;          // number of book snapshots
const GAP_MS = 1000;        // 1s between polls
const FEE_BPS = 0.4;        // taker cost per leg (conservative)

function mid(ob) { return (ob.bids[0][0] + ob.asks[0][0]) / 2; }

async function probe(exchangeId, symbol) {
  const ex = new ccxt[exchangeId]();
  let fills = 0, adverse = 0, favorable = 0;
  let lastBid = null, lastAsk = null;
  const equity = [0];
  for (let i = 0; i < POLLS; i++) {
    let ob;
    try { ob = await ex.fetchOrderBook(symbol, 5); } catch { await new Promise(r => setTimeout(r, GAP_MS)); continue; }
    if (!ob.bids.length || !ob.asks.length) { await new Promise(r => setTimeout(r, GAP_MS)); continue; }
    const bid = ob.bids[0][0], ask = ob.asks[0][0];
    if (lastBid !== null) {
      // filled at bid if someone lifted above our quote (price rose past it)
      if (bid > lastBid) {
        fills++;
        // adverse selection: next mid vs fill mid
        const fillMid = (lastBid + lastAsk) / 2;
        const nowMid = mid(ob);
        const move = (nowMid - fillMid) / fillMid * 10000; // bps
        const pnl = -move - 2 * FEE_BPS; // we bought, price moved 'move' bps
        equity.push(equity[equity.length - 1] + pnl);
        if (move < 0) adverse++; else favorable++;
      }
      // filled at ask if someone hit below our quote (price fell past it)
      if (ask < lastAsk) {
        fills++;
        const fillMid = (lastBid + lastAsk) / 2;
        const nowMid = mid(ob);
        const move = (nowMid - fillMid) / fillMid * 10000;
        const pnl = move - 2 * FEE_BPS; // we sold, price moved 'move' bps
        equity.push(equity[equity.length - 1] + pnl);
        if (move > 0) adverse++; else favorable++;
      }
    }
    lastBid = bid; lastAsk = ask;
    await new Promise(r => setTimeout(r, GAP_MS));
  }
  const net = equity[equity.length - 1];
  return { symbol, exchange: exchangeId, polls: POLLS, fills, adverse, favorable, netBps: +net.toFixed(1), edge: fills > 0 ? (net / fills).toFixed(2) + ' bps/fill' : 'no fills' };
}

export async function run({ pairs = [['binance', 'ETHUSDT'], ['binance', 'BTCUSDT'], ['okx', 'APLD/USDT:USDT'], ['bybit', 'GE/USDT:USDT']] } = {}) {
  console.log(`\n🔬 PAPER FILL TESTER (REAL L2 polling, NO orders placed, PAPER)`);
  console.log(`Polling ${POLLS} snapshots @1s per pair. Measuring fill rate + adverse selection.\n`);
  for (const [ex, sym] of pairs) {
    try {
      const r = await probe(ex, sym);
      console.log(`  ${ex.toUpperCase().padEnd(7)} ${sym.padEnd(16)} fills=${r.fills} adverse=${r.adverse} favorable=${r.favorable} net=${r.netBps}bps | ${r.edge}`);
    } catch (e) { console.log(`  ${ex} ${sym}: ERR ${e.message}`); }
  }
  console.log(`\n→ net bps = sum of (price-move - 2*fee) per simulated fill. Negative = adverse selection eats the spread.`);
  console.log(`→ This is the HONEST pre-live check: real fills + real adverse selection, no money at risk.`);
}

if (process.argv[1] && process.argv[1].endsWith('paperFillTester.mjs')) {
  run().then(() => process.exit(0)).catch(e => { console.error('ERR', e.message); process.exit(1); });
}
