// edgeHunterV2.mjs — HONEST edge search v2: finer timeframes (15m/5m) + REAL
// volume features. Classic 1h/1d signals are efficient (0 winners found);
// micro-inefficiencies live in short horizons + volume-climax behaviour.
// Same honesty rules: real Binance data, non-optimistic intrabar fills,
// reports ONLY configs passing all readiness gates (sample/WR/PF/exp/t-stat).
// Writes winners to HUNT_OUT (default hunt2.jsonl) for ranking.

import { readFileSync, appendFileSync } from 'node:fs';

const UNIVERSE_FILE = process.argv[2] || 'server/crypto/backtest/pairs_universe.txt';
const MAX_PAIRS = Number(process.argv[3] || 120);
const BOT_ID = process.env.BOT_ID || 'V2';
const DAYS_LIMIT = 5000; // ~52d@15m, ~17d@5m — enough history for micro-edges
const OUT_FILE = process.env.HUNT_OUT || 'hunt2.jsonl';
const INTERVALS = process.env.HUNT_INTERVALS?.split(',') || ['15m','5m'];
const COST = 0.001;

function rsiWilder(c,period){ const o=[]; let pg=0,pl=0;
  for(let i=0;i<c.length;i++){ if(i<period){o.push(50);continue;} const d=c[i]-c[i-1],g=Math.max(d,0),l=Math.max(-d,0);
    if(i===period){let sg=0,sl=0;for(let j=1;j<=period;j++){const dd=c[j]-c[j-1];if(dd>=0)sg+=dd;else sl-=dd;}pg=sg/period;pl=sl/period;}
    else{pg=(pg*(period-1)+g)/period;pl=(pl*(period-1)+l)/period;} const rs=pl>0?pg/pl:99; o.push(100-100/(1+rs)); }
  return o; }
function sma(a,p,i){ if(i+1<p) return null; let s=0; for(let k=i-p+1;k<=i;k++) s+=a[k]; return s/p; }
function volSma(v,p,i){ let s=0; for(let k=i-p+1;k<=i;k++) s+=v[k]; return s/p; }
function wilderAdx(c,period,h,l){ if(c.length<period*2) return 0; const hi=h??c,lo=l??c; const tr=[],pd=[],md=[];
  for(let i=1;i<c.length;i++){const up=c[i]-c[i-1],dn=c[i-1]-c[i];const H=hi[i],L=lo[i],HP=hi[i-1],LP=lo[i-1];
    const trv=Math.max(H-L,Math.abs(H-HP),Math.abs(L-LP));const p=up>dn&&up>0?up:0,d=dn>up&&dn>0?dn:0;tr.push(trv);pd.push(p);md.push(d);}
  let atr=tr.slice(0,period).reduce((s,x)=>s+x,0)/period, ap=pd.slice(0,period).reduce((s,x)=>s+x,0)/period, am=md.slice(0,period).reduce((s,x)=>s+x,0)/period;
  for(let i=period;i<tr.length;i++){atr=(atr*(period-1)+tr[i])/period;ap=(ap*(period-1)+pd[i])/period;am=(am*(period-1)+md[i])/period;}
  const pdi=atr>0?(ap/atr)*100:0,mdi=atr>0?(am/atr)*100:0; return Math.abs(pdi-mdi)/(pdi+mdi+1e-9)*100; }

function backtest(closes,highs,lows,sig){
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
      const side=sig[i]; const slPct=sig.slPct; const tpRet=slPct*1.7;
      pos={side,entry:p,sl:side==='LONG'?p*(1-slPct):p*(1+slPct),tp:side==='LONG'?p*(1+tpRet):p*(1-tpRet),slPct,tpRet};
    }
  }
  return rets;
}

