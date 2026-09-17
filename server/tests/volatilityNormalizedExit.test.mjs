import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveVolatilityExit, exitVariantGrid } from '../../src/core/volatilityNormalizedExit.mjs';

test('volatility exit scales horizon volatility instead of sharing one fixed stop',()=>{
  const fast=deriveVolatilityExit({forecastVolAnnualizedPct:60,periodsPerYear:365*24*12,intervalMinutes:5,timeoutHours:8,stopSigma:1,rewardRisk:2});
  const slow=deriveVolatilityExit({forecastVolAnnualizedPct:60,periodsPerYear:365*6,intervalMinutes:240,timeoutHours:240,stopSigma:1,rewardRisk:2});
  assert.equal(fast.ok,true);assert.equal(slow.ok,true);
  assert.ok(fast.stopPct>=0.003);assert.ok(slow.stopPct>=fast.stopPct);
  assert.ok(fast.targetPct>=fast.stopPct);assert.ok(slow.targetPct>=slow.stopPct);
});

test('exit geometry is capped and has no execution authority',()=>{
  const x=deriveVolatilityExit({forecastVolAnnualizedPct:500,periodsPerYear:365,intervalMinutes:1440,timeoutHours:240,stopSigma:1.5,rewardRisk:3});
  assert.equal(x.ok,true);
  assert.ok(x.stopPct<=0.08);assert.ok(x.targetPct<=0.15);
  assert.equal(x.liveEligible,false);assert.equal(x.executionAuthority,false);
});

test('research grid is small and predeclared',()=>{
  const g=exitVariantGrid();
  assert.equal(g.length,16);
  assert.equal(new Set(g.map(x=>x.id)).size,16);
});
