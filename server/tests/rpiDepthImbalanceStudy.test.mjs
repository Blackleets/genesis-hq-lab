import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RPI_PROTOCOL, RPI_PROTOCOL_SHA256, buildMaturedRpiObservations, evaluateRpiStudy } from '../research/rpiDepthImbalanceStudy.mjs';

function row(minute, imbalance, price) {
  return { schemaVersion:2, mode:'RESEARCH_ONLY', provider:'okx', capturedAt:new Date(Date.UTC(2026,8,9,12,minute,0)).toISOString(), features:{ rpiMidPrice:price, rpiDepthImbalance:imbalance } };
}

test('protocol is frozen with virgin sequential holdout and fixed costs', () => {
  assert.equal(RPI_PROTOCOL.roundTripCostBps, 10);
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

test('holdout remains sealed and Forward PAPER stays false with insufficient sample', () => {
  const report=evaluateRpiStudy([row(0,0.7,100),row(15,0,101)]);
  assert.equal(report.maturedSignalCount,1);
  assert.equal(report.holdout.status,'SEALED');
  assert.equal(report.candidateStatus,'ACCUMULATING_DISCOVERY');
  assert.equal(report.forwardPaperEligible,false);
});

test('chronological allocation never moves early observations into validation or holdout', () => {
  const rows=[];
  for (let i=0;i<121;i++) rows.push({ schemaVersion:2, mode:'RESEARCH_ONLY', provider:'okx', capturedAt:new Date(Date.UTC(2026,8,1,0,i*15,0)).toISOString(), features:{ rpiMidPrice:100+i*0.01, rpiDepthImbalance:i%2?0.7:-0.7 } });
  const report=evaluateRpiStudy(rows);
  assert.equal(report.sequentialAllocation.discoveryCount,60);
  assert.equal(report.sequentialAllocation.validationCount,30);
  assert.equal(report.sequentialAllocation.holdoutCount,30);
  assert.equal(report.holdout.status,'AVAILABLE_ONE_TIME_AUDIT_NOT_FOR_RANKING');
});