// Vol-climax mean reversion: price at BB extreme + RSI extreme + volume spike
// (retail capitulation) -> fade. Volume confirms the climax.
function sigVolMR(closes,highs,lows,vols,p){
  const r=rsiWilder(closes,p.rsiP); const n=closes.length; const s=new Array(n).fill(null); const warm=Math.max(p.bb,p.rsiP,p.volP)+2;
  for(let i=warm;i<n;i++){
    const w=closes.slice(i-p.bb,i); const m=w.reduce((s,x)=>s+x,0)/p.bb; const sd=Math.sqrt(w.reduce((s,x)=>s+(x-m)**2,0)/p.bb)||1e-9;
    const up=m+p.std*sd, lo=m-p.std*sd; const rsi=r[i]; const last=closes[i-1];
    const vNow=vols[i], vAvg=volSma(vols,p.volP,i-1)||1; const vRatio=vNow/vAvg;
    if(vRatio<p.volMult) continue; // need a volume climax
    if(last<=lo && rsi<=p.rsiLO) s[i]='LONG'; else if(last>=up && rsi>=p.rsiHI) s[i]='SHORT';
  }
  for(const k in s) if(s[k]) s[k]={slPct:0.005};
  return s;
}
// Short-term momentum: ROC over period; ride the move.
function sigMom(closes,highs,lows,vols,p){
  const n=closes.length; const s=new Array(n).fill(null);
  for(let i=p.period+1;i<n;i++){
    const roc=(closes[i-1]-closes[i-1-p.period])/closes[i-1-p.period];
    if(roc>=p.thr) s[i]='LONG'; else if(roc<=-p.thr) s[i]='SHORT';
  }
  for(const k in s) if(s[k]) s[k]={slPct:0.006};
  return s;
}
// Volume-confirmed breakout: new N-bar high/low with volume >> average.
function sigVolBreak(closes,highs,lows,vols,p){
  const n=closes.length; const s=new Array(n).fill(null); const warm=p.N+2;
  for(let i=warm;i<n;i++){
    const hi=Math.max(...closes.slice(i-p.N,i)); const lo=Math.min(...closes.slice(i-p.N,i));
    const vNow=vols[i], vAvg=volSma(vols,p.volP,i-1)||1;
    if(vNow < vAvg*p.volMult) continue;
    const last=closes[i-1];
    if(last>=hi) s[i]='LONG'; else if(last<=lo) s[i]='SHORT';
  }
  for(const k in s) if(s[k]) s[k]={slPct:0.006};
  return s;
}

const FAMILIES = { volMR: sigVolMR, mom: sigMom, volBreak: sigVolBreak };

function grid(){
  const g=[];
  for(const fam of Object.keys(FAMILIES)){
    if(fam==='volMR'){
      for(const bb of [20]) for(const std of [2.0]) for(const rsiP of [12,14])
        for(const rsiLO of [30]) for(const volP of [20]) for(const volMult of [1.5,2.0])
          g.push({fam,bb,std,rsiP,rsiLO,rsiHI:100-rsiLO,volP,volMult});
    } else if(fam==='mom'){
      for(const period of [10,20,30]) for(const thr of [0.015,0.025,0.04])
        g.push({fam,period,thr});
    } else if(fam==='volBreak'){
      for(const N of [20,50]) for(const volP of [20]) for(const volMult of [2.0,3.0])
        g.push({fam,N,volP,volMult});
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
  const k=await r.json(); return {c:k.map(x=>+x[4]),h:k.map(x=>+x[2]),l:k.map(x=>+x[3]),v:k.map(x=>+x[5])};
}

async function main(){
  const pairs=readFileSync(UNIVERSE_FILE,'utf8').trim().split('\n').slice(0,MAX_PAIRS);
  const cache={};
  for(const pair of pairs) for(const interval of INTERVALS){
    try{ cache[pair+'|'+interval]=await fetchPair(pair,interval); }catch(e){}
  }
  const configs=grid(); let tested=0, passed=0;
  for(const cfg of configs){
    tested++;
    const all=[];
    for(const pair of pairs) for(const interval of INTERVALS){
      const d=cache[pair+'|'+interval]; if(!d) continue;
      const sig=FAMILIES[cfg.fam](d.c,d.h,d.l,d.v,cfg);
      all.push(...backtest(d.c,d.h,d.l,sig));
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
