// RESEARCH_ONLY predeclared spot/perpetual lead-lag study.
// Never places orders, changes LIVE/REAL_TRADING, or weakens trading gates.
// Protocol is fixed before sufficient outcomes exist.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const CROSS_MARKET_PROTOCOL = Object.freeze({
  studyVersion: 3,
  hypothesis: 'A material 1m BTC spot/perpetual return disagreement predicts partial perpetual catch-up over the next 10-25m net of fixed round-trip costs.',
  signal: {
    // returnSpread1mBps = perpetualReturn - spotReturn.
    longPerpMaxSpreadBps: -2,
    shortPerpMinSpreadBps: 2,
  },
  maturityWindowMs: [10 * 60 * 1000, 25 * 60 * 1000],
  independenceEmbargoMs: 25 * 60 * 1000,
  independencePolicy: 'ACCEPT_FIRST_MATURED_SIGNAL_THEN_EMBARGO_NEW_ENTRIES_FOR_FULL_MAX_FORWARD_WINDOW',
  roundTripCostBps: 10,
  sequentialSplits: { discovery: 60, validation: 30, holdout: 30 },
  walkForward: {
    initialTrainCount: 30,
    testCounts: [15, 15, 30],
    policy: 'EXPANDING_TRAIN_FIXED_RULE_THREE_PRE_HOLDOUT_OOS_FOLDS_REQUIRE_ALL_TO_PASS_SAME_FIXED_GATES',
  },
  validationGates: { meanNetBpsMin: 2, medianNetBpsMin: 0, winRateMin: 0.55, profitFactorMin: 1.20 },
  holdoutPolicy: 'SEALED_UNLESS_PRE_HOLDOUT_FIXED_GATES_PASS_AND_120_INDEPENDENT_MATURED_SIGNALS_EXIST; NEVER_USED_FOR_RANKING_OR_TUNING',
  rankingPolicy: 'DISCOVERY_VALIDATION_AND_PRE_HOLDOUT_WALK_FORWARD_ONLY; HOLDOUT NEVER RANKS OR TUNES',
  provenanceRequirement: 'OKX_PUBLIC_CONFIRMED_1M_SPOT_AND_SWAP_BARS_ALIGNED_BY_OPEN_TIME',
  researchBoundary: 'RESEARCH_ONLY_NOT_IN_H1_NOT_FORWARD_PAPER',
});

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

export const CROSS_MARKET_PROTOCOL_SHA256 = crypto.createHash('sha256').update(canonical(CROSS_MARKET_PROTOCOL)).digest('hex');

function finite(v) { const n=Number(v); return Number.isFinite(n) ? n : null; }
function round(v,d=4) { return Number.isFinite(v) ? Number(v.toFixed(d)) : null; }
function median(xs) { if (!xs.length) return null; const a=[...xs].sort((x,y)=>x-y); const m=Math.floor(a.length/2); return a.length%2?a[m]:(a[m-1]+a[m])/2; }

export function parseCrossMarketJsonl(text='') {
  return text.split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line))
    .filter(r => r?.schemaVersion >= 1 && r?.mode === 'RESEARCH_ONLY' && r?.provider === 'okx_public_market_data'
      && r?.provenance?.confirmedBarsOnly === true && Number.isFinite(Date.parse(r?.capturedAt))
      && finite(r?.features?.futuresClose) > 0 && finite(r?.features?.returnSpread1mBps) !== null)
    .sort((a,b)=>Date.parse(a.capturedAt)-Date.parse(b.capturedAt));
}

