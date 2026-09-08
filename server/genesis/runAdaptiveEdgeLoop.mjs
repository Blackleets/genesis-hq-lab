import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const BASE=process.env.BINANCE_BASE||'https://data-api.binance.vision/api/v3';
const MAX_BARS=Number(process.env.GENESIS_EDGE_BARS||5000);
const FEE=.0004,SLIP=.00015,FUNDING=.0001,TRAIN=.6,VALID=.8;
const SESSIONS={ALL:h=>true,LONDON:h=>h>=7&&h<12,NY:h=>h>=13&&h<17,LONDON_NY:h=>h>=12&&h<16};
const arg=(n,f=null)=>{const i=process.argv.indexOf(n);return i>=0?(process.argv[i+1]??f):f;};
const round=(v,d=4)=>Number.isFinite(v)?Number(v.toFixed(d)):null;
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;
const std=a=>{if(a.length<2)return 0;const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1));};
const tfMin=tf=>tf.endsWith('m')?+tf.slice(0,-1):tf.endsWith('h')?+tf.slice(0,-1)*60:60;

async function fetchHistory(pair,tf){
  const all=[];let end=Date.now();
  while(all.length<MAX_BARS){
    const limit=Math.min(1000,MAX_BARS-all.length);
    const r=await fetch(`${BASE}/klines?symbol=${pair}&interval=${tf}&limit=${limit}&endTime=${end}`,{signal:AbortSignal.timeout(15000)});
    if(!r.ok)throw new Error(`binance_${r.status}:${pair}:${tf}`);
    const p=await r.json();if(!Array.isArray(p)||!p.length)break;
    all.unshift(...p);const first=+p[0][0];if(!Number.isFinite(first)||p.length<limit)break;end=first-1;
    await new Promise(x=>setTimeout(x,30));
  }
  return [...new Map(all.map(x=>[+x[0],x])).values()].sort((a,b)=>+a[0]-+b[0]).slice(-MAX_BARS);
}

function prepare(rows,periods){
  const c=rows.map(r=>+r[4]),h=rows.map(r=>+r[2]),l=rows.map(r=>+r[3]);
  const ma=new Map(),atr=[],volRatio=[];
  for(const p of new Set([8,20,34,55,200,...periods])){
    const arr=[];let sum=0;
    for(let i=0;i<c.length;i++){sum+=c[i];if(i>=p)sum-=c[i-p];arr[i]=i>=p-1?sum/p:null;}
    ma.set(p,arr);
  }
  for(let i=0;i<c.length;i++){
    if(i<14){atr[i]=null;volRatio[i]=null;continue;}
    let tr=0;for(let j=i-13;j<=i;j++)tr+=Math.max(h[j]-l[j],Math.abs(h[j]-c[j-1]),Math.abs(l[j]-c[j-1]));
    atr[i]=(tr/14)/c[i];
    if(i<62){volRatio[i]=null;continue;}
    const recent=[],base=[];for(let j=i-23;j<=i;j++)recent.push(Math.log(c[j]/c[j-1]));for(let j=i-61;j<=i-24;j++)base.push(Math.log(c[j]/c[j-1]));
    const rv=std(recent),bv=std(base);volRatio[i]=bv>0?rv/bv:null;
  }
  return{c,ma,atr,volRatio};
}

