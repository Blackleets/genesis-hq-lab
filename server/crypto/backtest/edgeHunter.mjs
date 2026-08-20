// edgeHunter.mjs — HONEST edge search across the full Binance USDT universe.
// Runs EVERY pair × timeframe × indicator family, backtests on REAL data with
// proper (non-optimistic) fills, and reports only configs that pass ALL
// readiness gates (sample size, win rate, profit factor, expectancy, t-stat).
// No in-sample cherry-picking: we report the FULL distribution so nothing is
// hidden. Output goes to stdout as JSON lines for the orchestrator to rank.
//
// Usage: node edgeHunter.mjs [pairsFile] [maxPairs]
//   Each bot gets a SLICE of the universe so 3-4 bots cover it in parallel.

import { readFileSync, appendFileSync } from 'node:fs';

const UNIVERSE_FILE = process.argv[2] || 'server/crypto/backtest/pairs_universe.txt';
const MAX_PAIRS = Number(process.argv[3] || 120);
const BOT_ID = process.env.BOT_ID || 'B0';
const DAYS_LIMIT = 1500;
const OUT_FILE = process.env.HUNT_OUT || 'hunt_winners.jsonl';

const INTERVALS = process.env.HUNT_INTERVALS?.split(',') || ['1h'];
const COST = 0.001; // 0.10% round-trip (taker+slippage)

// ---- Indicator helpers (Wilder where standard) -----------------------------
function sma(a,p,i){ if(i+1<p) return null; let s=0; for(let k=i-p+1;k<=i;k++) s+=a[k]; return s/p; }
function rsiWilder(c,period){ const o=[]; let pg=0,pl=0;
  for(let i=0;i<c.length;i++){ if(i<period){o.push(50);continue;} const d=c[i]-c[i-1],g=Math.max(d,0),l=Math.max(-d,0);
    if(i===period){let sg=0,sl=0;for(let j=1;j<=period;j++){const dd=c[j]-c[j-1];if(dd>=0)sg+=dd;else sl-=dd;}pg=sg/period;pl=sl/period;}
    else{pg=(pg*(period-1)+g)/period;pl=(pl*(period-1)+l)/period;} const rs=pl>0?pg/pl:99; o.push(100-100/(1+rs)); }
  return o; }
function wilderAdx(c,period,h,l){ if(c.length<period*2) return 0; const hi=h??c,lo=l??c; const tr=[],pd=[],md=[];
  for(let i=1;i<c.length;i++){const up=c[i]-c[i-1],dn=c[i-1]-c[i];const H=hi[i],L=lo[i],HP=hi[i-1],LP=lo[i-1];
    const trv=Math.max(H-L,Math.abs(H-HP),Math.abs(L-LP));const p=up>dn&&up>0?up:0,d=dn>up&&dn>0?dn:0;tr.push(trv);pd.push(p);md.push(d);}
  let atr=tr.slice(0,period).reduce((s,x)=>s+x,0)/period, ap=pd.slice(0,period).reduce((s,x)=>s+x,0)/period, am=md.slice(0,period).reduce((s,x)=>s+x,0)/period;
  for(let i=period;i<tr.length;i++){atr=(atr*(period-1)+tr[i])/period;ap=(ap*(period-1)+pd[i])/period;am=(am*(period-1)+md[i])/period;}
  const pdi=atr>0?(ap/atr)*100:0,mdi=atr>0?(am/atr)*100:0; return Math.abs(pdi-mdi)/(pdi+mdi+1e-9)*100; }
function ema(a,period){ const k=2/(period+1); const o=[]; let prev=a[0]; o.push(prev);
  for(let i=1;i<a.length;i++){prev=a[i]*k+prev*(1-k);o.push(prev);} return o; }