export function buildMaturedCrossMarketObservations(rows, protocol=CROSS_MARKET_PROTOCOL) {
  const out=[];
  const [minGap,maxGap]=protocol.maturityWindowMs;
  for (let i=0;i<rows.length;i++) {
    const entry=rows[i];
    const spread=finite(entry.features.returnSpread1mBps);
    const side=spread <= protocol.signal.longPerpMaxSpreadBps ? 'LONG_PERP' : spread >= protocol.signal.shortPerpMinSpreadBps ? 'SHORT_PERP' : null;
    if (!side) continue;
    const entryMs=Date.parse(entry.capturedAt);
    const exit=rows.slice(i+1).find(r => { const gap=Date.parse(r.capturedAt)-entryMs; return gap>=minGap && gap<=maxGap; });
    if (!exit) continue;
    const entryPx=finite(entry.features.futuresClose); const exitPx=finite(exit.features.futuresClose);
    const gross=((exitPx/entryPx)-1)*10000*(side==='LONG_PERP'?1:-1);
    const net=gross-protocol.roundTripCostBps;
    out.push({
      entryCapturedAt:entry.capturedAt, exitCapturedAt:exit.capturedAt,
      gapMs:Date.parse(exit.capturedAt)-entryMs, side,
      entryReturnSpread1mBps:spread, entryBasisBps:finite(entry.features.basisBps),
      entryPerpPrice:entryPx, exitPerpPrice:exitPx,
      grossBps:round(gross), netBps:round(net),
    });
  }
  return out;
}

export function selectIndependentCrossMarketObservations(observations=[], protocol=CROSS_MARKET_PROTOCOL) {
  const embargoMs=Number(protocol.independenceEmbargoMs ?? protocol.maturityWindowMs?.[1]);
  if (!Number.isFinite(embargoMs) || embargoMs<=0) throw new Error('invalid independenceEmbargoMs');
  const accepted=[]; const rejected=[]; let embargoUntil=-Infinity;
  for (const observation of [...observations].sort((a,b)=>Date.parse(a.entryCapturedAt)-Date.parse(b.entryCapturedAt))) {
    const entryMs=Date.parse(observation.entryCapturedAt);
    if (!Number.isFinite(entryMs)) continue;
    if (entryMs < embargoUntil) {
      rejected.push({entryCapturedAt:observation.entryCapturedAt,reason:'OVERLAPPING_FORWARD_WINDOW',embargoUntil:new Date(embargoUntil).toISOString()});
      continue;
    }
    accepted.push(observation); embargoUntil=entryMs+embargoMs;
  }
  return {accepted,rejected,embargoMs};
}

export function summarizeCrossMarket(obs=[]) {
  if (!obs.length) return {count:0,meanNetBps:null,medianNetBps:null,winRate:null,profitFactor:null};
  const nets=obs.map(o=>o.netBps); const wins=nets.filter(x=>x>0); const losses=nets.filter(x=>x<0);
  const gw=wins.reduce((a,b)=>a+b,0); const gl=Math.abs(losses.reduce((a,b)=>a+b,0));
  return {count:obs.length,meanNetBps:round(nets.reduce((a,b)=>a+b,0)/obs.length),medianNetBps:round(median(nets)),winRate:round(wins.length/obs.length),profitFactor:gl>0?round(gw/gl):(gw>0?'Infinity':null)};
}

function passes(summary,gates) {
  return summary.count>0 && summary.meanNetBps>=gates.meanNetBpsMin && summary.medianNetBps>=gates.medianNetBpsMin
    && summary.winRate>=gates.winRateMin && (summary.profitFactor==='Infinity' || summary.profitFactor>=gates.profitFactorMin);
}

export function evaluatePreHoldoutWalkForward(observations=[], protocol=CROSS_MARKET_PROTOCOL) {
  const initialTrainCount=Number(protocol.walkForward?.initialTrainCount);
  const testCounts=protocol.walkForward?.testCounts ?? [];
  const requiredCount=initialTrainCount+testCounts.reduce((sum,count)=>sum+Number(count),0);
  if (!Number.isInteger(initialTrainCount) || initialTrainCount<=0 || !testCounts.length || testCounts.some(count=>!Number.isInteger(Number(count)) || Number(count)<=0)) {
    throw new Error('invalid walkForward protocol');
  }
  if (requiredCount !== protocol.sequentialSplits.discovery + protocol.sequentialSplits.validation) {
    throw new Error('walkForward must consume exactly the pre-holdout allocation');
  }

  const folds=[];
  let testStart=initialTrainCount;
  for (let i=0;i<testCounts.length;i++) {
    const testCount=Number(testCounts[i]);
    const train=observations.slice(0,testStart);
    const test=observations.slice(testStart,testStart+testCount);
    const summary=summarizeCrossMarket(test);
    const complete=test.length===testCount;
    folds.push({
      fold:i+1,
      trainCount:train.length,
      testCount:test.length,
      requiredTestCount:testCount,
      complete,
      testStartIndex:testStart,
      testEndIndexExclusive:testStart+testCount,
      summary,
      pass:complete && passes(summary,protocol.validationGates),
    });
    testStart+=testCount;
  }
  const complete=observations.length>=requiredCount && folds.every(fold=>fold.complete);
  return {
    policy:protocol.walkForward.policy,
    requiredPreHoldoutCount:requiredCount,
    complete,
    allFoldsPass:complete && folds.every(fold=>fold.pass),
    folds,
  };
}

