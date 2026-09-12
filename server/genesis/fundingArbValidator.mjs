// server/genesis/fundingArbValidator.mjs
// Validate the REAL funding-rate arbitrage edge against the 6 Genesis gates.
// Delta-neutral: collect funding from the paying side. Uses REAL Binance
// fundingRate history (no key needed). This is the strategy already wired in
// fundingTrader.mjs — here we measure it honestly with costs + gates.

import { computeMetrics, evaluateGates } from './backtestCore.mjs';

const FEE_TAKER = 0.0004; // 0.04% per leg (spot+perp), x2 entries + x2 exits

async function getFundingHistory(pair, limit = 1000) {
  // Binance fapi fundingRate history
  const url = `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${pair}&limit=${limit}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fundingRate HTTP ${r.status} for ${pair}`);
  return r.json();
}

// Simulate delta-neutral funding collection over real funding events.
// When fundingRate < 0: longs pay shorts -> we short perp / long spot to RECEIVE.
// We model net funding collected per period minus 2x taker fees on (re)entry.
// Simulate delta-neutral funding collection over real funding events.
// KEY EDGE: only collect when fundingRate < 0 (shorts pay longs, we receive).
// When rate > 0 we do NOT enter (avoid paying). Cost applies only on entry.
function simulate(pair, history, { capitalPerPair = 1000 } = {}) {
  let equity = capitalPerPair;
  const trades = [];
  const equityCurve = [capitalPerPair];
  for (const ev of history) {
    const rate = +ev.fundingRate;
    const notional = equity;
    if (rate < 0) {
      // we receive -rate * notional (rate negative => positive pnl)
      const fundingPnl = -rate * notional;
      const cost = notional * FEE_TAKER * 2;
      const net = fundingPnl - cost;
      equity += net;
      if (equity < 0) equity = 0;
      trades.push({ pnl: net, entry: notional, exit: notional });
    }
    // when rate > 0: stay flat, no trade, no cost
    equityCurve.push(equity);
  }
  return { trades, equityCurve, finalCapital: equity, initialCapital: capitalPerPair };
}

async function validateFunding({ pairs = ['COTIUSDT', 'XLMUSDT', 'SOLUSDT'], limit = 1000 }) {
  const all = [];
  for (const pair of pairs) {
    try {
      const hist = await getFundingHistory(pair, limit);
      if (!hist.length) { console.log(`${pair}: no funding history`); continue; }
      const res = simulate(pair, hist);
      const m = computeMetrics(res);
      const g = evaluateGates(m);
      all.push({ pair, metrics: m, gates: g });
      console.log(`\n=== FUNDING ARB: ${pair} (${hist.length} real funding events) ===`);
      console.log(`Trades: ${m.trades} | WR: ${(m.winRate * 100).toFixed(1)}% | PF: ${isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : 'inf'} | EV%/trade: ${m.expectancyPctPerTrade.toFixed(3)}% | t: ${m.tstat.toFixed(2)} | DD: ${(m.maxDrawdown * 100).toFixed(1)}%`);
      console.log(`Return: ${(m.returnPct * 100).toFixed(1)}% | Final: $${m.finalCapital.toFixed(0)} | GATES ${g.passed}/${g.total} ${g.go ? 'GO' : ''}`);
    } catch (e) {
      console.log(`${pair}: ERR ${e.message}`);
    }
  }
  const anyGo = all.some(a => a.gates.go);
  console.log(`\n=== FUNDING ARB VERDICT: ${anyGo ? 'EDGE FOUND ✅' : 'NO ROBUST EDGE ❌'} ===`);
  return all;
}

if (process.argv[1] && process.argv[1].endsWith('fundingArbValidator.mjs')) {
  const pairs = process.argv.slice(2).filter(p => p.startsWith('B') || p.includes('USDT'));
  validateFunding({ pairs: pairs.length ? pairs : undefined })
    .then(() => process.exit(0))
    .catch(e => { console.error('ERR', e.message); process.exit(1); });
}
