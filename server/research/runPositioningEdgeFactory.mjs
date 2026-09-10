// RESEARCH_ONLY positioning-aware edge discovery.
// Fail-closed: never ranks until durable data-quality cohort is ready.

import fs from 'node:fs';
import path from 'node:path';

const VERSION = 'positioning_edge_factory_v6_active_cohort';

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
function readJsonl(p){ if(!p || !fs.existsSync(p)) return []; return fs.readFileSync(p,'utf8').split('\n').filter(Boolean).map(JSON.parse); }
function capturedMs(r){ const x=Date.parse(r?.capturedAt); return Number.isFinite(x)?x:null; }
function takerWindowMs(r){ return finite(r?.positioning?.takerWindowMs) ?? finite(r?.provenance?.takerWindowMs); }
function boundaryMs(value){ if(!value) return null; const n=Date.parse(value); return Number.isFinite(n)?n:null; }
function eligibleRows(rows,symbol='BTCUSDT',{minCapturedAt=null,maxCapturedAt=null}={}){
  const target=String(symbol||'').toUpperCase();
  const minMs=boundaryMs(minCapturedAt), maxMs=boundaryMs(maxCapturedAt);
  return rows.filter(r=>{
    const t=capturedMs(r);
    return r?.mode==='RESEARCH_ONLY'
      && r?.provider==='okx_public_market_data'
      && r?.symbol===target
      && r?.schemaVersion===4
      && r?.crossCapture?.available===true
      && Number.isFinite(t)
      && (minMs===null || t>=minMs)
      && (maxMs===null || t<=maxMs)
      && (takerWindowMs(r)??0)>0;
  }).sort((a,b)=>capturedMs(a)-capturedMs(b));
}
function eligibleDivergenceRows(rows,symbol='BTCUSDT'){
  const target=String(symbol||'').toUpperCase();
  return rows.filter(r=>
    r?.mode==='RESEARCH_ONLY'
    && r?.provider==='okx_public_market_data'
    && r?.symbol===target
    && r?.schemaVersion===1
    && r?.provenance?.fixedWindow===true
    && r?.provenance?.rawSpotVsPerpSizeComparisonForbidden===true
    && (finite(r?.spot?.coverageMs)??0)>=54_000
    && (finite(r?.perpetual?.coverageMs)??0)>=54_000
    && Number.isFinite(capturedMs(r))
    && finite(r?.divergence?.perpMinusSpotNotionalBuyFraction)!==null
  ).sort((a,b)=>capturedMs(a)-capturedMs(b));
}
export function joinCausalSpotPerpDivergence(rows, divergenceRows, {maxDivergenceAgeMs=30_000,symbol='BTCUSDT',minCapturedAt=null,maxCapturedAt=null}={}){
  const ds=eligibleDivergenceRows(divergenceRows,symbol);
  let j=0, latest=null;
  return eligibleRows(rows,symbol,{minCapturedAt,maxCapturedAt}).map(row=>{
    const t=capturedMs(row);
    while(j<ds.length && capturedMs(ds[j])<=t){ latest=ds[j]; j+=1; }
    const ageMs=latest ? t-capturedMs(latest) : null;
    const usable=latest && ageMs>=0 && ageMs<=maxDivergenceAgeMs;
    return {
      ...row,
      researchFeatures:{
        ...(row.researchFeatures??{}),
        spotPerpTakerDivergence: usable ? finite(latest.divergence.perpMinusSpotNotionalBuyFraction) : null,
        spotPerpTakerDivergenceAgeMs: usable ? ageMs : null,
        spotPerpTakerDivergenceCausal: Boolean(usable),
      },
    };
  });
}
function segmentedIndependentRows(rows,{maxGapMinutes=60}={}){
  const selected=[];
  let segment=0;
  for(const row of rows){
    const prior=selected.at(-1);
    if(!prior){ selected.push({row,segment}); continue; }
    const elapsed=capturedMs(row)-capturedMs(prior.row);
    const minSep=Math.max(takerWindowMs(prior.row)??0,takerWindowMs(row)??0);
    if(elapsed>maxGapMinutes*60_000){
      segment+=1;
      selected.push({row,segment});
      continue;
    }
    if(elapsed>=minSep) selected.push({row,segment});
  }
  return selected;
}
function temporalSamples(rows,{maxForwardLabelGapMinutes=30,maxGapMinutes=60}={}){
  const xs=segmentedIndependentRows(rows,{maxGapMinutes});
  const samples=[];
  let rejectedForwardGaps=0;
  let segmentBreaks=0;
  for(let i=0;i<xs.length-1;i++){
    const cur=xs[i], nxt=xs[i+1];
    if(cur.segment!==nxt.segment){ segmentBreaks+=1; rejectedForwardGaps+=1; continue; }
    const elapsed=capturedMs(nxt.row)-capturedMs(cur.row);
    if(!(elapsed>0 && elapsed<=maxForwardLabelGapMinutes*60_000)){ rejectedForwardGaps+=1; continue; }
    const px0=finite(cur.row.price?.close), px1=finite(nxt.row.price?.close);
    if(!(px0>0&&px1>0)) continue;
    samples.push({ row:cur.row, nextReturnBps:Math.log(px1/px0)*10000, forwardMinutes:elapsed/60_000, segment:cur.segment });
  }
  return { samples, independentRows:xs.length, rejectedForwardGaps, segmentBreaks, segmentCount:xs.length?xs.at(-1).segment+1:0 };
}

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
  {
    id:'spot_perp_taker_divergence_continuation',
    description:'causal spot-perp taker aggression divergence continuation',
    signal:r=> r.researchFeatures?.spotPerpTakerDivergenceCausal===true && Math.abs(finite(r.researchFeatures?.spotPerpTakerDivergence)??0)>=0.15,
    direction:r=> Math.sign(finite(r.researchFeatures?.spotPerpTakerDivergence)??0),
  },
];

