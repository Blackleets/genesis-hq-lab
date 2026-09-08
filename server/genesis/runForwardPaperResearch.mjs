import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const BASE=process.env.BINANCE_BASE||'https://data-api.binance.vision/api/v3';
const FEE=.0004,SLIP=.00015,FUNDING=.0001;
const CONTEXT_BARS=Number(process.env.GENESIS_FORWARD_CONTEXT_BARS||600);
const SESSIONS={ALL:h=>true,ASIA:h=>h>=0&&h<7,LONDON:h=>h>=7&&h<12,NY:h=>h>=13&&h<17,LONDON_NY:h=>h>=12&&h<16};
const arg=(n,f=null)=>{const i=process.argv.indexOf(n);return i>=0?(process.argv[i+1]??f):f;};
const round=(v,d=4)=>Number.isFinite(v)?Number(v.toFixed(d)):null;
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;
const std=a=>{if(a.length<2)return 0;const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1));};
const tfMin=tf=>tf.endsWith('m')?+tf.slice(0,-1):tf.endsWith('h')?+tf.slice(0,-1)*60:60;
async function readJson(path,fallback){try{return JSON.parse(await readFile(path,'utf8'));}catch{return fallback;}}

async function fetchContext(pair,tf){
  const all=[];let end=Date.now();
  while(all.length<CONTEXT_BARS){
    const limit=Math.min(1000,CONTEXT_BARS-all.length),r=await fetch(`${BASE}/klines?symbol=${pair}&interval=${tf}&limit=${limit}&endTime=${end}`,{signal:AbortSignal.timeout(15000)});
    if(!r.ok)throw new Error(`binance_${r.status}:${pair}:${tf}`);
    const p=await r.json();if(!Array.isArray(p)||!p.length)break;
    all.unshift(...p);const first=+p[0][0];if(!Number.isFinite(first)||p.length<limit)break;end=first-1;
  }
  const now=Date.now();
  return [...new Map(all.map(x=>[+x[0],x])).values()].sort((a,b)=>+a[0]-+b[0]).filter(r=>+r[6]<now-5000).slice(-CONTEXT_BARS);
}

