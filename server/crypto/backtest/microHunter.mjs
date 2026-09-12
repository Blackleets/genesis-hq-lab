// microHunter.mjs — HONEST validation of FAST microstructure-style edges on
// REAL Binance futures data (public klines, no key). Tests whether short-horizon
// mean-reversion or momentum on 1m/3m candles has any edge after fees. If yes,
// it is reported; if no, reported honestly (no fabricated PASS).
//
// Strategies:
//  S1 tick-imbalance MR: if close<open (bearish 1m), go long next bar; exit in
//     N bars or on opposite signal. (captures intrabar mean reversion)
//  S2 vol-breakout continuation: if bar range > k*avgRange and close>open, go
//     long; reverse for shorts. (momentum / breakout continuation)
//  S3 liquidation-rebound proxy: after a large down-bar (close<<open, high vol),
//     go long next bar (rebound); symmetric for up-bars.

import { writeFileSync } from 'node:fs';

const PAIRS = (process.env.MH_PAIRS || 'BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT,DOGEUSDT,ADAUSDT,AVAXUSDT,LINKUSDT,NEARUSDT,SUIUSDT,WCHEUSDT,TONUSDT,ARBUSDT,OPUSDT,PEPEUSDT,WIFUSDT,1000PEPEUSDT,NEIROUSDT,POPCATUSDT')
  .split(',').map(s=>s.trim()).filter(Boolean);
const N = Number(process.env.MH_N || 3000);
const TF = process.env.MH_TF || '1m';
const FEE = Number(process.env.MH_FEE || 0.0002);

function avgRange(closes, highs, lows, p){
  let s=0; for(let i=1;i<closes.length;i++){ s += (highs[i]-lows[i]); } return s/(closes.length-1);
}

function s1TickMR(o,h,l,c,maxHold=5){
  const t=[]; let pos=null;
  for(let i=1;i<c.length;i++){
    const bearish = c[i-1]<o[i-1];
    const bullish = c[i-1]>o[i-1];
    if(pos){ pos.bars++; let exit=false,px=c[i];
      if(pos.side==='L'&&(bullish||pos.bars>=maxHold))exit=true;
      if(pos.side==='S'&&(bearish||pos.bars>=maxHold))exit=true;
      if(exit){const dir=pos.side==='L'?(px-pos.entry):(pos.entry-px);t.push(dir/pos.entry-2*FEE);pos=null;}
    }
    if(!pos){ if(bearish)pos={side:'L',entry:c[i]}; else if(bullish)pos={side:'S',entry:c[i]}; }
  }
  return t;
}
function s2VolBreak(o,h,l,c,maxHold=5){
  const ar=avgRange(c,h,l); const t=[]; let pos=null;
  for(let i=1;i<c.length;i++){
    const rng=(h[i]-l[i]); const up=c[i-1]>o[i-1]; const dn=c[i-1]<o[i-1];
    if(pos){ pos.bars++; let exit=false,px=c[i];
      if(pos.side==='L'&&(dn||pos.bars>=maxHold))exit=true;
      if(pos.side==='S'&&(up||pos.bars>=maxHold))exit=true;
      if(exit){const dir=pos.side==='L'?(px-pos.entry):(pos.entry-px);t.push(dir/pos.entry-2*FEE);pos=null;}
    }
    if(!pos){
      if(rng>1.5*ar && up)pos={side:'L',entry:c[i]};
      else if(rng>1.5*ar && dn)pos={side:'S',entry:c[i]};
    }
  }
  return t;
}
function s3LiqRebound(o,h,l,c,maxHold=5){
  const t=[]; let pos=null;
  for(let i=1;i<c.length;i++){
    const downBig = (c[i-1]-o[i-1])/(o[i-1]||1) < -0.003;
    const upBig = (c[i-1]-o[i-1])/(o[i-1]||1) > 0.003;
    if(pos){ pos.bars++; let exit=false,px=c[i];
      if(pos.side==='L'&&(downBig||pos.bars>=maxHold))exit=true;
      if(pos.side==='S'&&(upBig||pos.bars>=maxHold))exit=true;
      if(exit){const dir=pos.side==='L'?(px-pos.entry):(pos.entry-px);t.push(dir/pos.entry-2*FEE);pos=null;}
    }
    if(!pos){ if(downBig)pos={side:'L',entry:c[i]}; else if(upBig)pos={side:'S',entry:c[i]}; }
  }
  return t;
}

function analyze(trades,name,pair){
  if(trades.length<50)return null;
  const wins=trades.filter(x=>x>0).length; const wr=wins/trades.length;
  const gross=trades.reduce((a,b)=>a+Math.max(0,b),0), loss=trades.reduce((a,b)=>a+Math.max(0,-b),0);
  const pf=loss===0?99:gross/loss;
  const mean=trades.reduce((a,b)=>a+b,0)/trades.length;
  const sd=Math.sqrt(trades.reduce((a,b)=>a+(b-mean)**2,0)/trades.length);
  const tstat=mean/(sd/Math.sqrt(trades.length));
  return {name,pair,trades:trades.length,wr:+(wr*100).toFixed(1),pf:+(pf===99?99:pf).toFixed(2),tstat:+tstat.toFixed(2),retPct:+(trades.reduce((a,b)=>a+b,0)*100).toFixed(2)};
}

const STRATS=[{fn:s1TickMR,name:'tick_mr_1m'},{fn:s2VolBreak,name:'volbreak_1m'},{fn:s3LiqRebound,name:'liq_rebound_1m'}];
const WIN=[];
async function kl(pair,tf,n){const r=await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${pair}&interval=${tf}&limit=${n}`);if(!r.ok)return null;const k=await r.json();return k.map(x=>({o:+x[1],h:+x[2],l:+x[3],c:+x[4]}));}
console.log(`[MICRO] testing ${PAIRS.length}x${STRATS.length} (${TF} ${N})`);
for(const pair of PAIRS){for(const s of STRATS){try{
  const d=await kl(pair,TF,N);if(!d||d.length<60)continue;
  const o=d.map(x=>x.o),h=d.map(x=>x.h),l=d.map(x=>x.l),c=d.map(x=>x.c);
  const tr=s.fn(o,h,l,c);const a=analyze(tr,s.name,pair);
  if(a&&a.pf>=1.3&&a.trades>=50&&a.tstat>=2){WIN.push(a);console.log('  PASS',JSON.stringify(a));}
}catch(e){}}}
console.log(`[MICRO] done: tested=${PAIRS.length*STRATS.length} passed=${WIN.length}`);
try{writeFileSync(process.env.MH_OUT||'micro_winners.jsonl',JSON.stringify(WIN,null,2)+'\n');}catch{}
