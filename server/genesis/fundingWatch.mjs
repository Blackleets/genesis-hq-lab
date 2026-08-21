// server/genesis/fundingWatch.mjs
// Cron-friendly funding-edge watch. Scans REAL Binance funding-rate history
// for the pairs where delta-neutral funding collection is PROFITABLE after
// fees. Prints a compact report and exits 0. Designed to run on a schedule
// (Hermes cron or system cron) and notify only when an edge appears.
//
// Edge rule: collect when rate<0. Net per event = (-rate - 2*FEE) * notional.
// Positive when avg(-rate over negative events) > 2*FEE.

import { computeMetrics, evaluateGates } from './backtestCore.mjs';

const FEE_TAKER = 0.0004;
const PAIRS = (process.env.GENESIS_WATCH_PAIRS || 'COTIUSDT,XLMUSDT,SOLUSDT,BNBUSDT,ETHUSDT,BTCUSDT,ADAUSDT,AVAXUSDT,DOGEUSDT,LINKUSDT,MATICUSDT,DOTUSDT,TRXUSDT,NEARUSDT,ATOMUSDT,LTCUSDT,BCHUSDT,ETCUSDT,XRPUSDT,EOSUSDT,FILUSDT,ALGOUSDT,SANDUSDT,MANAUSDT,AXSUSDT,GALAUSDT,CRVUSDT,UNIUSDT,AAVEUSDT,MKRUSDT,SNXUSDT,COMPUSDT,YFIUSDT,1INCHUSDT,SUSHIUSDT,ENJUSDT,CHZUSDT,FLOWUSDT,ICPUSDT,THETAUSDT,ZECUSDT,DARUSDT,GMTUSDT,APEUSDT,LDOUSDT,OPUSDT,ARBUSDT,SUIUSDT,TIAUSDT,SEIUSDT,RNDRUSDT,INJUSDT,DYDXUSDT')
  .split(',').map(s => s.trim()).filter(Boolean);
const LIMIT = Number(process.env.GENESIS_WATCH_LIMIT || 1000);
const EDGE_THRESHOLD = Number(process.env.GENESIS_WATCH_EDGE || 0.0); // pct, positive = profitable

async function getFundingHistory(pair, limit) {
  const url = `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${pair}&limit=${limit}`;
  const r = await fetch(url);
  if (!r.ok) return null;
  return r.json();
}

function simulate(history, capital = 1000) {
  let eq = capital; const trades = []; const eqc = [capital];
  for (const ev of history) {
    const rate = +ev.fundingRate; const notional = eq;
    if (rate < 0) {
      const net = (-rate - 2 * FEE_TAKER) * notional;
      eq += net; if (eq < 0) eq = 0;
      trades.push({ pnl: net, entry: notional, exit: notional, size: notional });
    }
    eqc.push(eq);
  }
  return { trades, equityCurve: eqc, finalCapital: eq, initialCapital: capital };
}

export async function runWatch({ pairs = PAIRS, limit = LIMIT, edgeThreshold = EDGE_THRESHOLD } = {}) {
  const winners = [];
  const lines = [`[fundingWatch] ${new Date().toISOString()} — scanning ${pairs.length} pairs (REAL Binance funding, PAPER analysis)`];
  for (const pair of pairs) {
    try {
      const hist = await getFundingHistory(pair, limit);
      if (!hist || !hist.length) continue;
      const res = simulate(hist);
      const m = computeMetrics(res);
      const neg = hist.filter(h => +h.fundingRate < 0);
      const avgNeg = neg.length ? neg.reduce((s, h) => s + (-(+h.fundingRate)), 0) / neg.length : 0;
      const edge = (avgNeg - 2 * FEE_TAKER) * 100;
      const gates = m.trades >= 50 ? `${evaluateGates(m).passed}/6` : 'few';
      if (edge > edgeThreshold) {
        winners.push({ pair, edge: +edge.toFixed(3), retPct: +(m.returnPct * 100).toFixed(1), pf: isFinite(m.profitFactor) ? +m.profitFactor.toFixed(2) : null, gates });
        lines.push(`  ✅ EDGE ${pair}: edge=${edge.toFixed(3)}% ret=${winners[winners.length-1].retPct}% PF=${winners[winners.length-1].pf} gates=${gates}`);
      }
    } catch { /* skip pair */ }
  }
  if (!winners.length) lines.push('  ⚠️  No profitable funding edge found this run (regime still pays funding).');
  else lines.push(`\n${winners.length} pair(s) with positive funding edge. Consider operating these (PAPER first).`);
  const report = lines.join('\n');
  console.log(report);
  return { winners, report };
}

if (process.argv[1] && process.argv[1].endsWith('fundingWatch.mjs')) {
  runWatch().then(() => process.exit(0)).catch(e => { console.error('ERR', e.message); process.exit(1); });
}
