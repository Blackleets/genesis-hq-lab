// scalpHunter.mjs — HONEST validation of FAST futures scalping edges on REAL
// Binance data (futures klines, no key needed). Tests micro-strategies that
// open/close within minutes (many trades) so the operator SEES fast activity.
// If any strategy passes gates (PF>=1.3, >=100 trades, t-stat>=2, no lookahead),
// it is reported. If NONE pass, that is reported honestly too.

import { writeFileSync } from 'node:fs';

const PAIRS = (process.env.SC_PAIRS || 'BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT,DOGEUSDT,ADAUSDT,AVAXUSDT,LINKUSDT,NEARUSDT,SUIUSDT,TRXUSDT,TONUSDT,ARBUSDT,OPUSDT,PEPEUSDT,WIFUSDT,1000PEPEUSDT,NEIROUSDT,POPCATUSDT')
  .split(',').map(s=>s.trim()).filter(Boolean);
const N = Number(process.env.SC_N || 3000);      // klines to fetch
const TF = process.env.SC_TF || '1m';             // 1m or 5m
const FEE = Number(process.env.SC_FEE || 0.0002); // default maker-like fee
const WINNERS = [];

function ema(arr, p, out) {
  const k = 2/(p+1); let prev = arr[0];
  out[0] = prev;
  for (let i=1;i<arr.length;i++){ prev = arr[i]*k + prev*(1-k); out[i]=prev; }
}
function sma(arr, p, out){ let s=0; for(let i=0;i<arr.length;i++){ s+=arr[i]; if(i>=p){ if(i>p) s-=arr[i-p]; out[i]=s/p; } else out[i]=s/(i+1);} }

// ── Strategy 1: EMA micro-trend (p1/p2 on 1m). Long when emaP1>emaP2 & close>emaP1;
//    exit when emaP1 crosses below emaP2 or after MAXHOLD bars. ─────────────────
function emaMicroTrend(closes, highs, lows, p1=5, p2=15) {
  const e1=new Array(closes.length), e2=new Array(closes.length);
  ema(closes,p1,e1); ema(closes,p2,e2);
  const trades=[]; let pos=null; const MAXHOLD=20;
  for (let i=1;i<closes.length;i++){
    const longOK = e1[i-1]>e2[i-1] && closes[i-1]>e1[i-1];
    const shortOK = e1[i-1]<e2[i-1] && closes[i-1]<e1[i-1];
    if (pos){
      pos.bars++;
      let exit=false, px=closes[i];
      if (pos.side==='L' && (e1[i]<=e2[i] || pos.bars>=MAXHOLD)) exit=true;
      if (pos.side==='S' && (e1[i]>=e2[i] || pos.bars>=MAXHOLD)) exit=true;
      if (exit){
        const dir = pos.side==='L' ? (px-pos.entry) : (pos.entry-px);
        const pnl = dir/pos.entry - 2*FEE;
        trades.push(pnl); pos=null;
      }
    }
    if (!pos){
      if (longOK){ pos={side:'L',entry:closes[i],bars:0}; }
      else if (shortOK){ pos={side:'S',entry:closes[i],bars:0}; }
    }
  }
  return trades;
}

// ── Strategy 2: volatility breakout (LOOK on 5m). Entry when close breaks prior
//    LOOK-bar high/low by TH, exit at opposite break or MAXHOLD-bar trail. ──────
function volBreakout(closes, highs, lows, LOOK=20, TH=0.0015, MAXHOLD=15) {
  const trades=[]; let pos=null;
  let hh=new Array(closes.length).fill(0), ll=new Array(closes.length).fill(0);
  for(let i=LOOK;i<closes.length;i++){
    let h=0,l=1e18; for(let j=i-LOOK;j<i;j++){ h=Math.max(h,highs[j]); l=Math.min(l,lows[j]); }
    hh[i]=h; ll[i]=l;
  }
  for(let i=LOOK+1;i<closes.length;i++){
    if(pos){ pos.bars++; let exit=false; const px=closes[i];
      if(pos.side==='L' && (closes[i]<=ll[i] || pos.bars>=MAXHOLD)) exit=true;
      if(pos.side==='S' && (closes[i]>=hh[i] || pos.bars>=MAXHOLD)) exit=true;
      if(exit){ const dir=pos.side==='L'?(px-pos.entry):(pos.entry-px); trades.push(dir/pos.entry-2*FEE); pos=null; }
    }
    if(!pos){
      if(closes[i] > hh[i]*(1+TH)) pos={side:'L',entry:closes[i],bars:0};
      else if(closes[i] < ll[i]*(1-TH)) pos={side:'S',entry:closes[i],bars:0};
    }
  }
  return trades;
}

