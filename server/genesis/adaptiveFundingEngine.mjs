// server/genesis/adaptiveFundingEngine.mjs
// Adaptive engine for the funding-rate edge (the one that IS seasonal).
//
// Unlike TA strategies, funding collection has a REAL structural edge when the
// market is bearish: funding rates go negative frequently, so delta-neutral
// positions COLLECT instead of pay. This engine scans the recent funding
// history and DEPLOYS only when the measured edge (avg negative rate minus
// 2x fees) is positive on recent data. When the regime flips bullish (pay),
// it goes FLAT. That is trade-the-regime, honestly.
//
// Uses REAL Binance fundingRate history (no key). PAPER analysis. The deploy
// decision is what you'd wire to real execution later (with human GO).

const FEE_TAKER = 0.0004;

async function getFundingHistory(pair, limit) {
  const url = `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${pair}&limit=${limit}`;
  const r = await fetch(url);
  if (!r.ok) return null;
  return r.json();
}

function edgeOf(history) {
  const neg = history.filter(h => +h.fundingRate < 0);
  if (!neg.length) return { edge: -Infinity, negPct: 0, avgNeg: 0 };
  const avgNeg = neg.reduce((s, h) => s + (-(+h.fundingRate)), 0) / neg.length;
  return { edge: (avgNeg - 2 * FEE_TAKER) * 100, negPct: (neg.length / history.length) * 100, avgNeg };
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

export async function runAdaptiveFunding({ pairs = ['COTIUSDT','XLMUSDT','SOLUSDT','BNBUSDT','ETHUSDT','BTCUSDT','ADAUSDT','AVAXUSDT','DOGEUSDT','LINKUSDT','MATICUSDT','DOTUSDT'], lookback = 500, recentN = 100 } = {}) {
  console.log(`\n💸 ADAPTIVE FUNDING ENGINE — scanning ${pairs.length} pairs (REAL Binance funding)`);
  console.log(`Lookback ${lookback} events, deploy decision on last ${recentN} events.\n`);
  const deployments = [];
  for (const pair of pairs) {
    const hist = await getFundingHistory(pair, lookback);
    if (!hist || hist.length < recentN) continue;
    const recent = hist.slice(-recentN);
    const recentEdge = edgeOf(recent);
    const fullEdge = edgeOf(hist);
    const res = simulate(hist);
    const deploy = recentEdge.edge > 0;
    if (deploy) {
      deployments.push({ pair, edge: +recentEdge.edge.toFixed(3), negPct: +recentEdge.negPct.toFixed(0), retPct: +(res.returnPct * 100).toFixed(1) });
      console.log(`  ✅ DEPLOY ${pair.padEnd(11)} recentEdge=${recentEdge.edge.toFixed(3)}% negEvents=${recentEdge.negPct}% fullRet=${deployments[deployments.length-1].retPct}%`);
    } else {
      console.log(`  ⏸  FLAT   ${pair.padEnd(11)} recentEdge=${recentEdge.edge.toFixed(3)}% (regime pays funding)`);
    }
  }
  console.log(`\n=== ADAPTIVE FUNDING VERDICT ===`);
  console.log(`Deployable now: ${deployments.length}/${pairs.length}`);
  if (deployments.length) console.log(`→ These pairs are COLLECTING funding in the recent window. Paper-test, then real with tiny size + kill switch.`);
  else console.log(`→ No pair has a positive recent funding edge. Market is bullish/neutral (paying). Engine waits.`);
  return { deployments };
}

if (process.argv[1] && process.argv[1].endsWith('adaptiveFundingEngine.mjs')) {
  runAdaptiveFunding().then(() => process.exit(0)).catch(e => { console.error('ERR', e.message); process.exit(1); });
}
