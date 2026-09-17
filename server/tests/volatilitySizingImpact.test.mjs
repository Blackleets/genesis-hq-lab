import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeCounterfactual, evaluateSizingImpact } from '../../src/core/volatilitySizingImpact.mjs';

function rows(n,{base=1,sized=0.8,baseMargin=100,sizedMargin=80}={}){
  return Array.from({length:n},(_,i)=>{
    const sign=i%3===0?-1:1;
    return {baselinePnlUsd:sign*base,sizedPnlUsd:sign*sized,baselineMarginUsd:baseMargin,sizedMarginUsd:sizedMargin};
  });
}

test('counterfactual keeps same trade count and computes both arms',()=>{
  const r=rows(30);
  const a=summarizeCounterfactual(r);
  const b=summarizeCounterfactual(r,'sizedPnlUsd','sizedMarginUsd');
  assert.equal(a.trades,30); assert.equal(b.trades,30);
});

test('losing baseline that loses less is risk improvement only, never edge',()=>{
  const r=Array.from({length:60},(_,i)=>({
    baselinePnlUsd:i%4===0?1:-2,
    sizedPnlUsd:i%4===0?0.8:-1,
    baselineMarginUsd:100,sizedMarginUsd:80,
  }));
  const x=evaluateSizingImpact(r,{minHoldoutTrades:15});
  assert.equal(x.classification,'RISK_IMPROVEMENT_ONLY');
  assert.equal(x.eligibleForPaperSizing,false);
});

test('insufficient holdout never grants paper sizing eligibility',()=>{
  const x=evaluateSizingImpact(rows(10),{minHoldoutTrades:20});
  assert.equal(x.classification,'INSUFFICIENT_EVIDENCE');
  assert.equal(x.eligibleForPaperSizing,false);
});

test('impact object preserves no live authority invariant',()=>{
  const x=evaluateSizingImpact(rows(60),{minHoldoutTrades:15});
  assert.equal(x.invariants.liveEligible,false);
  assert.equal(x.invariants.executionAuthority,false);
  assert.equal(x.invariants.sameTrades,true);
});
