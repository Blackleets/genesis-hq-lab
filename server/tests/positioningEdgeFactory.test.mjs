import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePositioningStudy } from '../research/runPositioningEdgeFactory.mjs';

function row(i,{funding=0.0002,oi=0.2,taker=-0.2,ret=10,vol=1.3}={}){
  return {
    mode:'RESEARCH_ONLY', provider:'okx_public_market_data', schemaVersion:4,
    capturedAt:new Date(Date.UTC(2026,0,1,0,i,0)).toISOString(),
    price:{close:100+i},
    positioning:{fundingRateNow:funding,volatilityExpansionRatio:vol},
    crossCapture:{available:true,oiChangePct:oi,takerBuySellRatioDelta:taker,perpReturnBps:ret},
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
  assert.equal(out.liveOrders,false);
  assert.equal(out.executionAuthority,false);
  assert.equal(out.capitalEligible,false);
  assert.equal(out.methodology.selectionUsesHoldout,false);
});