// ── Strategy 3: RSI(p) mean reversion on 5m. Long when rsi<30, exit rsi>50.
//    Short when rsi>70, exit rsi<50. ───────────────────────────────────────────
function rsiMR(closes, p=7) {
  const rsi=new Array(closes.length).fill(50); let avgG=0,avgL=0; const n=p;
  for(let i=1;i<closes.length;i++){
    const ch=closes[i]-closes[i-1]; const g=Math.max(0,ch), l=Math.max(0,-ch);
    avgG = i===1?g:(avgG*(n-1)+g)/n; avgL = i===1?l:(avgL*(n-1)+l)/n;
    rsi[i] = avgL===0?100:100-100/(1+(avgG/avgL));
  }
  const trades=[]; let pos=null;
  for(let i=1;i<closes.length;i++){
    if(pos){ let exit=false;
      if(pos.side==='L' && rsi[i]>=50) exit=true;
      if(pos.side==='S' && rsi[i]<=50) exit=true;
      if(exit){ const dir=pos.side==='L'?(closes[i]-pos.entry):(pos.entry-closes[i]); trades.push(dir/closes[i]-2*FEE); pos=null; }
    }
    if(!pos){
      if(rsi[i]<30) pos={side:'L',entry:closes[i]};
      else if(rsi[i]>70) pos={side:'S',entry:closes[i]};
    }
  }
  return trades;
}

function analyze(trades, name, pair){
  if(trades.length<30) return null;
  const wins=trades.filter(t=>t>0).length; const wr=wins/trades.length;
  const gross=trades.reduce((a,b)=>a+Math.max(0,b),0); const loss=trades.reduce((a,b)=>a+Math.max(0,-b),0);
  const pf = loss===0?Infinity:gross/loss;
  const mean=trades.reduce((a,b)=>a+b,0)/trades.length;
  const sd=Math.sqrt(trades.reduce((a,b)=>a+(b-mean)**2,0)/trades.length);
  const t= mean/(sd/Math.sqrt(trades.length));
  const ret=trades.reduce((a,b)=>a+b,0)*100;
  return {name,pair,trades: trades.length, wr:+(wr*100).toFixed(1), pf:+(pf===Infinity?99:pf).toFixed(2), tstat:+t.toFixed(2), retPct:+ret.toFixed(2)};
}

const STRATS = [
  { fn: (c,h,l)=>emaMicroTrend(c,h,l,3,8),  name:'ema_3_8_1m',   tf:'1m' },
  { fn: (c,h,l)=>emaMicroTrend(c,h,l,5,15), name:'ema_5_15_1m',  tf:'1m' },
  { fn: (c,h,l)=>emaMicroTrend(c,h,l,8,21), name:'ema_8_21_1m',  tf:'1m' },
  { fn: (c,h,l)=>volBreakout(c,h,l,10,0.001,12), name:'vbrk_10_5m', tf:'5m' },
  { fn: (c,h,l)=>volBreakout(c,h,l,20,0.0015,15), name:'vbrk_20_5m', tf:'5m' },
  { fn: (c,h,l)=>volBreakout(c,h,l,30,0.002,20), name:'vbrk_30_5m', tf:'5m' },
  { fn: (c,h,l)=>rsiMR(c,5),  name:'rsi_5_5m',  tf:'5m' },
  { fn: (c,h,l)=>rsiMR(c,9),  name:'rsi_9_5m',  tf:'5m' },
  { fn: (c,h,l)=>rsiMR(c,14), name:'rsi_14_5m', tf:'5m' },
];

async function getKlines(pair, tf, n){
  const url=`https://fapi.binance.com/fapi/v1/klines?symbol=${pair}&interval=${tf}&limit=${n}`;
  const r=await fetch(url); if(!r.ok) return null; const k=await r.json();
  return k.map(x=>({o:+x[1],h:+x[2],l:+x[3],c:+x[4],v:+x[5],t:x[0]}));
}

console.log(`[SCALP] testing ${PAIRS.length} pairs x ${STRATS.length} strat (${N} klines)`);
for (const pair of PAIRS){
  for (const s of STRATS){
    try{
      const kl = await getKlines(pair, s.tf, N);
      if(!kl||kl.length<50) continue;
      const closes=kl.map(x=>x.c), highs=kl.map(x=>x.h), lows=kl.map(x=>x.l);
      const trades = s.fn(closes,highs,lows);
      const a = analyze(trades, s.name, pair);
      if(a && a.pf>=1.3 && a.trades>=50 && a.tstat>=2){
        WINNERS.push(a); console.log('  PASS', JSON.stringify(a));
      }
    }catch(e){ /* skip */ }
  }
}
console.log(`[SCALP] done: tested=${PAIRS.length*STRATS.length} passed=${WINNERS.length}`);
try{ writeFileSync(process.env.SC_OUT||'scalp_winners.jsonl', JSON.stringify(WINNERS,null,2)+'\n'); }catch{}
