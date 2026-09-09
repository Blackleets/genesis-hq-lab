// RESEARCH_ONLY predeclared RPI depth-imbalance study.
// This file never places orders or changes trading gates.
// Sequential discipline is fixed BEFORE sufficient sample exists:
// first 60 matured signals = discovery, next 30 = validation, next 30 = virgin holdout.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const RPI_PROTOCOL = Object.freeze({
  studyVersion: 1,
  hypothesis: 'Extreme OKX RPI depth imbalance predicts same-direction BTC-USDT-SWAP mid-price return 10-25m later net of fixed round-trip costs.',
  signal: { longMinImbalance: 0.60, shortMaxImbalance: -0.60 },
  maturityWindowMs: [10 * 60 * 1000, 25 * 60 * 1000],
  roundTripCostBps: 10,
  sequentialSplits: { discovery: 60, validation: 30, holdout: 30 },
  validationGates: { meanNetBpsMin: 2, medianNetBpsMin: 0, winRateMin: 0.55, profitFactorMin: 1.20 },
  holdoutPolicy: 'SEALED_UNTIL_120_MATURED_SIGNALS_AND_NEVER_USED_FOR_RANKING_OR_TUNING',
  researchBoundary: 'RESEARCH_ONLY_NOT_IN_H1_NOT_FORWARD_PAPER',
});

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

export const RPI_PROTOCOL_SHA256 = crypto.createHash('sha256').update(canonical(RPI_PROTOCOL)).digest('hex');

function finite(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function median(xs) { if (!xs.length) return null; const a=[...xs].sort((x,y)=>x-y); const m=Math.floor(a.length/2); return a.length%2?a[m]:(a[m-1]+a[m])/2; }
function round(v, d=4) { return Number.isFinite(v) ? Number(v.toFixed(d)) : null; }

export function parseRpiJsonl(text='') {
  return text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
    .filter(r => r?.schemaVersion >= 2 && r?.mode === 'RESEARCH_ONLY' && r?.provider === 'okx' && Number.isFinite(Date.parse(r?.capturedAt)) && finite(r?.features?.rpiMidPrice) > 0 && finite(r?.features?.rpiDepthImbalance) !== null)
    .sort((a,b) => Date.parse(a.capturedAt)-Date.parse(b.capturedAt));
}

export function buildMaturedRpiObservations(rows, protocol=RPI_PROTOCOL) {
  const out=[];
  const [minGap,maxGap]=protocol.maturityWindowMs;
  for (let i=0;i<rows.length;i++) {
    const entry=rows[i];
    const imbalance=finite(entry.features.rpiDepthImbalance);
    const side=imbalance >= protocol.signal.longMinImbalance ? 'LONG' : imbalance <= protocol.signal.shortMaxImbalance ? 'SHORT' : null;
    if (!side) continue;
    const entryMs=Date.parse(entry.capturedAt);
    const exit=rows.slice(i+1).find(r => { const gap=Date.parse(r.capturedAt)-entryMs; return gap>=minGap && gap<=maxGap; });
    if (!exit) continue;
    const entryPx=finite(entry.features.rpiMidPrice); const exitPx=finite(exit.features.rpiMidPrice);
    const gross=((exitPx/entryPx)-1)*10000*(side==='LONG'?1:-1);
    const net=gross-protocol.roundTripCostBps;
    out.push({ entryCapturedAt:entry.capturedAt, exitCapturedAt:exit.capturedAt, gapMs:Date.parse(exit.capturedAt)-entryMs, side, entryImbalance:imbalance, entryMidPrice:entryPx, exitMidPrice:exitPx, grossBps:round(gross), netBps:round(net) });
  }
  return out;
}

export function summarize(obs=[]) {
  if (!obs.length) return { count:0, meanNetBps:null, medianNetBps:null, winRate:null, profitFactor:null };
  const nets=obs.map(o=>o.netBps); const wins=nets.filter(x=>x>0); const losses=nets.filter(x=>x<0);
  const gw=wins.reduce((a,b)=>a+b,0); const gl=Math.abs(losses.reduce((a,b)=>a+b,0));
  return { count:obs.length, meanNetBps:round(nets.reduce((a,b)=>a+b,0)/obs.length), medianNetBps:round(median(nets)), winRate:round(wins.length/obs.length), profitFactor:gl>0?round(gw/gl):(gw>0?'Infinity':null) };
}

function passes(summary, gates) {
  return summary.count>0 && summary.meanNetBps>=gates.meanNetBpsMin && summary.medianNetBps>=gates.medianNetBpsMin && summary.winRate>=gates.winRateMin && (summary.profitFactor==='Infinity' || summary.profitFactor>=gates.profitFactorMin);
}

export function evaluateRpiStudy(rows, protocol=RPI_PROTOCOL) {
  const matured=buildMaturedRpiObservations(rows, protocol);
  const dN=protocol.sequentialSplits.discovery, vN=protocol.sequentialSplits.validation, hN=protocol.sequentialSplits.holdout;
  const discovery=matured.slice(0,dN); const validation=matured.slice(dN,dN+vN);
  const holdoutEligible=matured.length>=dN+vN+hN;
  const holdout=holdoutEligible ? matured.slice(dN+vN,dN+vN+hN) : [];
  const discoverySummary=summarize(discovery); const validationSummary=summarize(validation);
  const validationPass=validation.length===vN && passes(validationSummary, protocol.validationGates);
  const discoveryPass=discovery.length===dN && passes(discoverySummary, protocol.validationGates);
  const candidateStatus = matured.length<dN ? 'ACCUMULATING_DISCOVERY' : matured.length<dN+vN ? 'DISCOVERY_COMPLETE_AWAITING_VALIDATION' : (!discoveryPass || !validationPass ? 'REJECTED_PRE_HOLDOUT' : holdoutEligible ? 'HOLDOUT_READY_FOR_ONE_TIME_AUDIT' : 'VALIDATION_PASS_HOLDOUT_SEALED');
  return {
    studyVersion:protocol.studyVersion, mode:'RESEARCH_ONLY', protocolSha256:RPI_PROTOCOL_SHA256,
    protocol, rawSnapshotCount:rows.length, maturedSignalCount:matured.length,
    sequentialAllocation:{ discoveryCount:discovery.length, validationCount:validation.length, holdoutCount:holdout.length },
    discovery:discoverySummary, validation:validationSummary,
    holdout:{ status:holdoutEligible?'AVAILABLE_ONE_TIME_AUDIT_NOT_FOR_RANKING':'SEALED', count:holdout.length, metrics:holdoutEligible?summarize(holdout):null },
    candidateStatus, forwardPaperEligible:false,
    observations:matured,
  };
}

export function runRpiStudy(input, out) {
  const rows=parseRpiJsonl(fs.readFileSync(input,'utf8'));
  const report=evaluateRpiStudy(rows);
  if (out) { fs.mkdirSync(path.dirname(out),{recursive:true}); fs.writeFileSync(out,`${JSON.stringify(report,null,2)}\n`); }
  return report;
}

if (process.argv[1] && process.argv[1].endsWith('rpiDepthImbalanceStudy.mjs')) {
  const args=process.argv.slice(2); const input=args.find(a=>!a.startsWith('--'));
  const oi=args.indexOf('--out'); const out=oi>=0?args[oi+1]:undefined;
  if (!input) { console.error('usage: node rpiDepthImbalanceStudy.mjs <rpi-orderbook.jsonl> [--out file]'); process.exitCode=2; }
  else console.log(JSON.stringify(runRpiStudy(input,out),null,2));
}
