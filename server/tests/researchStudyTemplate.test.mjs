import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RESEARCH_TEMPLATE_EXECUTION_AUTHORITY,
  TEMPLATE_PROTOCOL,
  evaluateTemplateStudy,
  protocolSha256,
} from '../research/templates/researchStudyTemplate.mjs';

test('research template has no execution authority and stable protocol hash', () => {
  assert.equal(RESEARCH_TEMPLATE_EXECUTION_AUTHORITY, false);
  assert.match(protocolSha256(TEMPLATE_PROTOCOL), /^[a-f0-9]{64}$/);
  assert.equal(protocolSha256(TEMPLATE_PROTOCOL), protocolSha256(TEMPLATE_PROTOCOL));
});

test('template fails closed on insufficient observations', () => {
  const r = evaluateTemplateStudy([
    { grossBps: 25, sourceTimestamp: 1000, capturedAt: new Date(1000).toISOString() },
  ], { ...TEMPLATE_PROTOCOL, minimumObservations: 2 });
  assert.equal(r.verdict, 'INSUFFICIENT_DATA');
});

test('template rejects future timestamps and null numeric evidence', () => {
  const r = evaluateTemplateStudy([
    { grossBps: null, sourceTimestamp: 1000, capturedAt: new Date(1000).toISOString() },
    { grossBps: 25, sourceTimestamp: 2000, capturedAt: new Date(1000).toISOString() },
    { grossBps: 25, sourceTimestamp: 1000, capturedAt: new Date(1000).toISOString() },
  ], { ...TEMPLATE_PROTOCOL, minimumObservations: 1 });
  assert.equal(r.observationCount, 1);
  assert.equal(r.rejectedObservationCount, 2);
  assert.equal(r.verdict, 'SURVIVES_INITIAL_SCREEN');
});

test('explicit costs can reject a positive gross study', () => {
  const observations = [
    { grossBps: 5, sourceTimestamp: 1000, capturedAt: new Date(1000).toISOString() },
    { grossBps: 6, sourceTimestamp: 2000, capturedAt: new Date(2000).toISOString() },
  ];
  const r = evaluateTemplateStudy(observations, {
    ...TEMPLATE_PROTOCOL,
    minimumObservations: 2,
    roundTripCostBps: 10,
  });
  assert.ok(r.meanNetBps < 0);
  assert.equal(r.verdict, 'REJECTED');
});
