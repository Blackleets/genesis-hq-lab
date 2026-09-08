import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const VERSION = 'edge_factory_v1';
const BASE = process.env.BINANCE_BASE || 'https://data-api.binance.vision/api/v3';
const MAX_BARS = Number(process.env.GENESIS_EDGE_BARS || 6000);
const PAGE_LIMIT = 1000;
const FEE_PER_SIDE = 0.0004;
const SLIPPAGE_PER_SIDE = 0.00015;
const FUNDING_8H = 0.0001;
const TRAIN_END = 0.60;
const VALID_END = 0.80;

const MARKETS = [
  { pair: 'BTCUSDT', tf: '15m' }, { pair: 'ETHUSDT', tf: '15m' }, { pair: 'SOLUSDT', tf: '15m' },
  { pair: 'BTCUSDT', tf: '1h' }, { pair: 'ETHUSDT', tf: '1h' }, { pair: 'SOLUSDT', tf: '1h' },
];

const SESSIONS = {
  ALL: () => true,
  LONDON: h => h >= 7 && h < 12,
  NY: h => h >= 13 && h < 17,
  LONDON_NY: h => h >= 12 && h < 16,
};

const FAMILIES = [
  { id: 'trend_pullback', periods: [20, 34, 55], targets: [1.5, 2], stops: [0.75, 1], timeouts: [8, 16] },
  { id: 'opening_range_breakout', periods: [12, 20], targets: [1.5, 2], stops: [0.75, 1], timeouts: [8] },
  { id: 'volatility_squeeze', periods: [20, 34], targets: [1.5, 2], stops: [0.75, 1], timeouts: [8, 16] },
  { id: 'failed_breakout', periods: [20, 34], targets: [1, 1.5], stops: [0.75, 1], timeouts: [8] },
];

const round = (v, d = 6) => Number.isFinite(v) ? Number(v.toFixed(d)) : null;
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const std = a => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const tfMinutes = tf => { const m = /^(\d+)([mhd])$/.exec(tf); if (!m) return 60; const n = Number(m[1]); return m[2] === 'm' ? n : m[2] === 'h' ? n * 60 : n * 1440; };
function arg(name, fallback = null) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] ?? fallback : fallback; }

