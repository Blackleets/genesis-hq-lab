// rrOptimizer.mjs — Tune the reward:risk multiple (R_MULT) on ALREADY-VALIDATED
// edges to maximize aggregate expectancy WITHOUT changing the signal logic
// (no overfit to signal params). Tests R_MULT in [1.2 .. 3.0] on REAL data.
//
// Run: node --env-file-if-exists=.env server/crypto/backtest/rrOptimizer.mjs

import { fetchKlines } from './historicalData.mjs';
import { computeMetrics } from './metrics.mjs';
import {
  calculateBollingerBands as bollinger,
  calculateRsi as rsi,
  calculateAdx as adx,
} from '../technicalIndicators.mjs';

const PAIRS = (process.env.RR_PAIRS || 'SOLUSDT,ETHUSDT,DOGEUSDT,ADAUSDT,XRPUSDT,BNBUSDT').split(',');
const INTERVAL = process.env.RR_INTERVAL || '4h';
const DAYS = Number(process.env.RR_DAYS || 400);
const STOP_PCT = 0.005;
const RISK_PCT = 1.0;
const P = { bbPeriod: 20, bbStd: 2.0, rsiPeriod: 13, rsiOS: 30, rsiOB: 70, adxMax: 25, adxPeriod: 14 };

function signalsFor(closes, highs, lows) {
  const n = closes.length, out = new Array(n).fill(null);
  const warm = Math.max(P.bbPeriod, P.adxPeriod) + 2;
  for (let i = warm; i < n; i++) {
    const sliceC = closes.slice(0, i + 1), sliceH = highs.slice(0, i + 1), sliceL = lows.slice(0, i + 1);
    const bb = bollinger(sliceC, P.bbPeriod, P.bbStd), r = rsi(sliceC, P.rsiPeriod), a = adx(sliceH, sliceL, sliceC, P.adxPeriod);
    const price = closes[i];
    if (a > P.adxMax) continue;
    if (price <= bb.lower && r <= P.rsiOS) out[i] = 'LONG';
    else if (price >= bb.upper && r >= P.rsiOB) out[i] = 'SHORT';
  }
  return out;
}

function bt(klines, R_MULT) {
  const closes = klines.map(k=>+k[4]), highs = klines.map(k=>+k[2]), lows = klines.map(k=>+k[3]);
  const sig = signalsFor(closes, highs, lows);
  let eq = 10_000, pos = null; const trades = [];
  for (let i=0;i<sig.length;i++){
    const hi=highs[i],lo=lows[i],price=closes[i];
    if(pos){const tp=pos.side==='LONG'?hi>=pos.tp:lo<=pos.tp;const sl=pos.side==='LONG'?lo<=pos.sl:hi>=pos.sl;
      if(tp){const pnl=(pos.side==='LONG'?pos.tp-pos.entry:pos.entry-pos.tp)*pos.units;eq+=pnl;trades.push({pnl,capitalUsed:pos.riskUSD});pos=null;}
      else if(sl){const pnl=(pos.side==='LONG'?pos.sl-pos.entry:pos.entry-pos.sl)*pos.units;eq+=pnl;trades.push({pnl,capitalUsed:pos.riskUSD});pos=null;}}
    if(!pos&&sig[i]){const sd=price*STOP_PCT,units=(eq*(RISK_PCT/100))/sd,side=sig[i];
      pos={side,entry:price,sl:side==='LONG'?price-sd:price+sd,tp:side==='LONG'?price+sd*R_MULT:price-sd*R_MULT,units,riskUSD:eq*(RISK_PCT/100)};}
  }
  return computeMetrics(trades);
}

async function main(){
  console.log(`\n=== R:R OPTIMIZER (REAL ${INTERVAL} data, ${DAYS}d) ===`);
  const data = {};
  for (const pair of PAIRS){
    try { data[pair] = await fetchKlines(pair,{days:DAYS,interval:INTERVAL}); }
    catch(e){ console.log(pair,'skip',e.message); }
  }
  const mults = [1.2,1.5,1.7,2.0,2.2,2.5,3.0];
  const agg = {};
  for (const R of mults) agg[R] = { exp:0, trades:0, pf:0, n:0 };
  for (const R of mults){
    for (const pair of PAIRS){
      if(!data[pair]) continue;
      const m = bt(data[pair], R);
      if(m.trades>0){ agg[R].exp += m.expectancy; agg[R].trades += m.trades; agg[R].pf += m.profitFactor||0; agg[R].n++; }
    }
  }
  console.log('R_MULT | avgExp/trade | avgPF | totalTrades');
  for (const R of mults){
    const a=agg[R];
    console.log(`${String(R).padEnd(6)} | $${(a.exp/Math.max(a.n,1)).toFixed(0).padStart(6)}      | ${ (a.pf/Math.max(a.n,1)).toFixed(2).padStart(5)} | ${a.trades}`);
  }
  // pick best by avg expectancy
  let best=null;
  for(const R of mults){ const a=agg[R]; const e=a.exp/Math.max(a.n,1); if(best===null||e>best.e) best={R,e}; }
  console.log(`\nBEST R_MULT = ${best.R} (avg expectancy $${best.e.toFixed(0)}/trade across ${agg[best.R].n} pairs)`);
}

main().catch(e=>{console.error('FATAL',e);process.exit(1);});
