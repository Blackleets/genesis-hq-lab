// RESEARCH_ONLY positioning-aware edge discovery.
// Fail-closed: never ranks until durable data-quality cohort is ready.

import fs from 'node:fs';
import path from 'node:path';

const VERSION = 'positioning_edge_factory_v1';

function finite(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function mean(xs) { return xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : null; }
function std(xs) { if (xs.length < 2) return null; const m=mean(xs); return Math.sqrt(xs.reduce((s,x)=>s+(x-m)**2,0)/(xs.length-1)); }
function metrics(returnsBps=[]) {
  if (!returnsBps.length) return { trades:0, expectancyBps:null, profitFactor:null, tStat:null, maxDrawdownPct:null };
  const wins=returnsBps.filter(x=>x>0), losses=returnsBps.filter(x=>x<0);
  const grossWin=wins.reduce((a,b)=>a+b,0), grossLoss=Math.abs(losses.reduce((a,b)=>a+b,0));
  const m=mean(returnsBps), s=std(returnsBps);
  let equity=0, peak=0, maxDd=0;
  for (const r of returnsBps) { equity += r/100; peak=Math.max(peak,equity); maxDd=Math.max(maxDd,peak-equity); }
  return {
    trades: returnsBps.length,
    expectancyBps: m,
    profitFactor: grossLoss>0 ? grossWin/grossLoss : grossWin>0 ? Infinity : null,
    tStat: s && s>0 ? m/(s/Math.sqrt(returnsBps.length)) : null,
    maxDrawdownPct: maxDd,
  };
}
function readJson(p){ return JSON.parse(fs.readFileSync(p,'utf8')); }
function readJsonl(p){ if(!fs.existsSync(p)) return []; return fs.readFileSync(p,'utf8').split('\n').filter(Boolean).map(JSON.parse); }
function capturedMs(r){ const x=Date.parse(r?.capturedAt); return Number.isFinite(x)?x:null; }
function eligibleRows(rows){ return rows.filter(r=>r?.mode==='RESEARCH_ONLY'&&r?.provider==='okx_public_market_data'&&r?.schemaVersion===4&&r?.crossCapture?.available===true).sort((a,b)=>capturedMs(a)-capturedMs(b)); }

const FAMILIES = [
  {
    id:'funding_oi_taker_reversal',
    description:'funding extreme × OI expansion × taker reversal',
    signal:r=> Math.abs(finite(r.positioning?.fundingRateNow)??0)>=0.0001 && (finite(r.crossCapture?.oiChangePct)??0)>0 && Math.abs(finite(r.crossCapture?.takerBuySellRatioDelta)??0)>=0.1,
    direction:r=> (finite(r.crossCapture?.takerBuySellRatioDelta)??0)<0 ? -1 : 1,
  },
  {
    id:'funding_price_disagreement',
    description:'funding sign disagrees with recent perp return',
    signal:r=> {
      const f=finite(r.positioning?.fundingRateNow), ret=finite(r.crossCapture?.perpReturnBps); return f!==null&&ret!==null&&Math.abs(f)>=0.00005&&Math.abs(ret)>=5&&Math.sign(f)===Math.sign(ret);
    },
    direction:r=> -Math.sign(finite(r.crossCapture?.perpReturnBps)??0),
  },
  {
    id:'oi_shock_failed_continuation',
    description:'OI expansion with price/taker divergence',
    signal:r=> (finite(r.crossCapture?.oiChangePct)??0)>0.15 && Math.abs(finite(r.crossCapture?.perpReturnBps)??0)>=5 && Math.sign(finite(r.crossCapture?.perpReturnBps)??0)!==Math.sign(finite(r.crossCapture?.takerBuySellRatioDelta)??0),
    direction:r=> Math.sign(finite(r.crossCapture?.takerBuySellRatioDelta)??0),
  },
  {
    id:'taker_reversal_after_vol_expansion',
    description:'aggressive-flow reversal after volatility expansion',
    signal:r=> (finite(r.positioning?.volatilityExpansionRatio)??0)>=1.2 && Math.abs(finite(r.crossCapture?.takerBuySellRatioDelta)??0)>=0.12,
    direction:r=> Math.sign(finite(r.crossCapture?.takerBuySellRatioDelta)??0),
  },
];

export function evaluatePositioningStudy(rows, quality, { minIndependentRows=20, stressedCostBps=12 }={}) {
  const base = {
    ok:true, version:VERSION, mode:'RESEARCH_ONLY', paperOnly:true, liveOrders:false,
    executionAuthority:false, capitalEligible:false,
    methodology:{ selectionUsesHoldout:false, finitePredeclaredFamilies:true, holdoutSealed:true, minIndependentRows, stressedCostBps },
  };
  const independentCount=Number(quality?.independentRowCount??0);
  const ready = quality?.qualityPass===true && independentCount>=minIndependentRows;
  if (!ready) return { ...base, verdict:'DATA_NOT_READY', dataQuality:{ qualityPass:quality?.qualityPass===true, independentRowCount:independentCount, required:minIndependentRows, defects:quality?.defects??null }, candidates:[] };

  const xs=eligibleRows(rows);
  // Cross-capture return is contemporaneous evidence only; v1 uses the next eligible capture return as forward label.
  const samples=[];
  for(let i=0;i<xs.length-1;i++){
    const cur=xs[i], nxt=xs[i+1];
    const px0=finite(cur.price?.close), px1=finite(nxt.price?.close);
    if(!(px0>0&&px1>0)) continue;
    samples.push({ row:cur, nextReturnBps:Math.log(px1/px0)*10000 });
  }
  const cut=Math.max(1,Math.floor(samples.length*0.7));
  const train=samples.slice(0,cut), validation=samples.slice(cut);
  const candidates=FAMILIES.map(f=>{
    const evalSet=set=>set.filter(s=>f.signal(s.row)).map(s=>f.direction(s.row)*s.nextReturnBps-stressedCostBps);
    const tr=metrics(evalSet(train)), va=metrics(evalSet(validation));
    const pass=tr.trades>=5&&va.trades>=3&&(tr.expectancyBps??-Infinity)>0&&(va.expectancyBps??-Infinity)>0&&(tr.profitFactor??0)>=1.1&&(va.profitFactor??0)>=1.1;
    return { family:f.id, description:f.description, train:tr, validation:va, status:pass?'RESEARCH_CANDIDATE':'REJECTED' };
  });
  const survivors=candidates.filter(x=>x.status==='RESEARCH_CANDIDATE');
  return { ...base, verdict:survivors.length?'RESEARCH_CANDIDATE_FOUND':'NO_EDGE_FOUND', dataQuality:{qualityPass:true,independentRowCount:independentCount}, candidates, survivors, holdoutOpened:false };
}

if (process.argv[1]?.endsWith('runPositioningEdgeFactory.mjs')) {
  const args=process.argv.slice(2); const val=f=>{const i=args.indexOf(f); return i>=0?args[i+1]:undefined;};
  const input=val('--input'), qualityPath=val('--quality'), out=val('--out');
  if(!input||!qualityPath) throw new Error('--input and --quality are required');
  const result=evaluatePositioningStudy(readJsonl(input),readJson(qualityPath));
  if(out){ fs.mkdirSync(path.dirname(out),{recursive:true}); fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n'); }
  console.log(JSON.stringify(result));
}
