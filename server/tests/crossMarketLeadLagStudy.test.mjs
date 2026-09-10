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

function row(ts,{spread=0,perp=100,spot=100,basis=0,confirmed=true,bid,ask,bookAgeMs=1_000}={}) {
  const capturedAt=new Date(ts).toISOString();
  const futuresBid=bid ?? perp-0.01;
  const futuresAsk=ask ?? perp+0.01;
  return {
    schemaVersion:4, mode:'RESEARCH_ONLY', provider:'okx_public_market_data', capturedAt,
    features:{
      futuresClose:perp,spotClose:spot,returnSpread1mBps:spread,basisBps:basis,
      executionFriction:{
        available:true,
        futures:{available:true,bid:futuresBid,ask:futuresAsk,sourceAsOf:new Date(ts-bookAgeMs).toISOString()},
      },
    },
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
  assert.equal(CROSS_MARKET_PROTOCOL.studyVersion,4);
  assert.equal(CROSS_MARKET_PROTOCOL.sequentialSplits.discovery,60);
  assert.equal(CROSS_MARKET_PROTOCOL.sequentialSplits.validation,30);
  assert.equal(CROSS_MARKET_PROTOCOL.sequentialSplits.holdout,30);
  assert.deepEqual(CROSS_MARKET_PROTOCOL.walkForward.testCounts,[15,15,30]);
  assert.equal(CROSS_MARKET_PROTOCOL.roundTripCostBps,10);
  assert.equal(CROSS_MARKET_PROTOCOL.maxBookAgeMs,30_000);
  assert.match(CROSS_MARKET_PROTOCOL.executionPricePolicy,/LONG_ENTRY_AT_PERP_ASK/);
  assert.match(CROSS_MARKET_PROTOCOL.holdoutPolicy,/PRE_HOLDOUT_FIXED_GATES_PASS/);
  assert.match(CROSS_MARKET_PROTOCOL.holdoutPolicy,/NEVER_USED_FOR_RANKING_OR_TUNING/);
  assert.match(CROSS_MARKET_PROTOCOL.rankingPolicy,/HOLDOUT NEVER RANKS OR TUNES/);
  assert.match(CROSS_MARKET_PROTOCOL_SHA256,/^[a-f0-9]{64}$/);
  const report=evaluateCrossMarketStudy([]);
  assert.equal(report.holdout.status,'SEALED');
  assert.equal(report.forwardPaperEligible,false);
});

test('parser requires schema-v4 read-only confirmed OKX provenance and a fresh executable perp book',()=>{
  const t=Date.UTC(2026,8,9,12,0,0);
  const valid=row(t,{spread:-3});
  const unconfirmed=row(t+60_000,{spread:-3,confirmed:false});
  const wrongProvider={...row(t+120_000,{spread:-3}),provider:'other'};
  const staleBook=row(t+180_000,{spread:-3,bookAgeMs:31_000});
  const legacy={...row(t+240_000,{spread:-3}),schemaVersion:3};
  const parsed=parseCrossMarketJsonl([valid,unconfirmed,wrongProvider,staleBook,legacy].map(JSON.stringify).join('\n'));
  assert.equal(parsed.length,1);
  assert.equal(parsed[0].provider,'okx_public_market_data');
});

test('spot lead uses causal executable ask entry and later bid exit only after 10-25m',()=>{
  const t=Date.UTC(2026,8,9,12,0,0);
  const rows=[
    row(t,{spread:-3,perp:100,bid:99.99,ask:100.01}),
    row(t+5*60_000,{spread:0,perp:100.1,bid:100.09,ask:100.11}),
    row(t+15*60_000,{spread:0,perp:100.3,bid:100.29,ask:100.31}),
  ];
  const obs=buildMaturedCrossMarketObservations(rows);
  assert.equal(obs.length,1);
  assert.equal(obs[0].side,'LONG_PERP');
  assert.equal(obs[0].gapMs,15*60_000);
  assert.equal(obs[0].entryPerpPrice,100.01);
  assert.equal(obs[0].exitPerpPrice,100.29);
  assert.equal(obs[0].entryPriceSource,'PERP_ASK_AT_CAPTURE');
  assert.equal(obs[0].exitPriceSource,'PERP_BID_AT_CAPTURE');
  assert.equal(obs[0].fixedAdditionalCostBps,10);
  assert.ok(obs[0].grossBps>0);
  assert.ok(obs[0].netBps<obs[0].grossBps);
});

test('short signal uses executable bid entry and ask exit',()=>{
  const t=Date.UTC(2026,8,9,12,0,0);
  const rows=[
    row(t,{spread:3,perp:100,bid:99.99,ask:100.01}),
    row(t+15*60_000,{spread:0,perp:99.7,bid:99.69,ask:99.71}),
  ];
  const [obs]=buildMaturedCrossMarketObservations(rows);
  assert.equal(obs.side,'SHORT_PERP');
  assert.equal(obs.entryPerpPrice,99.99);
  assert.equal(obs.exitPerpPrice,99.71);
  assert.equal(obs.entryPriceSource,'PERP_BID_AT_CAPTURE');
  assert.equal(obs.exitPriceSource,'PERP_ASK_AT_CAPTURE');
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

test('holdout remains sealed even at 120 signals when pre-holdout fixed gates fail',()=>{
  const t=Date.UTC(2026,8,1,0,0,0);
  const rows=[];
  for (let i=0;i<120;i++) {
    const entry=t+i*30*60_000;
    rows.push(row(entry,{spread:-3,perp:100}));
    rows.push(row(entry+15*60_000,{spread:0,perp:100}));
  }
  const report=evaluateCrossMarketStudy(rows);
  assert.equal(report.maturedSignalCount,120);
  assert.equal(report.candidateStatus,'REJECTED_PRE_HOLDOUT');
  assert.equal(report.holdout.status,'SEALED');
  assert.equal(report.holdout.count,0);
  assert.equal(report.holdout.metrics,null);
  assert.equal(report.sequentialAllocation.holdoutCount,0);
  assert.equal(report.forwardPaperEligible,false);
});
