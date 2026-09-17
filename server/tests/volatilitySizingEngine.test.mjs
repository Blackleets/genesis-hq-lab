import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateVolatilitySizing, sizeFromForecast, logReturnsFromCloses } from '../risk/volatilitySizingEngine.mjs';

test('position sizing can reduce but never increase baseline risk',()=>{
  assert.equal(sizeFromForecast({forecastSigma:0.04,targetSigma:0.02}).multiplier,0.5);
  assert.equal(sizeFromForecast({forecastSigma:0.01,targetSigma:0.02}).multiplier,1);
  assert.equal(sizeFromForecast({forecastSigma:1,targetSigma:0.01,minMultiplier:0.25}).multiplier,0.25);
});

test('insufficient evidence keeps baseline PAPER size',()=>{
  const x=evaluateVolatilitySizing([100,101,100.5,102,101.5]);
  assert.equal(x.validated,false);
  assert.equal(x.positionSizeMultiplier,1);
  assert.equal(x.directionAuthority,false);
  assert.equal(x.canIncreaseSize,false);
});

test('model competition uses holdout and preserves no-direction authority',()=>{
  const closes=[100];
  let p=100;
  for(let i=1;i<700;i++){
    const amp=i<350?0.002:(i%40<8?0.018:0.003);
    const r=amp*Math.sin(i*0.73)+0.0008*Math.cos(i*0.17);
    p*=Math.exp(r); closes.push(p);
  }
  const x=evaluateVolatilitySizing(closes,{periodsPerYear:365*24,minHistory:220,minHoldout:60});
  assert.ok(x.holdoutSamples>=60);
  assert.ok(['ROLLING_RV','EWMA','GARCH_1_1'].includes(x.model));
  assert.equal(x.validation.noLookaheadSplit,true);
  assert.ok(x.shadowMultiplier>=0.25&&x.shadowMultiplier<=1);
  assert.ok(x.positionSizeMultiplier>=0.25&&x.positionSizeMultiplier<=1);
  assert.equal(x.executionAuthority,false);
  assert.equal(x.liveEligible,false);
});

test('log returns ignore invalid non-positive prices',()=>{
  const r=logReturnsFromCloses([100,101,0,102,103]);
  assert.equal(r.length,2);
});