function prepare(rows,periods){
  const c=rows.map(r=>+r[4]),h=rows.map(r=>+r[2]),l=rows.map(r=>+r[3]),ma=new Map(),atr=[],volRatio=[];
  for(const p of new Set([8,20,34,55,200,...periods])){const arr=[];let sum=0;for(let i=0;i<c.length;i++){sum+=c[i];if(i>=p)sum-=c[i-p];arr[i]=i>=p-1?sum/p:null;}ma.set(p,arr);}
  for(let i=0;i<c.length;i++){
    if(i<14){atr[i]=null;volRatio[i]=null;continue;}
    let tr=0;for(let j=i-13;j<=i;j++)tr+=Math.max(h[j]-l[j],Math.abs(h[j]-c[j-1]),Math.abs(l[j]-c[j-1]));atr[i]=(tr/14)/c[i];
    if(i<62){volRatio[i]=null;continue;}
    const recent=[],base=[];for(let j=i-23;j<=i;j++)recent.push(Math.log(c[j]/c[j-1]));for(let j=i-61;j<=i-24;j++)base.push(Math.log(c[j]/c[j-1]);
    const rv=std(recent),bv=std(base);volRatio[i]=bv>0?rv/bv:null;
  }
  return{c,ma,atr,volRatio};
}

function signal(spec,rows,p,i){
  if(i<210||!SESSIONS[spec.session])return null;
  const hour=new Date(+rows[i][0]).getUTCHours();if(!SESSIONS[spec.session](hour))return null;
  const c=p.c[i],prev=p.c[i-1],m8=p.ma.get(8)?.[i],m55=p.ma.get(55)?.[i],m200=p.ma.get(200)?.[i],vr=p.volRatio[i];
  if(![c,prev,m8,m55,m200,vr].every(Number.isFinite))return null;
  if(spec.family==='opening_range_breakout'){let hi=-Infinity,lo=Infinity;for(let j=i-spec.period;j<i;j++){hi=Math.max(hi,p.c[j]);lo=Math.min(lo,p.c[j]);}if(vr>1&&c>hi&&c>m55)return'LONG';if(vr>1&&c<lo&&c<m55)return'SHORT';}
  if(spec.family==='trend_pullback'){if(c>m55&&m55>m200&&prev<=p.ma.get(8)[i-1]&&c>m8&&vr>.8&&vr<1.5)return'LONG';if(c<m55&&m55<m200&&prev>=p.ma.get(8)[i-1]&&c<m8&&vr>.8&&vr<1.5)return'SHORT';}
  if(spec.family==='volatility_squeeze'){if(vr>=.75)return null;let hi=-Infinity,lo=Infinity;for(let j=i-spec.period;j<i;j++){hi=Math.max(hi,p.c[j]);lo=Math.min(lo,p.c[j]);}if(c>hi&&c>m55)return'LONG';if(c<lo&&c<m55)return'SHORT';}
  if(spec.family==='failed_breakout'){if(vr<1.15)return null;let hi=-Infinity,lo=Infinity;for(let j=i-spec.period;j<i-1;j++){hi=Math.max(hi,p.c[j]);lo=Math.min(lo,p.c[j]);}if(prev>hi&&c<hi)return'SHORT';if(prev<lo&&c>lo)return'LONG';}
  return null;
}

function closeTrade(state,row,reason,rawExit){
  const t=state.openTrade,exit=t.side==='LONG'?rawExit*(1-SLIP):rawExit*(1+SLIP),gross=t.side==='LONG'?(exit-t.entry)/t.entry:(t.entry-exit)/t.entry,heldHours=Math.max(tfMin(state.market.tf)/60,t.barsHeld*tfMin(state.market.tf)/60),net=gross-(FEE*2+FUNDING*heldHours/8);
  state.closedTrades.push({side:t.side,signalOpenTime:t.signalOpenTime,entryOpenTime:t.entryOpenTime,exitOpenTime:+row[0],entry:t.entry,exit,reason,barsHeld:t.barsHeld,netPct:net});
  state.openTrade=null;
}
function processBar(state,rows,p,i){
  const row=rows[i],open=+row[1],high=+row[2],low=+row[3],close=+row[4];
  if(state.openTrade){
    state.openTrade.barsHeld++;
    const t=state.openTrade,stopHit=t.side==='LONG'?low<=t.stop:high>=t.stop,targetHit=t.side==='LONG'?high>=t.target:low<=t.target;
    if(stopHit)closeTrade(state,row,'STOP',t.stop);else if(targetHit)closeTrade(state,row,'TARGET',t.target);else if(t.barsHeld>=state.spec.timeoutBars)closeTrade(state,row,'TIMEOUT',close);
  }
  if(!state.openTrade&&state.pendingSignal&&+row[0]>state.pendingSignal.signalOpenTime){
    const s=state.pendingSignal,entry=s.side==='LONG'?open*(1+SLIP):open*(1-SLIP),tp=Math.max(.001,s.atrPct*state.spec.targetAtr),sp=Math.max(.001,s.atrPct*state.spec.stopAtr);
    state.openTrade={side:s.side,signalOpenTime:s.signalOpenTime,entryOpenTime:+row[0],entry,target:s.side==='LONG'?entry*(1+tp):entry*(1-tp),stop:s.side==='LONG'?entry*(1-sp):entry*(1+sp),barsHeld:1};state.pendingSignal=null;
    const t=state.openTrade,stopHit=t.side==='LONG'?low<=t.stop:high>=t.stop,targetHit=t.side==='LONG'?high>=t.target:low<=t.target;
    if(stopHit)closeTrade(state,row,'STOP',t.stop);else if(targetHit)closeTrade(state,row,'TARGET',t.target);else if(t.barsHeld>=state.spec.timeoutBars)closeTrade(state,row,'TIMEOUT',close);
  }
  if(!state.openTrade&&!state.pendingSignal){const side=signal(state.spec,rows,p,i),atrPct=p.atr[i];if(side&&atrPct>0)state.pendingSignal={side,atrPct,signalOpenTime:+row[0]};}
  state.lastProcessedOpenTime=+row[0];
}

function metrics(trades){
  const p=trades.map(x=>x.netPct),wins=p.filter(x=>x>0),losses=p.filter(x=>x<0),gp=wins.reduce((s,x)=>s+x,0),gl=Math.abs(losses.reduce((s,x)=>s+x,0)),ev=p.length?mean(p):null,sd=std(p),ts=p.length>1&&sd>0&&ev!=null?ev/(sd/Math.sqrt(p.length)):null;let curve=0,peak=0,dd=0;for(const x of p){curve+=x;peak=Math.max(peak,curve);dd=Math.max(dd,peak-curve);}return{trades:p.length,expectancyBps:ev==null?null:round(ev*10000,2),profitFactor:gl>0?round(gp/gl,3):null,tStat:round(ts,3),maxDrawdownPct:round(dd*100,2)};
}
function evidenceStatus(m){if(m.trades<8)return'FORWARD_SAMPLE_BUILDING';if((m.expectancyBps??-999)>0&&(m.profitFactor??0)>=1.1)return'EARLY_FORWARD_POSITIVE';return'EARLY_FORWARD_WEAK';}

async function main(){
  const auditPath=arg('--audit','quant-evidence/edge-audit-latest.json'),ledgerPath=arg('--ledger','quant-evidence/forward-paper-ledger.json'),out=arg('--out','quant-evidence/forward-paper-latest.json'),history=arg('--history','quant-evidence/forward-paper-history.jsonl');
  const audit=JSON.parse(await readFile(auditPath,'utf8'));if(audit.paperOnly!==true||audit.liveOrders!==false||audit.executionAuthority!==false||audit.capitalEligible!==false)throw new Error('audit_boundary_unverified');
  const ledger=await readJson(ledgerPath,{version:'forward_paper_ledger_v1',paperOnly:true,liveOrders:false,executionAuthority:false,capitalEligible:false,candidates:{}});ledger.candidates=ledger.candidates??{};
  const now=new Date().toISOString();
  for(const r of audit.results??[]){if(r.status!=='PAPER_RESEARCH_CANDIDATE'||ledger.candidates[r.id])continue;ledger.candidates[r.id]={id:r.id,enrolledAt:now,sourceAuditCompletedAt:audit.completedAt??null,market:r.market,spec:r.spec,parentVariant:r.parentVariant,selectionScore:r.selectionScore,lastProcessedOpenTime:null,pendingSignal:null,openTrade:null,closedTrades:[]};}
  const grouped=new Map();for(const state of Object.values(ledger.candidates)){const k=`${state.market.pair}:${state.market.tf}`;if(!grouped.has(k))grouped.set(k,[]);grouped.get(k).push(state);}
  for(const [key,states] of grouped){const [pair,tf]=key.split(':'),rows=await fetchContext(pair,tf);if(rows.length<220)continue;const prep=prepare(rows,states.map(s=>s.spec.period));const latestOpen=+rows.at(-1)[0];for(const state of states){if(state.lastProcessedOpenTime==null){state.lastProcessedOpenTime=latestOpen;continue;}for(let i=210;i<rows.length;i++){const t=+rows[i][0];if(t<=state.lastProcessedOpenTime)continue;processBar(state,rows,prep,i);}}}
  const candidates=Object.values(ledger.candidates).map(s=>{const m=metrics(s.closedTrades);return{id:s.id,enrolledAt:s.enrolledAt,market:s.market,spec:s.spec,selectionScore:s.selectionScore,lastProcessedOpenTime:s.lastProcessedOpenTime,pendingSignal:s.pendingSignal,openTrade:s.openTrade,forward:m,evidenceStatus:evidenceStatus(m),closedTrades:s.closedTrades.slice(-20)};});
  const snapshot={ok:true,version:'forward_paper_shadow_v1',mode:'FORWARD_PAPER_RESEARCH',paperOnly:true,liveOrders:false,executionAuthority:false,capitalEligible:false,completedAt:now,methodology:{newDataOnly:true,noHistoricalBackfill:true,completedCandlesOnly:true,costs:{roundTripFeePct:FEE*2,slippagePerSidePct:SLIP,fundingPer8hPct:FUNDING},promotion:'NEVER_AUTOMATIC_TO_LIVE'},enrolled:candidates.length,openShadows:candidates.filter(x=>x.openTrade).length,candidates};
  ledger.updatedAt=now;await mkdir(dirname(out),{recursive:true});await writeFile(ledgerPath,JSON.stringify(ledger,null,2)+'\n');await writeFile(out,JSON.stringify(snapshot,null,2)+'\n');await appendFile(history,JSON.stringify(snapshot)+'\n');console.log(JSON.stringify({ok:true,enrolled:snapshot.enrolled,openShadows:snapshot.openShadows,statuses:Object.fromEntries(candidates.map(x=>[x.id,x.evidenceStatus]))}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
