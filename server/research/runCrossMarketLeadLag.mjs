// RESEARCH_ONLY causal BTC -> alt lead/lag research lane.
// Uses strictly prior BTC observations and future alt returns only as labels.
// Holdout remains sealed; no execution/capital authority.

import fs from 'node:fs';
import path from 'node:path';

const VERSION = 'cross_market_lead_lag_v1';
const ALT_SYMBOLS = Object.freeze(['ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT']);

function finite(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function timeMs(row) { const n = Date.parse(row?.capturedAt); return Number.isFinite(n) ? n : null; }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function readJsonl(file) { if (!file || !fs.existsSync(file)) return []; return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(JSON.parse); }
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
    expectancyBps:m,
    profitFactor:grossLoss>0 ? grossWin/grossLoss : grossWin>0 ? Infinity : null,
    tStat:s && s>0 ? m/(s/Math.sqrt(returnsBps.length)) : null,
    maxDrawdownPct:maxDd,
  };
}

function validPositioningRow(row, symbol) {
  return row?.mode === 'RESEARCH_ONLY'
    && row?.provider === 'okx_public_market_data'
    && row?.schemaVersion === 4
    && row?.symbol === symbol
    && Number.isFinite(timeMs(row))
    && finite(row?.price?.close) > 0;
}

export function alignBtcLeaderToAlt(btcRows=[], altRows=[], {
  altSymbol,
  maxLeaderAgeMinutes=8,
  maxAltForwardMinutes=30,
}={}) {
  const symbol=String(altSymbol||'').toUpperCase();
  if (!ALT_SYMBOLS.includes(symbol)) throw new Error(`UNSUPPORTED_ALT_SYMBOL:${symbol}`);
  const btc=btcRows.filter(r=>validPositioningRow(r,'BTCUSDT')).sort((a,b)=>timeMs(a)-timeMs(b));
  const alt=altRows.filter(r=>validPositioningRow(r,symbol)).sort((a,b)=>timeMs(a)-timeMs(b));
  const samples=[];
  let j=0, latestBtc=null, rejectedLeaderAge=0, rejectedForwardGap=0;

  for(let i=0;i<alt.length-1;i++){
    const current=alt[i], next=alt[i+1];
    const currentTime=timeMs(current), nextTime=timeMs(next);
    while(j<btc.length && timeMs(btc[j])<=currentTime){ latestBtc=btc[j]; j+=1; }
    if(!latestBtc) continue;
    const leaderAgeMinutes=(currentTime-timeMs(latestBtc))/60_000;
    if(!(leaderAgeMinutes>=0 && leaderAgeMinutes<=maxLeaderAgeMinutes)){ rejectedLeaderAge+=1; continue; }
    const forwardMinutes=(nextTime-currentTime)/60_000;
    if(!(forwardMinutes>0 && forwardMinutes<=maxAltForwardMinutes)){ rejectedForwardGap+=1; continue; }
    const p0=finite(current.price?.close), p1=finite(next.price?.close);
    if(!(p0>0&&p1>0)) continue;
    samples.push({
      altSymbol:symbol,
      observedAt:current.capturedAt,
      leaderCapturedAt:latestBtc.capturedAt,
      labelCapturedAt:next.capturedAt,
      leaderAgeMinutes,
      forwardMinutes,
      btc:latestBtc,
      alt:current,
      nextAltReturnBps:Math.log(p1/p0)*10_000,
    });
  }
  return { samples, rejectedLeaderAge, rejectedForwardGap, btcRows:btc.length, altRows:alt.length };
}