export function evaluatePositioningStudy(rows, quality, {
  symbol,
  minIndependentRows=20,
  stressedCostBps=12,
  maxForwardLabelGapMinutes=30,
  holdoutFraction=0.2,
  walkForwardFolds=2,
  divergenceRows=[],
  maxDivergenceAgeMs=30_000,
}={}) {
  const targetSymbol=String(symbol ?? quality?.symbol ?? 'BTCUSDT').toUpperCase();
  if (quality?.symbol && String(quality.symbol).toUpperCase() !== targetSymbol) {
    throw new Error('POSITIONING_QUALITY_SYMBOL_MISMATCH');
  }
  const cohortStart=quality?.firstEligibleCapturedAt ?? null;
  const cohortEnd=quality?.lastEligibleCapturedAt ?? null;
  const base = {
    ok:true, version:VERSION, mode:'RESEARCH_ONLY', symbol:targetSymbol, paperOnly:true, liveOrders:false,
    executionAuthority:false, capitalEligible:false,
    methodology:{
      selectionUsesHoldout:false,
      finitePredeclaredFamilies:true,
      holdoutSealed:true,
      minIndependentRows,
      stressedCostBps,
      maxForwardLabelGapMinutes,
      holdoutFraction,
      temporalOrderPreserved:true,
      walkForwardFolds,
      independentNonOverlappingRowsOnly:true,
      outageStartsNewCohortSegment:true,
      labelsNeverCrossSegmentBreaks:true,
      symbolIsolation:true,
      activeQualityCohortOnly:true,
      qualityCohortStart:cohortStart,
      qualityCohortEnd:cohortEnd,
      spotPerpJoin:'PRIOR_ASOF_ONLY',
      maxDivergenceAgeMs,
      futureDivergenceForbidden:true,
    },
  };
  const independentCount=Number(quality?.independentRowCount??0);
  const ready = quality?.qualityPass===true && independentCount>=minIndependentRows;
  if (!ready) return { ...base, verdict:'DATA_NOT_READY', dataQuality:{ qualityPass:quality?.qualityPass===true, independentRowCount:independentCount, required:minIndependentRows, defects:quality?.defects??null }, candidates:[] };

  const joinedRows=joinCausalSpotPerpDivergence(rows, divergenceRows,{maxDivergenceAgeMs,symbol:targetSymbol,minCapturedAt:cohortStart,maxCapturedAt:cohortEnd});
  const temporal=temporalSamples(joinedRows,{maxForwardLabelGapMinutes});
  const samples=temporal.samples;
  if(samples.length<10){
    return {
      ...base,
      verdict:'DATA_NOT_READY',
      dataQuality:{qualityPass:true,independentRowCount:independentCount,reconstructedIndependentRows:temporal.independentRows,usableForwardSamples:samples.length,rejectedForwardGaps:temporal.rejectedForwardGaps,segmentBreaks:temporal.segmentBreaks,segmentCount:temporal.segmentCount},
      candidates:[],
    };
  }

  const holdoutCount=Math.max(1,Math.floor(samples.length*holdoutFraction));
  const researchSamples=samples.slice(0,samples.length-holdoutCount);
  const sealedHoldout=samples.slice(samples.length-holdoutCount);
  const trainCount=Math.max(1,Math.floor(researchSamples.length*0.75));
  const train=researchSamples.slice(0,trainCount);
  const validation=researchSamples.slice(trainCount);

  const candidates=FAMILIES.map(f=>{
    const evalSet=set=>set.filter(s=>f.signal(s.row)).map(s=>f.direction(s.row)*s.nextReturnBps-stressedCostBps);
    const tr=metrics(evalSet(train));
    const va=metrics(evalSet(validation));
    const folds=[];
    const foldSize=Math.max(1,Math.ceil(validation.length/Math.max(1,walkForwardFolds)));
    for(let start=0;start<validation.length;start+=foldSize){
      const fold=validation.slice(start,Math.min(validation.length,start+foldSize));
      folds.push(metrics(evalSet(fold)));
    }
    const usableFolds=folds.filter(x=>x.trades>0);
    const walkForwardPass=usableFolds.length>=Math.min(walkForwardFolds,validation.length)
      && usableFolds.every(x=>(x.expectancyBps??-Infinity)>0 && (x.profitFactor??0)>=1.0);
    const pass=tr.trades>=5
      && va.trades>=3
      && (tr.expectancyBps??-Infinity)>0
      && (va.expectancyBps??-Infinity)>0
      && (tr.profitFactor??0)>=1.1
      && (va.profitFactor??0)>=1.1
      && walkForwardPass;
    return { family:f.id, description:f.description, train:tr, validation:va, walkForward:{folds,pass:walkForwardPass}, status:pass?'RESEARCH_CANDIDATE':'REJECTED' };
  });
  const survivors=candidates.filter(x=>x.status==='RESEARCH_CANDIDATE');
  return {
    ...base,
    verdict:survivors.length?'RESEARCH_CANDIDATE_FOUND':'NO_EDGE_FOUND',
    dataQuality:{
      qualityPass:true,
      independentRowCount:independentCount,
      reconstructedIndependentRows:temporal.independentRows,
      usableForwardSamples:samples.length,
      rejectedForwardGaps:temporal.rejectedForwardGaps,
      segmentBreaks:temporal.segmentBreaks,
      segmentCount:temporal.segmentCount,
    },
    partitions:{
      trainSamples:train.length,
      validationSamples:validation.length,
      sealedHoldoutSamples:sealedHoldout.length,
      holdoutOpened:false,
      holdoutMetricsComputed:false,
    },
    candidates,
    survivors,
    holdoutOpened:false,
  };
}

if (process.argv[1]?.endsWith('runPositioningEdgeFactory.mjs')) {
  const args=process.argv.slice(2); const val=f=>{const i=args.indexOf(f); return i>=0?args[i+1]:undefined;};
  const input=val('--input'), qualityPath=val('--quality'), divergencePath=val('--divergence'), out=val('--out'), symbol=val('--symbol');
  if(!input||!qualityPath) throw new Error('--input and --quality are required');
  const result=evaluatePositioningStudy(readJsonl(input),readJson(qualityPath),{symbol,divergenceRows:readJsonl(divergencePath)});
  if(out){ fs.mkdirSync(path.dirname(out),{recursive:true}); fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n'); }
  console.log(JSON.stringify(result));
}