function signal(spec,rows,p,i){
  if(i<210||!SESSIONS[spec.session])return null;
  const hour=new Date(+rows[i][0]).getUTCHours();if(!SESSIONS[spec.session](hour))return null;
  const c=p.c[i],prev=p.c[i-1],m8=p.ma.get(8)?.[i],m55=p.ma.get(55)?.[i],m200=p.ma.get(200)?.[i],vr=p.volRatio[i];
  if(![c,prev,m8,m55,m200,vr].every(Number.isFinite))return null;
  if(spec.family==='opening_range_breakout'){
    let hi=-Infinity,lo=Infinity;for(let j=i-spec.period;j<i;j++){hi=Math.max(hi,p.c[j]);lo=Math.min(lo,p.c[j]);}
    if(vr>1&&c>hi&&c>m55)return'LONG';if(vr>1&&c<lo&&c<m55)return'SHORT';
  }
  if(spec.family==='trend_pullback'){
    if(c>m55&&m55>m200&&prev<=p.ma.get(8)[i-1]&&c>m8&&vr>.8&&vr<1.5)return'LONG';
    if(c<m55&&m55<m200&&prev>=p.ma.get(8)[i-1]&&c<m8&&vr>.8&&vr<1.5)return'SHORT';
  }
  if(spec.family==='volatility_squeeze'){
    if(vr>=.75)return null;let hi=-Infinity,lo=Infinity;for(let j=i-spec.period;j<i;j++){hi=Math.max(hi,p.c[j]);lo=Math.min(lo,p.c[j]);}
    if(c>hi&&c>m55)return'LONG';if(c<lo&&c<m55)return'SHORT';
  }
  if(spec.family==='failed_breakout'){
    if(vr<1.15)return null;let hi=-Infinity,lo=Infinity;for(let j=i-spec.period;j<i-1;j++){hi=Math.max(hi,p.c[j]);lo=Math.min(lo,p.c[j]);}
    if(prev>hi&&c<hi)return'SHORT';if(prev<lo&&c>lo)return'LONG';
  }
  return null;
}

function simulate(rows,prep,market,spec){
  const trades=[];let last=-1;const mins=tfMin(market.tf);
  for(let i=210;i<rows.length-2;i++){
    if(i<=last)continue;const side=signal(spec,rows,prep,i);if(!side)continue;const a=prep.atr[i];if(!(a>0))continue;
    const ei=i+1,re=+rows[ei][1],entry=side==='LONG'?re*(1+SLIP):re*(1-SLIP);
    const tp=Math.max(.001,a*spec.targetAtr),sp=Math.max(.001,a*spec.stopAtr),target=side==='LONG'?entry*(1+tp):entry*(1-tp),stop=side==='LONG'?entry*(1-sp):entry*(1+sp);
    let xi=Math.min(rows.length-1,ei+spec.timeoutBars),rx=+rows[xi][4];
    for(let j=ei;j<=xi;j++){const hh=+rows[j][2],ll=+rows[j][3],sh=side==='LONG'?ll<=stop:hh>=stop,th=side==='LONG'?hh>=target:ll<=target;if(sh){xi=j;rx=stop;break;}if(th){xi=j;rx=target;break;}}
    const exit=side==='LONG'?rx*(1-SLIP):rx*(1+SLIP),gross=side==='LONG'?(exit-entry)/entry:(entry-exit)/entry,held=Math.max(mins/60,(xi-ei+1)*mins/60),net=gross-(FEE*2+FUNDING*held/8);
    trades.push({relativeIndex:ei/rows.length,netPct:net});last=xi;
  }
  return trades;
}

function metrics(t){
  const p=t.map(x=>x.netPct),wins=p.filter(x=>x>0),losses=p.filter(x=>x<0),gp=wins.reduce((s,x)=>s+x,0),gl=Math.abs(losses.reduce((s,x)=>s+x,0)),ev=p.length?mean(p):null,sd=std(p),ts=p.length>1&&sd>0&&ev!=null?ev/(sd/Math.sqrt(p.length)):null;
  let curve=0,peak=0,dd=0;for(const x of p){curve+=x;peak=Math.max(peak,curve);dd=Math.max(dd,peak-curve);}
  return{trades:p.length,expectancyBps:ev==null?null:round(ev*10000,2),profitFactor:gl>0?round(gp/gl,3):null,tStat:round(ts,3),maxDrawdownPct:round(dd*100,2)};
}
function walk(tr){const folds=[[0,.2],[.2,.4],[.4,.6],[.6,.8]].map(([s,e])=>metrics(tr.filter(x=>x.relativeIndex>=s&&x.relativeIndex<e)));const positiveFolds=folds.filter(m=>m.trades>=4&&(m.expectancyBps??-999)>0&&(m.profitFactor??0)>=1).length;return{positiveFolds,requiredPositiveFolds:3,pass:positiveFolds>=3};}
function researchGate(a,b,w){return a.trades>=20&&b.trades>=8&&(a.expectancyBps??-999)>0&&(b.expectancyBps??-999)>0&&(a.profitFactor??0)>=1.05&&(b.profitFactor??0)>=1.15&&w.pass;}
function selectionScore(a,b,w){return round(Math.max(-50,Math.min(50,a.expectancyBps??-50))*.25+Math.max(-50,Math.min(80,b.expectancyBps??-50))*.55+Math.max(0,((b.profitFactor??0)-1)*20)+(w.positiveFolds??0)*5,2);}

