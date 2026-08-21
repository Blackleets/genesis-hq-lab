// server/genesis/fundingScanner.mjs
// Scan MANY real pairs' funding-rate history to find where delta-neutral
// funding collection is PROFITABLE after fees. This is the data-driven edge
// hunt: not "assume funding works", but "measure where it actually pays".
//
// Edge rule: collect when rate<0. Net per event = -rate*notional - 2*FEE*notional.
// Profitable when avg(-rate) over negative-rate events > 2*FEE.

import { computeMetrics, evaluateGates } from './backtestCore.mjs';

const FEE_TAKER = 0.0004;
const CANDIDATES = ['COTIUSDT','XLMUSDT','SOLUSDT','BNBUSDT','ETHUSDT','BTCUSDT','ADAUSDT','AVAXUSDT','DOGEUSDT','LINKUSDT','MATICUSDT','DOTUSDT','TRXUSDT','NEARUSDT','ATOMUSDT','LTCUSDT','BCHUSDT','ETCUSDT','XRPUSDT','EOSUSDT','FILUSDT','ALGOUSDT','SANDUSDT','MANAUSDT','AXSUSDT','GALAUSDT','CRVUSDT','UNIUSDT','AAVEUSDT','MKRUSDT','SNXUSDT','COMPUSDT','YFIUSDT','1INCHUSDT','SUSHIUSDT','ENJUSDT','CHZUSDT','FLOWUSDT','ICPUSDT','THETAUSDT','ZECUSDT','DARUSDT','GMTUSDT','APEUSDT','LDOUSDT','OPUSDT','ARBUSDT','SUIUSDT','TIAUSDT','SEIUSDT','RNDRUSDT','INJUSDT','DYDXUSDT'];

async function getFundingHistory(pair, limit = 1000) {
  const url = `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${pair}&limit=${limit}`;
  const r = await fetch(url);
  if (!r.ok) return null;
  return r.json();
}

function simulate(history, capital = 1000) {
  let eq = capital;
  const trades = [];
  const eqc = [capital];
  for (const ev of history) {
    const rate = +ev.fundingRate;
    const notional = eq;
    if (rate < 0) {
      const net = (-rate - 2 * FEE_TAKER) * notional;
      eq += net; if (eq < 0) eq = 0;
      trades.push({ pnl: net, entry: notional, exit: notional, size: notional });
    }
    eqc.push(eq);
  }
  return { trades, equityCurve: eqc, finalCapital: eq, initialCapital: capital };
}

async function scan() {
  console.log(`Scanning ${CANDIDATES.length} pairs for real funding-edge (where collecting negative funding beats 2x fees)...\n`);
  const rows = [];
  for (const pair of CANDIDATES) {
    try {
      const hist = await getFundingHistory(pair, 1000);
      if (!hist || !hist.length) continue;
      const res = simulate(hist);
      const m = computeMetrics(res);
      const negEvents = hist.filter(h => +h.fundingRate < 0).length;
      const avgNeg = negEvents ? hist.filter(h => +h.fundingRate < 0).reduce((s, h) => s + (-(+h.fundingRate)), 0) / negEvents : 0;
      const edge = avgNeg - 2 * FEE_TAKER;
      rows.push({ pair, events: hist.length, negPct: (negEvents / hist.length * 100).toFixed(0), avgNegRate: (avgNeg * 100).toFixed(3), edgePct: (edge * 100).toFixed(3), retPct: (m.returnPct * 100).toFixed(1), pf: isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : 'inf', gates: m.trades >= 50 ? `${evaluateGates(m).passed}/6` : 'few' });
    } catch (e) { /* skip */ }
  }
  rows.sort((a, b) => parseFloat(b.edgePct) - parseFloat(a.edgePct));
  console.log('Pair        | evts | %neg | avgNeg% | EDGE%  | ret%  | PF   | gates');
  for (const r of rows) {
    console.log(`${r.pair.padEnd(11)} | ${String(r.events).padStart(4)} | ${r.negPct.padStart(4)} | ${r.avgNegRate.padStart(7)} | ${r.edgePct.padStart(6)} | ${r.retPct.padStart(5)} | ${String(r.pf).padStart(5)} | ${r.gates}`);
  }
  const winners = rows.filter(r => parseFloat(r.edgePct) > 0);
  console.log(`\n${winners.length} pairs have positive theoretical funding edge after fees.`);
  return rows;
}

if (process.argv[1] && process.argv[1].endsWith('fundingScanner.mjs')) {
  scan().then(() => process.exit(0)).catch(e => { console.error('ERR', e.message); process.exit(1); });
}
