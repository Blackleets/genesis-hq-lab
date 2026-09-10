import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CROSS_MARKET_PROTOCOL,
  CROSS_MARKET_PROTOCOL_SHA256,
  parseCrossMarketJsonl,
  buildMaturedCrossMarketObservations,
  selectIndependentCrossMarketObservations,
  evaluatePreHoldoutWalkForward,
  evaluateCrossMarketStudy,
} from '../research/crossMarketLeadLagStudy.mjs';

function row(ts,{spread=0,perp=100,spot=100,basis=0,confirmed=true}={}) {
  return {
    schemaVersion:1, mode:'RESEARCH_ONLY', provider:'okx_public_market_data', capturedAt:new Date(ts).toISOString(),
    features:{futuresClose:perp,spotClose:spot,returnSpread1mBps:spread,basisBps:basis},
    provenance:{confirmedBarsOnly:confirmed},
  };
}

function observation(i,netBps=5) {
  return {
    entryCapturedAt:new Date(Date.UTC(2026,8,1)+i*30*60_000).toISOString(),
    exitCapturedAt:new Date(Date.UTC(2026,8,1)+i*30*60_000+15*60_000).toISOString(),
    netBps,
  };
}

test('protocol is explicit, hashed, holdout-sealed, and never forward-paper eligible by default',()=>{
  assert.equal(CROSS_MARKET_PROTOCOL.studyVersion,2);
  assert.equal(CROSS_MARKET_PROTOCOL.sequentialSplits.discovery,60);
  assert.equal(CROSS_MARKET_PROTOCOL.sequentialSplits.validation,30);
  assert.equal(CROSS_MARKET_PROTOCOL.sequentialSplits.holdout,30);
  assert.deepEqual(CROSS_MARKET_PROTOCOL.walkForward.testCounts,[15,15,30]);
  assert.equal(CROSS_MARKET_PROTOCOL.roundTripCostBps,10);
  assert.match(CROSS_MARKET_PROTOCOL.holdoutPolicy,/NEVER_USED_FOR_RANKING_OR_TUNING/);
  assert.match(CROSS_MARKET_PROTOCOL.rankingPolicy,/HOLDOUT NEVER RANKS OR TUNES/);
  assert.match(CROSS_MARKET_PROTOCOL_SHA256,/^[a-f0-9]{64}$/);
  const report=evaluateCrossMarketStudy([]);
  assert.equal(report.holdout.status,'SEALED');
  assert.equal(report.forwardPaperEligible,false);
});

test('parser requires read-only confirmed OKX provenance',()=>{
  const t=Date.UTC(2026,8,9,12,0,0);
  const valid=row(t,{spread:-3});
  const unconfirmed=row(t+1,{spread:-3,confirmed:false});
  const wrongProvider={...row(t+2,{spread:-3}),provider:'other'};
  const parsed=parseCrossMarketJsonl([valid,unconfirmed,wrongProvider].map(JSON.stringify).join('\n'));
  assert.equal(parsed.length,1);
  assert.equal(parsed[0].provider,'okx_public_market_data');
});

test('spot lead produces causal perp catch-up observation only after 10-25m',()=>{
  const t=Date.UTC(2026,8,9,12,0,0);
  const rows=[
    row(t,{spread:-3,perp:100}),
    row(t+5*60_000,{spread:0,perp:100.1}),
    row(t+15*60_000,{spread:0,perp:100.3}),
  ];
  const obs=buildMaturedCrossMarketObservations(rows);
  assert.equal(obs.length,1);
  assert.equal(obs[0].side,'LONG_PERP');
  assert.equal(obs[0].gapMs,15*60_000);
  assert.ok(obs[0].grossBps>0);
  assert.ok(obs[0].netBps<obs[0].grossBps);
});

test('25m embargo prevents overlapping forward windows from inflating effective sample',()=>{
  const t=Date.UTC(2026,8,9,12,0,0);
  const observations=[
    {entryCapturedAt:new Date(t).toISOString()},
    {entryCapturedAt:new Date(t+5*60_000).toISOString()},
    {entryCapturedAt:new Date(t+25*60_000).toISOString()},
  ];
  const selected=selectIndependentCrossMarketObservations(observations);
  assert.equal(selected.accepted.length,2);
  assert.equal(selected.rejected.length,1);
  assert.equal(selected.rejected[0].reason,'OVERLAPPING_FORWARD_WINDOW');
});

test('walk-forward uses only the 90 pre-holdout observations in expanding OOS folds',()=>{
  const preHoldout=Array.from({length:90},(_,i)=>observation(i,5));
  const audit=evaluatePreHoldoutWalkForward(preHoldout);
  assert.equal(audit.requiredPreHoldoutCount,90);
  assert.equal(audit.complete,true);
  assert.equal(audit.allFoldsPass,true);
  assert.deepEqual(audit.folds.map(f=>[f.trainCount,f.testCount]),[[30,15],[45,15],[60,30]]);
});

test('walk-forward fails closed when any pre-holdout OOS fold is negative without consulting holdout',()=>{
  const preHoldout=Array.from({length:90},(_,i)=>observation(i,(i>=45&&i<60)?-5:5));
  const audit=evaluatePreHoldoutWalkForward(preHoldout);
  assert.equal(audit.complete,true);
  assert.equal(audit.folds[1].pass,false);
  assert.equal(audit.allFoldsPass,false);
  assert.equal(audit.folds.length,3);
});

test('holdout remains sealed before all 120 independent matured signals',()=>{
  const t=Date.UTC(2026,8,9,0,0,0);
  const rows=[];
  for (let i=0;i<10;i++) {
    rows.push(row(t+i*30*60_000,{spread:-3,perp:100+i}));
    rows.push(row(t+i*30*60_000+15*60_000,{spread:0,perp:100+i+0.2}));
  }
  const report=evaluateCrossMarketStudy(rows);
  assert.equal(report.holdout.status,'SEALED');
  assert.equal(report.forwardPaperEligible,false);
  assert.ok(report.maturedSignalCount<120);
});