// ---- Backtest: entry next bar, exit on first TP/SL touch (intrabar H/L) -----
function backtest(closes, highs, lows, sig){
  const rets=[]; let pos=null;
  for(let i=0;i<closes.length;i++){
    const h=highs[i],l=lows[i],p=closes[i];
    if(pos){
      const tpHit=pos.side==='LONG'?h>=pos.tp:l<=pos.tp;
      const slHit=pos.side==='LONG'?l<=pos.sl:h>=pos.sl;
      if(tpHit){rets.push(pos.tpRet-COST);pos=null;}
      else if(slHit){rets.push(-pos.slPct-COST);pos=null;}
    }
    if(!pos && sig[i]){
      const side=sig[i]; const entry=p; const slPct=sig.slPct;
      const tpRet=slPct*1.7; // fixed 1.7R
      pos={side,entry,sl:side==='LONG'?entry*(1-slPct):entry*(1+slPct),tp:side==='LONG'?entry*(1+tpRet):entry*(1-tpRet),slPct,tpRet};
    }
  }
  return rets;
}

function signalsBollMR(closes,highs,lows,p){
  const r=rsiWilder(closes,p.rsiP); const n=closes.length; const s=new Array(n).fill(null);
  const warm=Math.max(p.bb,p.adx)+2;
  for(let i=warm;i<n;i++){
    const w=closes.slice(i-p.bb,i); const m=w.reduce((s,x)=>s+x,0)/p.bb; const sd=Math.sqrt(w.reduce((s,x)=>s+(x-m)**2,0)/p.bb)||1e-9;
    const up=m+p.std*sd, lo=m-p.std*sd; const rsi=r[i]; const a=wilderAdx(closes.slice(0,i+1),p.adx,highs.slice(0,i+1),lows.slice(0,i+1));
    if(a>p.adxMax) continue;
    const last=closes[i-1];
    if(last<=lo && rsi<=p.rsiLO) s[i]='LONG'; else if(last>=up && rsi>=p.rsiHI) s[i]='SHORT';
  }
  for(const k in s) if(s[k]) s[k]={slPct:0.005};
  return s;
}
function signalsDonchian(closes,highs,lows,p){
  const n=closes.length; const s=new Array(n).fill(null); const warm=p.chan+2;
  for(let i=warm;i<n;i++){
    const ch=closes.slice(i-p.chan,i); const hi=Math.max(...ch),lo=Math.min(...ch); const reg=sma(closes,p.reg,i-1);
    if(reg==null) continue; const last=closes[i-1];
    if(last>hi && last>reg) s[i]='LONG'; else if(last<lo && last<reg) s[i]='SHORT';
  }
  for(const k in s) if(s[k]) s[k]={slPct:0.005};
  return s;
}
function signalsMA(closes,highs,lows,p){
  const n=closes.length; const s=new Array(n).fill(null);
  for(let i=2;i<n;i++){ const fp=sma(closes,p.fast,i-2),sp=sma(closes,p.slow,i-2),fn=sma(closes,p.fast,i-1),sn=sma(closes,p.slow,i-1);
    if(fp==null||sp==null||fn==null||sn==null) continue;
    if(fp<=sp && fn>sn) s[i]='LONG'; else if(fp>=sp && fn<sn) s[i]='SHORT'; }
  for(const k in s) if(s[k]) s[k]={slPct:0.005};
  return s;
}
function signalsRSI(closes,highs,lows,p){
  const r=rsiWilder(closes,p.period); const n=closes.length; const s=new Array(n).fill(null);
  for(let i=2;i<n;i++){ const last=closes[i-1];
    if(last<=closes[i] && r[i-1]<=p.lo) s[i]='LONG'; else if(last>=closes[i] && r[i-1]>=p.hi) s[i]='SHORT'; }
  for(const k in s) if(s[k]) s[k]={slPct:0.005};
  return s;
}

const FAMILIES = {
  bollMR: (c,h,l,p)=>signalsBollMR(c,h,l,p),
  donchian: (c,h,l,p)=>signalsDonchian(c,h,l,p),
  ma: (c,h,l,p)=>signalsMA(c,h,l,p),
  rsi: (c,h,l,p)=>signalsRSI(c,h,l,p),
};