async function fetchHistory(pair, tf) {
  const all = []; let endTime = Date.now();
  while (all.length < MAX_BARS) {
    const limit = Math.min(PAGE_LIMIT, MAX_BARS - all.length);
    const url = `${BASE}/klines?symbol=${pair}&interval=${tf}&limit=${limit}&endTime=${endTime}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`binance_${res.status}:${pair}:${tf}`);
    const page = await res.json(); if (!Array.isArray(page) || !page.length) break;
    all.unshift(...page); const first = Number(page[0]?.[0]); if (!Number.isFinite(first) || page.length < limit) break;
    endTime = first - 1; await new Promise(r => setTimeout(r, 50));
  }
  const rows = [...new Map(all.map(r => [Number(r[0]), r])).values()].sort((a,b)=>Number(a[0])-Number(b[0])).slice(-MAX_BARS);
  if (rows.length < 1000) throw new Error(`insufficient_history:${pair}:${tf}`);
  return rows;
}

function sma(c, i, p) { if (i < p - 1) return null; let s = 0; for (let j=i-p+1;j<=i;j++) s += c[j]; return s/p; }
function atrPct(rows, i, p=14) { if (i < p+1) return null; let s=0; for(let j=i-p+1;j<=i;j++){const h=+rows[j][2],l=+rows[j][3],pc=+rows[j-1][4]; if(![h,l,pc].every(Number.isFinite)) return null; s+=Math.max(h-l,Math.abs(h-pc),Math.abs(l-pc));} const c=+rows[i][4]; return c>0?(s/p)/c:null; }
function realizedVol(closes, i, p=24) { if(i<p) return null; const r=[]; for(let j=i-p+1;j<=i;j++){const a=closes[j-1],b=closes[j]; if(a>0&&b>0) r.push(Math.log(b/a));} return r.length ? std(r) : null; }
function percentile(values, x) { if (!values.length || !Number.isFinite(x)) return null; const sorted=[...values].sort((a,b)=>a-b); let n=0; while(n<sorted.length&&sorted[n]<=x)n++; return n/sorted.length; }

function signal(family, rows, closes, i, p, session) {
  if (i < Math.max(80,p+3)) return null;
  const hour = new Date(Number(rows[i][0])).getUTCHours(); if (!SESSIONS[session](hour)) return null;
  const c=closes[i], ma=sma(closes,i,p), ma55=sma(closes,i,55), ma200=sma(closes,i,Math.min(200,i+1));
  if (![c,ma,ma55,ma200].every(Number.isFinite)) return null;
  const v=realizedVol(closes,i,24); const hist=[]; for(let j=Math.max(30,i-240);j<i;j++){const q=realizedVol(closes,j,24); if(Number.isFinite(q)) hist.push(q);} const vp=percentile(hist,v);
  if (family === 'trend_pullback') {
    const prev=closes[i-1], fast=sma(closes,i,8); if(!Number.isFinite(fast)) return null;
    if(c>ma55&&ma55>ma200&&prev<=fast&&c>fast&&vp!=null&&vp>0.35&&vp<0.9) return 'LONG';
    if(c<ma55&&ma55<ma200&&prev>=fast&&c<fast&&vp!=null&&vp>0.35&&vp<0.9) return 'SHORT';
  }
  if (family === 'opening_range_breakout') {
    let hi=-Infinity,lo=Infinity; for(let j=i-p;j<i;j++){hi=Math.max(hi,closes[j]);lo=Math.min(lo,closes[j]);}
    if(vp!=null&&vp>=0.45&&c>hi&&c>ma55) return 'LONG'; if(vp!=null&&vp>=0.45&&c<lo&&c<ma55) return 'SHORT';
  }
  if (family === 'volatility_squeeze') {
    if(vp==null||vp>0.35) return null; let hi=-Infinity,lo=Infinity; for(let j=i-p;j<i;j++){hi=Math.max(hi,closes[j]);lo=Math.min(lo,closes[j]);}
    const prevV=realizedVol(closes,i-1,24); if(!Number.isFinite(prevV)) return null;
    if(c>hi&&c>ma55) return 'LONG'; if(c<lo&&c<ma55) return 'SHORT';
  }
  if (family === 'failed_breakout') {
    let hi=-Infinity,lo=Infinity; for(let j=i-p;j<i-1;j++){hi=Math.max(hi,closes[j]);lo=Math.min(lo,closes[j]);}
    const prev=closes[i-1]; if(prev>hi&&c<hi&&vp!=null&&vp>0.6) return 'SHORT'; if(prev<lo&&c>lo&&vp!=null&&vp>0.6) return 'LONG';
  }
  return null;
}

function simulate(rows, market, candidate) {
  const closes=rows.map(r=>+r[4]); const minutes=tfMinutes(market.tf); const trades=[]; let lastExit=-1;
  for(let i=80;i<rows.length-2;i++){
    if(i<=lastExit) continue; const side=signal(candidate.family,rows,closes,i,candidate.period,candidate.session); if(!side) continue;
    const a=atrPct(rows,i); if(!Number.isFinite(a)||a<=0) continue; const entryIndex=i+1, rawEntry=+rows[entryIndex][1]; if(!(rawEntry>0)) continue;
    const entry=side==='LONG'?rawEntry*(1+SLIPPAGE_PER_SIDE):rawEntry*(1-SLIPPAGE_PER_SIDE);
    const targetPct=Math.max(.001,a*candidate.targetAtr), stopPct=Math.max(.001,a*candidate.stopAtr);
    const target=side==='LONG'?entry*(1+targetPct):entry*(1-targetPct), stop=side==='LONG'?entry*(1-stopPct):entry*(1+stopPct);
    let exitIndex=Math.min(rows.length-1,entryIndex+candidate.timeoutBars), rawExit=+rows[exitIndex][4], reason='timeout';
    for(let j=entryIndex;j<=exitIndex;j++){const h=+rows[j][2],l=+rows[j][3]; const sh=side==='LONG'?l<=stop:h>=stop, th=side==='LONG'?h>=target:l<=target; if(sh){exitIndex=j;rawExit=stop;reason='stop';break;} if(th){exitIndex=j;rawExit=target;reason='target';break;}}
    const exit=side==='LONG'?rawExit*(1-SLIPPAGE_PER_SIDE):rawExit*(1+SLIPPAGE_PER_SIDE); const gross=side==='LONG'?(exit-entry)/entry:(entry-exit)/entry;
    const held=Math.max(minutes/60,(exitIndex-entryIndex+1)*minutes/60), costs=FEE_PER_SIDE*2+FUNDING_8H*held/8;
    trades.push({ relativeIndex:entryIndex/rows.length, netPct:gross-costs, side, openedAt:+rows[entryIndex][0], reason }); lastExit=exitIndex;
  }
  return trades;
}

function metrics(trades){const p=trades.map(t=>t.netPct),wins=p.filter(x=>x>0),losses=p.filter(x=>x<0),gp=wins.reduce((s,x)=>s+x,0),gl=Math.abs(losses.reduce((s,x)=>s+x,0)),ev=p.length?mean(p):null,sd=std(p),t=p.length>=2&&sd>0&&ev!=null?ev/(sd/Math.sqrt(p.length)):null;let curve=0,peak=0,dd=0;for(const x of p){curve+=x;peak=Math.max(peak,curve);dd=Math.max(dd,peak-curve);}return{trades:p.length,winRate:p.length?round(wins.length/p.length,4):null,netReturnPct:round(p.reduce((s,x)=>s+x,0)*100,4),expectancyBps:ev==null?null:round(ev*10000,3),profitFactor:gl>0?round(gp/gl,4):null,tStat:round(t,4),maxDrawdownPct:round(dd*100,4)};}
function wf(trades){const folds=[[0,.2],[.2,.4],[.4,.6],[.6,.8]].map(([s,e],i)=>{const m=metrics(trades.filter(t=>t.relativeIndex>=s&&t.relativeIndex<e));return{fold:i+1,pass:m.trades>=5&&(m.expectancyBps??-999)>0&&(m.profitFactor??0)>=1,...m};});return{positiveFolds:folds.filter(x=>x.pass).length,requiredPositiveFolds:3,pass:folds.filter(x=>x.pass).length>=3,folds};}
function classify(train,valid,holdout,walk){const paper=train.trades>=25&&valid.trades>=10&&holdout.trades>=10&&(valid.expectancyBps??-999)>0&&(holdout.expectancyBps??-999)>0&&(valid.profitFactor??0)>=1.15&&(holdout.profitFactor??0)>=1.1&&(holdout.tStat??-999)>=.75&&holdout.maxDrawdownPct<=12&&walk.pass;if(paper)return'PAPER_CANDIDATE';const interesting=train.trades>=20&&valid.trades>=8&&(valid.expectancyBps??-999)>0&&(valid.profitFactor??0)>=1.05;if(interesting)return'INTERESTING';return'DEAD';}
function grid(){const out=[];for(const f of FAMILIES)for(const period of f.periods)for(const targetAtr of f.targets)for(const stopAtr of f.stops)for(const timeoutBars of f.timeouts)for(const session of ['ALL','LONDON','NY','LONDON_NY'])out.push({family:f.id,period,targetAtr,stopAtr,timeoutBars,session});return out;}
async function readFailureMemory(path){try{const txt=await readFile(path,'utf8');const lines=txt.trim().split('\n').filter(Boolean).slice(-3).map(x=>JSON.parse(x));const map=new Map();for(const snap of lines)for(const r of snap.results??[]){const key=r.hypothesisKey;if(r.status==='DEAD')map.set(key,(map.get(key)||0)+1);}return map;}catch{return new Map();}}

async function main(){const startedAt=new Date().toISOString(),outPath=arg('--out','quant-evidence/edge-factory-latest.json'),historyPath=arg('--history','quant-evidence/edge-factory-history.jsonl');const failureMemory=await readFailureMemory(historyPath);const datasets={};for(const market of MARKETS){const rows=await fetchHistory(market.pair,market.tf);datasets[`${market.pair}:${market.tf}`]={market,rows};}
  const results=[];for(const candidate of grid())for(const {market,rows} of Object.values(datasets)){const hypothesisKey=`${candidate.family}:${market.pair}:${market.tf}:${candidate.session}`;const failureStreak=failureMemory.get(hypothesisKey)||0;if(failureStreak>=3){results.push({hypothesisKey,status:'KILLED',failureStreak,market,candidate});continue;}const trades=simulate(rows,market,candidate),train=metrics(trades.filter(t=>t.relativeIndex<TRAIN_END)),validation=metrics(trades.filter(t=>t.relativeIndex>=TRAIN_END&&t.relativeIndex<VALID_END)),holdout=metrics(trades.filter(t=>t.relativeIndex>=VALID_END)),walkForward=wf(trades),status=classify(train,validation,holdout,walkForward);results.push({hypothesisKey,status,failureStreak:status==='DEAD'?failureStreak+1:0,market,candidate,train,validation,holdout,walkForward});}
  const rank={PAPER_CANDIDATE:3,INTERESTING:2,DEAD:1,KILLED:0};results.sort((a,b)=>(rank[b.status]-rank[a.status])||((b.holdout?.expectancyBps??-999)-(a.holdout?.expectancyBps??-999)));const paper=results.filter(r=>r.status==='PAPER_CANDIDATE'),interesting=results.filter(r=>r.status==='INTERESTING');const nextGeneration=interesting.slice(0,12).map(r=>({parent:r.hypothesisKey,mutation:`Keep ${r.candidate.family}/${r.market.pair}/${r.market.tf}/${r.candidate.session}; tighten period around ${r.candidate.period} and reduce timeout from ${r.candidate.timeoutBars} if trade count remains sufficient.`}));
  const snapshot={ok:true,version:VERSION,mode:'RESEARCH_ONLY',paperOnly:true,liveOrders:false,executionAuthority:false,capitalEligible:false,startedAt,completedAt:new Date().toISOString(),methodology:{barsPerMarket:MAX_BARS,families:FAMILIES.map(f=>f.id),sessions:Object.keys(SESSIONS),killAfterFailures:3,costs:{feePerSide:FEE_PER_SIDE,slippagePerSide:SLIPPAGE_PER_SIDE,funding8h:FUNDING_8H}},tested:results.filter(r=>r.status!=='KILLED').length,killed:results.filter(r=>r.status==='KILLED').length,interesting:interesting.length,paperCandidates:paper.length,verdict:paper.length?'PAPER_CANDIDATE_FOUND':interesting.length?'INTERESTING_EDGE_FOUND':'NO_EDGE_FOUND',top:results.filter(r=>r.status!=='KILLED').slice(0,12),nextGeneration};await mkdir(dirname(outPath),{recursive:true});await writeFile(outPath,JSON.stringify(snapshot,null,2)+'\n');await mkdir(dirname(historyPath),{recursive:true});await appendFile(historyPath,JSON.stringify({...snapshot,results:results.map(r=>({hypothesisKey:r.hypothesisKey,status:r.status}))})+'\n');console.log(JSON.stringify({ok:true,verdict:snapshot.verdict,tested:snapshot.tested,interesting:snapshot.interesting,paperCandidates:snapshot.paperCandidates,killed:snapshot.killed}));}
main().catch(e=>{console.error(e);process.exitCode=1;});