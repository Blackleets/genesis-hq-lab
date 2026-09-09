import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePositioningStudy } from '../research/runPositioningEdgeFactory.mjs';

function row(i,{funding=0.0002,oi=0.2,taker=-0.2,ret=10,vol=1.3,minuteStep=1}={}){
  return {
    mode:'RESEARCH_ONLY', provider:'okx_public_market_data', symbol:'BTCUSDT', schemaVersion:4,
    capturedAt:new Date(Date.UTC(2026,0,1,0,i*minuteStep,0)).toISOString(),
    price:{close:100+i},
    positioning:{fundingRateNow:funding,volatilityExpansionRatio:vol,takerWindowMs:60000},
    crossCapture:{available:true,oiChangePct:oi,takerBuySellRatioDelta:taker,perpReturnBps:ret},
    provenance:{takerWindowMs:60000},
  };
}

test('fails closed when positioning cohort is not ready',()=>{
  const out=evaluatePositioningStudy([row(0),row(1)],{qualityPass:false,independentRowCount:3,defects:{excessiveGaps:1}});
  assert.equal(out.verdict,'DATA_NOT_READY');
  assert.equal(out.candidates.length,0);
  assert.equal(out.capitalEligible,false);
  assert.equal(out.methodology.holdoutSealed,true);
});

test('never opens holdout or grants execution authority when study runs',()=>{
  const rows=Array.from({length:30},(_,i)=>row(i));
  const out=evaluatePositioningStudy(rows,{qualityPass:true,independentRowCount:30});
  assert.ok(['NO_EDGE_FOUND','RESEARCH_CANDIDATE_FOUND'].includes(out.verdict));
  assert.equal(out.holdoutOpened,false);
  assert.equal(out.partitions.holdoutOpened,false);
  assert.equal(out.partitions.holdoutMetricsComputed,false);
  assert.ok(out.partitions.sealedHoldoutSamples>0);
  assert.equal(out.liveOrders,false);
  assert.equal(out.executionAuthority,false);
  assert.equal(out.capitalEligible,false);
  assert.equal(out.methodology.selectionUsesHoldout,false);
  assert.equal(out.methodology.temporalOrderPreserved,true);
  assert.equal(out.methodology.independentNonOverlappingRowsOnly,true);
});

test('rejects forward labels that cross excessive time gaps',()=>{
  const rows=[];
  for(let i=0;i<12;i++) rows.push(row(i,{minuteStep:5}));
  rows.push({ ...row(12,{minuteStep:5}), capturedAt:new Date(Date.UTC(2026,0,1,3,0,0)).toISOString() });
  for(let i=13;i<24;i++) rows.push({ ...row(i,{minuteStep:5}), capturedAt:new Date(Date.UTC(2026,0,1,3,(i-12)*5,0)).toISOString() });
  const out=evaluatePositioningStudy(rows,{qualityPass:true,independentRowCount:24},{minIndependentRows:20,maxForwardLabelGapMinutes:30});
  assert.ok(out.dataQuality.rejectedForwardGaps>=1);
  assert.equal(out.methodology.maxForwardLabelGapMinutes,30);
});

test('small usable forward sample remains DATA_NOT_READY even if aggregate quality says pass',()=>{
  const rows=Array.from({length:8},(_,i)=>row(i,{minuteStep:5}));
  const out=evaluatePositioningStudy(rows,{qualityPass:true,independentRowCount:20},{minIndependentRows:20});
  assert.equal(out.verdict,'DATA_NOT_READY');
  assert.equal(out.candidates.length,0);
});