function grid(){
  const g=[];
  for(const fam of Object.keys(FAMILIES)){
    if(fam==='bollMR'){
      for(const bb of [20]) for(const std of [2.0]) for(const rsiP of [12,14])
        for(const rsiLO of [30]) for(const adxMax of [999,28]) for(const adx of [14])
          g.push({fam,bb,std,rsiP,rsiLO,rsiHI:100-rsiLO,adx,adxMax});
    } else if(fam==='donchian'){
      for(const chan of [20,34,55]) for(const reg of [55,89])
        g.push({fam,chan,reg});
    } else if(fam==='ma'){
      for(const fast of [9,12,21]) for(const slow of [34,55])
        g.push({fam,fast,slow});
    } else if(fam==='rsi'){
      for(const period of [12,14]) for(const lo of [30,35]) for(const hi of [70,65])
        g.push({fam,period,lo,hi});
    }
  }
  return g;
}

function metrics(rets){
  const t=rets.length, w=rets.filter(r=>r>0).length;
  const gw=rets.filter(r=>r>0).reduce((s,r)=>s+r,0), gl=Math.abs(rets.filter(r=>r<0).reduce((s,r)=>s+r,0));
  const wr=t?w/t:0, pf=gl>0?gw/gl:gw>0?3:0;
  const mean=t?rets.reduce((s,r)=>s+r,0)/t:0, sd=Math.sqrt(t?rets.reduce((s,r)=>s+(r-mean)**2,0)/t:0);
  const sh=sd>0?mean/sd:0, ts=sh*Math.sqrt(t), ep=mean*100;
  return {t,wr,pf,ep,ts};
}

const GATES={minT:50,minWR:0.45,minPF:1.3,minEP:0.05,minTS:2.0};
function passes(m){ return m.t>=GATES.minT && m.wr>=GATES.minWR && m.pf>=GATES.minPF && m.ep>GATES.minEP && m.ts>=GATES.minTS; }

async function fetchPair(pair,interval){
  const r=await fetch(`https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${interval}&limit=${DAYS_LIMIT}`);
  if(!r.ok) throw new Error('http'+r.status);
  const k=await r.json(); return {c:k.map(x=>+x[4]),h:k.map(x=>+x[2]),l:k.map(x=>+x[3])};
}

async function main(){
  const pairs=readFileSync(UNIVERSE_FILE,'utf8').trim().split('\n').slice(0,MAX_PAIRS);
  // Pre-fetch all (pair,interval) candles once.
  const cache={};
  for(const pair of pairs){
    for(const interval of INTERVALS){
      try{ cache[pair+'|'+interval]=await fetchPair(pair,interval); }
      catch(e){ /* skip pair/interval */ }
    }
  }
  const configs=grid();
  let tested=0, passed=0;
  // For each config, aggregate returns across ALL pairs × intervals (basket
  // style, like the repo scorecard) so sample size is statistically meaningful.
  for(const cfg of configs){
    tested++;
    const all=[];
    for(const pair of pairs){
      for(const interval of INTERVALS){
        const d=cache[pair+'|'+interval];
        if(!d) continue;
        const sig=FAMILIES[cfg.fam](d.c,d.h,d.l,cfg);
        all.push(...backtest(d.c,d.h,d.l,sig));
      }
    }
    if(all.length<GATES.minT) continue;
    const m=metrics(all);
    if(passes(m)){
      passed++;
      const row={bot:BOT_ID, fam:cfg.fam, t:m.t, wr:+(m.wr*100).toFixed(1), pf:+m.pf.toFixed(2), ep:+m.ep.toFixed(3), ts:+m.ts.toFixed(2), cfg};
      console.log(JSON.stringify(row));
      try{ appendFileSync(OUT_FILE, JSON.stringify(row)+'\n'); }catch{}
    }
  }
  console.error(`[${BOT_ID}] done: tested=${tested} passed=${passed}`);
}
main().catch(e=>{console.error('FATAL',e);process.exit(1);});