const FAMILIES = [
  {
    id:'btc_momentum_leads_alt',
    description:'BTC directional move leads same-direction alt continuation',
    signal:s=>Math.abs(finite(s.btc?.crossCapture?.perpReturnBps)??0)>=8,
    direction:s=>Math.sign(finite(s.btc?.crossCapture?.perpReturnBps)??0),
  },
  {
    id:'btc_taker_impulse_leads_alt',
    description:'BTC aggressive taker shift leads alt in the same direction',
    signal:s=>Math.abs(finite(s.btc?.crossCapture?.takerBuySellRatioDelta)??0)>=0.1,
    direction:s=>Math.sign(finite(s.btc?.crossCapture?.takerBuySellRatioDelta)??0),
  },
  {
    id:'btc_oi_expansion_momentum',
    description:'BTC OI expansion plus directional move leads alt continuation',
    signal:s=>(finite(s.btc?.crossCapture?.oiChangePct)??0)>0.1 && Math.abs(finite(s.btc?.crossCapture?.perpReturnBps)??0)>=8,
    direction:s=>Math.sign(finite(s.btc?.crossCapture?.perpReturnBps)??0),
  },
  {
    id:'btc_price_taker_disagreement_reversal',
    description:'BTC price/taker disagreement leads alt reversal versus BTC price move',
    signal:s=>{
      const ret=finite(s.btc?.crossCapture?.perpReturnBps), taker=finite(s.btc?.crossCapture?.takerBuySellRatioDelta);
      return ret!==null&&taker!==null&&Math.abs(ret)>=8&&Math.abs(taker)>=0.1&&Math.sign(ret)!==Math.sign(taker);
    },
    direction:s=>-Math.sign(finite(s.btc?.crossCapture?.perpReturnBps)??0),
  },
];

export function evaluateCrossMarketLane({ btcRows=[], altRows=[], btcQuality={}, altQuality={}, altSymbol }, {
  minIndependentRows=20,
  maxLeaderAgeMinutes=8,
  maxAltForwardMinutes=30,
  stressedCostBps=12,
  holdoutFraction=0.2,
}={}) {
  const symbol=String(altSymbol||'').toUpperCase();
  if (!ALT_SYMBOLS.includes(symbol)) throw new Error(`UNSUPPORTED_ALT_SYMBOL:${symbol}`);
  if (btcQuality?.symbol && btcQuality.symbol !== 'BTCUSDT') throw new Error('BTC_QUALITY_SYMBOL_MISMATCH');
  if (altQuality?.symbol && altQuality.symbol !== symbol) throw new Error('ALT_QUALITY_SYMBOL_MISMATCH');

  const base={
    ok:true, version:VERSION, mode:'RESEARCH_ONLY', leaderSymbol:'BTCUSDT', altSymbol:symbol,
    paperOnly:true, liveOrders:false, executionAuthority:false, capitalEligible:false,
    methodology:{
      causalPriorLeaderOnly:true,
      futureLeaderForbidden:true,
      finitePredeclaredFamilies:true,
      selectionUsesHoldout:false,
      holdoutSealed:true,
      symbolIsolation:true,
      minIndependentRows,
      maxLeaderAgeMinutes,
      maxAltForwardMinutes,
      stressedCostBps,
      holdoutFraction,
    },
  };

  const btcCount=Number(btcQuality?.independentRowCount??0);
  const altCount=Number(altQuality?.independentRowCount??0);
  const qualityReady=btcQuality?.qualityPass===true && altQuality?.qualityPass===true
    && btcCount>=minIndependentRows && altCount>=minIndependentRows;
  if(!qualityReady){
    return {...base,verdict:'DATA_NOT_READY',dataQuality:{btcQualityPass:btcQuality?.qualityPass===true,altQualityPass:altQuality?.qualityPass===true,btcIndependentRows:btcCount,altIndependentRows:altCount,required:minIndependentRows},candidates:[],holdoutOpened:false};
  }

  const alignment=alignBtcLeaderToAlt(btcRows,altRows,{altSymbol:symbol,maxLeaderAgeMinutes,maxAltForwardMinutes});
  if(alignment.samples.length<minIndependentRows){
    return {...base,verdict:'DATA_NOT_READY',dataQuality:{btcQualityPass:true,altQualityPass:true,btcIndependentRows:btcCount,altIndependentRows:altCount,required:minIndependentRows,alignedSamples:alignment.samples.length,rejectedLeaderAge:alignment.rejectedLeaderAge,rejectedForwardGap:alignment.rejectedForwardGap},candidates:[],holdoutOpened:false};
  }

  const samples=alignment.samples;
  const holdoutCount=Math.max(1,Math.floor(samples.length*holdoutFraction));
  const research=samples.slice(0,samples.length-holdoutCount);
  const sealedHoldout=samples.slice(samples.length-holdoutCount);
  const trainCount=Math.max(1,Math.floor(research.length*0.75));
  const train=research.slice(0,trainCount), validation=research.slice(trainCount);
  const evaluate=(family,set)=>metrics(set.filter(family.signal).map(s=>family.direction(s)*s.nextAltReturnBps-stressedCostBps));
  const candidates=FAMILIES.map(f=>{
    const tr=evaluate(f,train), va=evaluate(f,validation);
    const pass=tr.trades>=4&&va.trades>=2&&(tr.expectancyBps??-Infinity)>0&&(va.expectancyBps??-Infinity)>0&&(tr.profitFactor??0)>=1.1&&(va.profitFactor??0)>=1.1;
    return {family:f.id,description:f.description,train:tr,validation:va,status:pass?'RESEARCH_CANDIDATE':'REJECTED'};
  });
  const survivors=candidates.filter(x=>x.status==='RESEARCH_CANDIDATE');
  return {
    ...base,
    verdict:survivors.length?'RESEARCH_CANDIDATE_FOUND':'NO_EDGE_FOUND',
    dataQuality:{btcQualityPass:true,altQualityPass:true,btcIndependentRows:btcCount,altIndependentRows:altCount,alignedSamples:samples.length,rejectedLeaderAge:alignment.rejectedLeaderAge,rejectedForwardGap:alignment.rejectedForwardGap},
    partitions:{trainSamples:train.length,validationSamples:validation.length,sealedHoldoutSamples:sealedHoldout.length,holdoutOpened:false,holdoutMetricsComputed:false},
    candidates,survivors,holdoutOpened:false,
  };
}