async function main(){
  const queuePath=arg('--queue','quant-evidence/edge-hypotheses-latest.json'),out=arg('--out','quant-evidence/edge-adaptive-latest.json'),history=arg('--history','quant-evidence/edge-adaptive-history.jsonl');
  const q=JSON.parse(await readFile(queuePath,'utf8'));
  if(q.paperOnly!==true||q.liveOrders!==false||q.executionAuthority!==false||q.capitalEligible!==false)throw new Error('queue_boundary_unverified');
  const queue=(q.queue??[]).filter(x=>['P0','P1'].includes(x.priority)).slice(0,24);if(!queue.length)throw new Error('adaptive_queue_empty');
  const keys=[...new Set(queue.map(x=>`${x.market.pair}:${x.market.tf}`))],datasets=new Map();
  for(const key of keys){const [pair,tf]=key.split(':');const items=queue.filter(x=>x.market.pair===pair&&x.market.tf===tf),periods=items.map(x=>x.spec.period),rows=await fetchHistory(pair,tf);datasets.set(key,{rows,prep:prepare(rows,periods),market:{pair,tf}});}
  const results=[];
  for(const item of queue){const d=datasets.get(`${item.market.pair}:${item.market.tf}`),tr=simulate(d.rows,d.prep,d.market,item.spec),train=metrics(tr.filter(x=>x.relativeIndex<TRAIN)),validation=metrics(tr.filter(x=>x.relativeIndex>=TRAIN&&x.relativeIndex<VALID)),wf=walk(tr),pass=researchGate(train,validation,wf),score=selectionScore(train,validation,wf);results.push({id:item.id,role:item.role??'MUTATION',parentVariant:item.parentVariant,priority:item.priority,market:item.market,spec:item.spec,researchStatus:pass?'PROMOTABLE_TO_ONE_SHOT_AUDIT':'REJECT',selectionScore:score,train,validation,walkForward:wf});}
  results.sort((a,b)=>b.selectionScore-a.selectionScore);
  const promotable=results.filter(x=>x.role==='MUTATION'&&x.researchStatus==='PROMOTABLE_TO_ONE_SHOT_AUDIT');
  const controls=results.filter(x=>x.role==='CONTROL');
  const snapshot={ok:true,version:'adaptive_edge_loop_v2_controls',mode:'RESEARCH_ONLY',paperOnly:true,liveOrders:false,executionAuthority:false,capitalEligible:false,completedAt:new Date().toISOString(),methodology:{selectionUsesHoldout:false,selectionInputs:['train','validation','walkForward'],holdoutPolicy:'ONE_SHOT_AUDIT_ONLY',parentControls:true,barsPerMarket:MAX_BARS},sourceQueueCompletedAt:q.completedAt??null,tested:results.length,controls:controls.length,promotableToAudit:promotable.length,verdict:promotable.length?'AUDIT_CANDIDATE_FOUND':'NO_ADAPTIVE_EDGE_FOUND',bestMutation:results.find(x=>x.role==='MUTATION')??null,control:controls[0]??null,auditQueue:promotable.slice(0,3).map(x=>({id:x.id,market:x.market,spec:x.spec,parentVariant:x.parentVariant,selectionScore:x.selectionScore,reason:'Passed train+validation+walk-forward without consulting holdout.'})),top:results.slice(0,12)};
  await mkdir(dirname(out),{recursive:true});await writeFile(out,JSON.stringify(snapshot,null,2)+'\n');await appendFile(history,JSON.stringify(snapshot)+'\n');
  console.log(JSON.stringify({ok:true,tested:snapshot.tested,controls:snapshot.controls,promotableToAudit:snapshot.promotableToAudit,verdict:snapshot.verdict,best:snapshot.bestMutation?.id??null}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
