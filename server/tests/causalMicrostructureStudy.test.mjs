import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyHypothesis, classifyControlSide, evaluateStudy, ROUND_TRIP_COST_BPS } from '../research/causalMicrostructureStudy.mjs';

function state({ at, px, oi=0.05, taker=1.4, delta=0.2, premium=-2, funding=0.00005, vol='normal', safe=true } = {}) {
  return {
    safeForResearch: safe,
    provider: 'okx', symbol: 'BTCUSDT', capturedAt: at,
    features: { perpCloseNow: px, takerBias: taker, premiumNowBps: premium, fundingRateNow: funding, volatilityState: vol },
    crossCapture: { available: true, oiCrossCaptureChangePct: oi, takerBiasCrossCaptureChange: delta },
  };
}

test('classifyHypothesis accepts predeclared LONG and rejects volatility shock', () => {
  const s = state({ at:'2026-09-09T10:00:00Z', px:100 });
  assert.equal(classifyHypothesis(s), 'LONG');
  assert.equal(classifyHypothesis({ ...s, features:{...s.features, volatilityState:'shock'} }), null);
});

test('classifyHypothesis has symmetric SHORT rule', () => {
  const s = state({ at:'2026-09-09T10:00:00Z', px:100, taker:0.7, delta:-0.2, premium:2, funding:-0.00005 });
  assert.equal(classifyHypothesis(s), 'SHORT');
});

test('control is strong taker-only state and excludes full H1', () => {
  const h1 = state({ at:'2026-09-09T10:00:00Z', px:100 });
  const control = state({ at:'2026-09-09T10:00:00Z', px:100, oi:0, taker:1.4, delta:0, premium:2 });
  assert.equal(classifyControlSide(h1), null);
  assert.equal(classifyControlSide(control), 'LONG');
});

test('evaluateStudy uses only forward snapshots and subtracts fixed round-trip costs', () => {
  const states = [
    state({ at:'2026-09-09T10:00:00Z', px:100 }),
    state({ at:'2026-09-09T10:15:00Z', px:100.2, oi:0, taker:1, delta:0, premium:0 }),
  ];
  const r = evaluateStudy(states);
  assert.equal(r.observationCount, 1);
  assert.equal(r.sufficient, false);
  assert.equal(r.decision, 'INSUFFICIENT_DATA');
  assert.equal(r.observations[0].costBps, ROUND_TRIP_COST_BPS);
  assert.ok(Math.abs(r.observations[0].grossBps - 20) < 1e-9);
  assert.ok(Math.abs(r.observations[0].netBps - 10) < 1e-9);
});

test('study reports control cohort separately and computes uplift', () => {
  const states = [
    state({ at:'2026-09-09T10:00:00Z', px:100 }),
    state({ at:'2026-09-09T10:01:00Z', px:100, oi:0, taker:1.4, delta:0, premium:2 }),
    state({ at:'2026-09-09T10:15:00Z', px:100.2, oi:0, taker:1, delta:0, premium:0 }),
    state({ at:'2026-09-09T10:16:00Z', px:100.1, oi:0, taker:1, delta:0, premium:0 }),
  ];
  const r = evaluateStudy(states);
  assert.equal(r.observationCount, 1);
  assert.equal(r.control.observationCount, 1);
  assert.equal(r.control.observations[0].cohort, 'TAKER_ONLY_CONTROL');
  assert.equal(r.observations[0].cohort, 'H1');
  assert.ok(Number.isFinite(r.upliftMeanNetBps));
});

test('study refuses initial survival unless both H1 and control meet minimum sample', () => {
  const states=[];
  for(let i=0;i<10;i++) states.push(state({ at:new Date(Date.parse('2026-09-09T10:00:00Z')+i*15*60*1000).toISOString(), px:100+i*0.1 }));
  const r=evaluateStudy(states);
  assert.equal(r.sufficient,false);
  assert.equal(r.decision,'INSUFFICIENT_DATA');
  assert.equal(r.control.sufficient,false);
});