export function runCrossMarketReport({btcRows,btcQuality,altInputs},{options={}}={}){
  const lanes={};
  for(const input of altInputs){
    lanes[input.altSymbol]=evaluateCrossMarketLane({btcRows,btcQuality,altRows:input.rows,altQuality:input.quality,altSymbol:input.altSymbol},options);
  }
  const survivors=Object.values(lanes).flatMap(lane=>(lane.survivors??[]).map(candidate=>({altSymbol:lane.altSymbol,...candidate})));
  return {
    ok:true,version:VERSION,mode:'RESEARCH_ONLY',paperOnly:true,liveOrders:false,executionAuthority:false,capitalEligible:false,
    completedAt:new Date().toISOString(),leaderSymbol:'BTCUSDT',verdict:survivors.length?'RESEARCH_CANDIDATE_FOUND':Object.values(lanes).some(l=>l.verdict!=='DATA_NOT_READY')?'NO_EDGE_FOUND':'DATA_NOT_READY',
    methodology:{selectionUsesHoldout:false,holdoutSealed:true,causalPriorLeaderOnly:true,futureLeaderForbidden:true,symbolIsolation:true},
    lanes,survivors,
  };
}

if(process.argv[1]?.endsWith('runCrossMarketLeadLag.mjs')){
  const args=process.argv.slice(2); const val=f=>{const i=args.indexOf(f); return i>=0?args[i+1]:undefined;};
  const btcInput=val('--btc-input'), btcQualityPath=val('--btc-quality'), out=val('--out');
  if(!btcInput||!btcQualityPath) throw new Error('--btc-input and --btc-quality are required');
  const altInputs=ALT_SYMBOLS.map(symbol=>{
    const key=symbol.toLowerCase();
    const input=val(`--${key}-input`), qualityPath=val(`--${key}-quality`);
    if(!input||!qualityPath) throw new Error(`missing ${symbol} input or quality`);
    return {altSymbol:symbol,rows:readJsonl(input),quality:readJson(qualityPath)};
  });
  const report=runCrossMarketReport({btcRows:readJsonl(btcInput),btcQuality:readJson(btcQualityPath),altInputs});
  if(out){fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,`${JSON.stringify(report,null,2)}\n`);}
  console.log(JSON.stringify(report));
}