export function evaluateCrossMarketStudy(rows, protocol=CROSS_MARKET_PROTOCOL) {
  const raw=buildMaturedCrossMarketObservations(rows,protocol);
  const independence=selectIndependentCrossMarketObservations(raw,protocol); const matured=independence.accepted;
  const dN=protocol.sequentialSplits.discovery,vN=protocol.sequentialSplits.validation,hN=protocol.sequentialSplits.holdout;
  const discovery=matured.slice(0,dN); const validation=matured.slice(dN,dN+vN);
  const preHoldout=matured.slice(0,dN+vN);
  const walkForward=evaluatePreHoldoutWalkForward(preHoldout,protocol);
  const discoverySummary=summarizeCrossMarket(discovery); const validationSummary=summarizeCrossMarket(validation);
  const discoveryPass=discovery.length===dN && passes(discoverySummary,protocol.validationGates);
  const validationPass=validation.length===vN && passes(validationSummary,protocol.validationGates);
  const preHoldoutPass=discoveryPass && validationPass && walkForward.allFoldsPass;
  const holdoutSampleComplete=matured.length>=dN+vN+hN;
  const holdoutEligible=preHoldoutPass && holdoutSampleComplete;
  const holdout=holdoutEligible?matured.slice(dN+vN,dN+vN+hN):[];
  const candidateStatus=matured.length<dN?'ACCUMULATING_DISCOVERY':matured.length<dN+vN?'DISCOVERY_COMPLETE_AWAITING_VALIDATION':(!preHoldoutPass?'REJECTED_PRE_HOLDOUT':holdoutEligible?'HOLDOUT_READY_FOR_ONE_TIME_AUDIT':'VALIDATION_AND_WALK_FORWARD_PASS_HOLDOUT_SEALED');
  return {
    studyVersion:protocol.studyVersion,mode:'RESEARCH_ONLY',protocolSha256:CROSS_MARKET_PROTOCOL_SHA256,protocol,
    rawSnapshotCount:rows.length,rawMaturedSignalCount:raw.length,maturedSignalCount:matured.length,
    independence:{policy:protocol.independencePolicy,embargoMs:independence.embargoMs,acceptedCount:matured.length,rejectedOverlapCount:independence.rejected.length,rejected:independence.rejected},
    sequentialAllocation:{discoveryCount:discovery.length,validationCount:validation.length,holdoutCount:holdout.length},
    discovery:discoverySummary,validation:validationSummary,walkForward,
    holdout:{status:holdoutEligible?'AVAILABLE_ONE_TIME_AUDIT_NOT_FOR_RANKING':'SEALED',count:holdout.length,metrics:holdoutEligible?summarizeCrossMarket(holdout):null},
    candidateStatus,forwardPaperEligible:false,observations:matured,
  };
}

export function runCrossMarketStudy(input,out) {
  const rows=parseCrossMarketJsonl(fs.readFileSync(input,'utf8')); const report=evaluateCrossMarketStudy(rows);
  if (out) { fs.mkdirSync(path.dirname(out),{recursive:true}); fs.writeFileSync(out,`${JSON.stringify(report,null,2)}\n`); }
  return report;
}

if (process.argv[1]?.endsWith('crossMarketLeadLagStudy.mjs')) {
  const args=process.argv.slice(2); const input=args.find(a=>!a.startsWith('--')); const oi=args.indexOf('--out'); const out=oi>=0?args[oi+1]:undefined;
  if (!input) { console.error('usage: node crossMarketLeadLagStudy.mjs <cross-market.jsonl> [--out file]'); process.exitCode=2; }
  else console.log(JSON.stringify(runCrossMarketStudy(input,out),null,2));
}
