// validateBollingerMR.mjs — mirrors the ENGINE's bollingerMR backtest with the
// REAL optimized config from realValidation.mjs (bb20/2, rsi12/28, adx22, 4h).
// Uses intrabar TP/SL fills (high/low touch) like the validated module.
const PAIRS = ['SOLUSDT','ETHUSDT','DOGEUSDT','ADAUSDT','AVAXUSDT','LINKUSDT','LTCUSDT','DOTUSDT','NEARUSDT','ARBUSDT','OPUSDT','SUIUSDT','TIAUSDT','SEIUSDT','INJUSDT','FILUSDT','WIFUSDT','PEPEUSDT','XLMUSDT','ALGOUSDT','SANDUSDT','APTUSDT','BNBUSDT'];
const INTERVAL='4h', BB=20, STD=2.0, RSIP=12, RSIOS=28, RSIOB=70, ADXP=14, ADXMAX=22, STOP=0.005, RMULT=1.7, COST=0.001, LIM=2000;
const TP = STOP*RMULT;

function wilderAdx(closes, period, highs, lows){
  if(closes.length<period*2) return 0;
  const hi=highs??closes, lo=lows??closes; const trE=[],pdE=[],mdE=[];
  for(let i=1;i<closes.length;i++){ const up=closes[i]-closes[i-1],down=closes[i-1]-closes[i];
    const h=hi[i],l=lo[i],hp=hi[i-1],lp=lo[i-1]; const trv=Math.max(h-l,Math.abs(h-hp),Math.abs(l-lp));
    const pd=up>down&&up>0?up:0, md=down>up&&down>0?down:0; trE.push(trv);pdE.push(pd);mdE.push(md); }
  let atr=trE.slice(0,period).reduce((s,x)=>s+x,0)/period, apd=pdE.slice(0,period).reduce((s,x)=>s+x,0)/period, amd=mdE.slice(0,period).reduce((s,x)=>s+x,0)/period;
  for(let i=period;i<trE.length;i++){ atr=(atr*(period-1)+trE[i])/period; apd=(apd*(period-1)+pdE[i])/period; amd=(amd*(period-1)+mdE[i])/period; }
  const pdi=atr>0?(apd/atr)*100:0, mdi=atr>0?(amd/atr)*100:0; return (Math.abs(pdi-mdi)/(pdi+mdi+1e-9))*100;
}
function rsiWilder(closes, period){
  const out=[]; let prevAvgG=0,prevAvgL=0;
  for(let i=0;i<closes.length;i++){
    if(i<period){ out.push(50); continue; }
    const d=closes[i]-closes[i-1]; const g=Math.max(d,0), l=Math.max(-d,0);
    if(i===period){ let sg=0,sl=0; for(let j=1;j<=period;j++){ const dd=closes[j]-closes[j-1]; if(dd>=0)sg+=dd; else sl-=dd; } prevAvgG=sg/period; prevAvgL=sl/period; }
    else { prevAvgG=(prevAvgG*(period-1)+g)/period; prevAvgL=(prevAvgL*(period-1)+l)/period; }
    const rs=prevAvgL>0?prevAvgG/prevAvgL:99; out.push(100-100/(1+rs));
  }
  return out;
}
function backtest(closes, highs, lows){
  const rsi=rsiWilder(closes,RSIP); const rets=[]; const warm=Math.max(BB,ADXP)+2;
  for(let i=warm;i<closes.length;i++){
    const w=closes.slice(i-BB,i); const m=w.reduce((s,x)=>s+x,0)/BB; const sd=Math.sqrt(w.reduce((s,x)=>s+(x-m)**2,0)/BB)||1e-9;
    const up=m+STD*sd, lo=m-STD*sd; const r=rsi[i]; const a=wilderAdx(closes.slice(0,i+1),ADXP,highs?.slice(0,i+1),lows?.slice(0,i+1));
    if(a>ADXMAX) continue;
    const last=closes[i-1]; let side=null;
    if(last<=lo && r<=RSIOS) side='LONG'; else if(last>=up && r>=RSIOB) side='SHORT';
    if(!side) continue;
    const entry=closes[i]; if(!entry||entry<=0) continue;
    const tpHit=side==='LONG'?entry+TP*entry:entry-TP*entry, slHit=side==='LONG'?entry-STOP*entry:entry+STOP*entry;
    let ex=null;
    for(let j=i+1;j<closes.length;j++){ const h=highs[j],l=lows[j];
      if(side==='LONG'){ if(h>=tpHit){ex=TP;break;} if(l<=slHit){ex=-STOP;break;} }
      else { if(l<=tpHit){ex=TP;break;} if(h>=slHit){ex=-STOP;break;} } }
    if(ex==null){ const pr=closes[closes.length-1]; ex=side==='LONG'?(pr-entry)/entry:(entry-pr)/entry; }
    rets.push(ex-COST);
  }
  return rets;
}
async function main(){
  const all=[];
  for(const p of PAIRS){
    try{ const r=await fetch(`https://api.binance.com/api/v3/klines?symbol=${p}&interval=${INTERVAL}&limit=${LIM}`);
      const k=await r.json(); const c=k.map(x=>+x[4]),h=k.map(x=>+x[2]),l=k.map(x=>+x[3]);
      const ret=backtest(c,h,l); all.push(...ret); console.log(`${p}: ${ret.length}t`);
    }catch(e){ console.log(`${p}: ERR ${e.message}`); }
  }
  const t=all.length,w=all.filter(r=>r>0).length;
  const gw=all.filter(r=>r>0).reduce((s,r)=>s+r,0),gl=Math.abs(all.filter(r=>r<0).reduce((s,r)=>s+r,0));
  const wr=t?w/t:0,pf=gl>0?gw/gl:gw>0?3:0; const mean=t?all.reduce((s,r)=>s+r,0)/t:0;
  const std=Math.sqrt(t?all.reduce((s,r)=>s+(r-mean)**2,0)/t:0); const sh=std>0?mean/std:0,ts=sh*Math.sqrt(t),ep=mean*100;
  console.log(`\n=== bollingerMR REAL config 4h LIM${LIM} (${t}t) ===`);
  console.log(`WR ${(wr*100).toFixed(1)}% (≥45) | PF ${pf.toFixed(2)} (≥1.3) | exp ${ep.toFixed(3)}% (>0.05) | tstat ${ts.toFixed(2)} (≥2.0)`);
  console.log((t>=50&&wr>=0.45&&pf>=1.3&&ep>0.05&&ts>=2.0)?'>>> SCORECARD: GO':'>>> SCORECARD: NO_GO');
}
main();
