import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RPI_PROTOCOL, RPI_PROTOCOL_SHA256, buildMaturedRpiObservations, selectIndependentRpiObservations, evaluateRpiStudy } from '../research/rpiDepthImbalanceStudy.mjs';

function row(minute, imbalance, price) {
  return { schemaVersion:2, mode:'RESEARCH_ONLY', provider:'okx', capturedAt:new Date(Date.UTC(2026,8,9,12,minute,0)).toISOString(), features:{ rpiMidPrice:price, rpiDepthImbalance:imbalance } };
}

test('protocol v2 is frozen with virgin sequential holdout, fixed costs and 25m independence embargo', () => {
  assert.equal(RPI_PROTOCOL.studyVersion, 2);
  assert.equal(RPI_PROTOCOL.roundTripCostBps, 10);
  assert.equal(RPI_PROTOCOL.independenceEmbargoMs, 25*60*1000);
  assert.match(RPI_PROTOCOL.independencePolicy, /EMBARGO/);
  assert.deepEqual(RPI_PROTOCOL.sequentialSplits, { discovery:60, validation:30, holdout:30 });
  assert.match(RPI_PROTOCOL.holdoutPolicy, /NEVER_USED_FOR_RANKING_OR_TUNING/);
  assert.match(RPI_PROTOCOL_SHA256, /^[a-f0-9]{64}$/);
});

test('only extreme imbalance signals mature inside fixed 10-25m window', () => {
  const rows=[row(0,0.7,100),row(5,0.1,101),row(15,0.1,102),row(30,-0.7,102),row(45,0.0,100)];
  const obs=buildMaturedRpiObservations(rows);
  assert.equal(obs.length,2);
  assert.equal(obs[0].side,'LONG');
  assert.equal(obs[0].gapMs,15*60*1000);
  assert.equal(obs[1].side,'SHORT');
  assert.ok(obs[0].netBps < obs[0].grossBps);
});

test('overlapping matured signals count as one independent evidence unit', () => {
  const rows=[
    row(0,0.8,100), row(10,0.75,100.2), row(15,0.1,100.4),
    row(25,0.1,100.3), row(30,-0.8,100.1), row(45,0,99.8),
  ];
  const raw=buildMaturedRpiObservations(rows);
  assert.equal(raw.length,3);
  const independent=selectIndependentRpiObservations(raw);
  assert.equal(independent.accepted.length,2);
  assert.equal(independent.rejected.length,1);
  assert.equal(independent.rejected[0].reason,'OVERLAPPING_FORWARD_WINDOW');
});

test('study exposes raw versus independent matured counts and allocates only independent observations', () => {
  const rows=[
    row(0,0.8,100), row(10,0.75,100.2), row(15,0.1,100.4),
    row(25,0.1,100.3), row(30,-0.8,100.1), row(45,0,99.8),
  ];
  const report=evaluateRpiStudy(rows);
  assert.equal(report.rawMaturedSignalCount,3);
  assert.equal(report.maturedSignalCount,2);
  assert.equal(report.independence.rejectedOverlapCount,1);
  assert.equal(report.sequentialAllocation.discoveryCount,2);
});

test('holdout remains sealed and Forward PAPER stays false with insufficient independent sample', () => {
  const report=evaluateRpiStudy([row(0,0.7,100),row(15,0,101)]);
  assert.equal(report.maturedSignalCount,1);
  assert.equal(report.holdout.status,'SEALED');
  assert.equal(report.candidateStatus,'ACCUMULATING_DISCOVERY');
  assert.equal(report.forwardPaperEligible,false);
});

test('chronological allocation never moves early independent observations into validation or holdout', () => {
  const rows=[];
  for (let i=0;i<241;i++) rows.push({ schemaVersion:2, mode:'RESEARCH_ONLY', provider:'okx', capturedAt:new Date(Date.UTC(2026,8,1,0,i*15,0)).toISOString(), features:{ rpiMidPrice:100+i*0.01, rpiDepthImbalance:i%2?0.7:-0.7 } });
  const report=evaluateRpiStudy(rows);
  assert.equal(report.sequentialAllocation.discoveryCount,60);
  assert.equal(report.sequentialAllocation.validationCount,30);
  assert.equal(report.sequentialAllocation.holdoutCount,30);
  assert.equal(report.holdout.status,'AVAILABLE_ONE_TIME_AUDIT_NOT_FOR_RANKING');
});
