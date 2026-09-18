import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXECUTION_AUTHORITY,
  PROTOCOL,
  classifySide,
  evaluateStudy,
  protocolHash,
} from './study.mjs';

function row(minute, price, signalFeature, overrides = {}) {
  return {
    schemaVersion: 1,
    mode: 'RESEARCH_ONLY',
    safeForResearch: true,
    provider: 'synthetic_fixture',
    symbol: 'TEST-USD',
    capturedAt: new Date(Date.UTC(2026, 8, 18, 12, minute, 0)).toISOString(),
    features: { price, signalFeature },
    ...overrides,
  };
}

test('template has no execution authority', () => {
  assert.equal(EXECUTION_AUTHORITY, false);
  assert.equal(evaluateStudy([]).promotionEligible, false);
});

test('protocol hash is stable and explicit', () => {
  assert.match(protocolHash(), /^[a-f0-9]{64}$/);
  assert.equal(PROTOCOL.studyVersion, 1);
});

test('missing or malformed evidence cannot classify a signal', () => {
  assert.equal(classifySide(row(0, 100, null)), null);
  assert.equal(classifySide(row(0, 100, '')), null);
  assert.equal(classifySide(row(0, 100, 'not-a-number')), null);
  assert.equal(classifySide(row(0, 100, 1, { safeForResearch: false })), null);
});

test('synthetic forward evidence is net of declared costs', () => {
  const protocol = {
    ...PROTOCOL,
    minimumObservations: 1,
    horizonMs: 15 * 60 * 1000,
    horizonToleranceMs: 0,
    roundTripCostBps: 10,
  };

  const report = evaluateStudy([
    row(0, 100, 1),
    row(15, 100.20, 0),
  ], protocol);

  assert.equal(report.observationCount, 1);
  assert.ok(Math.abs(report.observations[0].grossBps - 20) < 1e-9);
  assert.ok(Math.abs(report.observations[0].netBps - 10) < 1e-9);
  assert.equal(report.decision, 'SURVIVES_INITIAL_SCREEN');
  assert.equal(report.promotionEligible, false);
});

test('costs can reject a gross-positive synthetic result', () => {
  const protocol = {
    ...PROTOCOL,
    minimumObservations: 1,
    horizonMs: 15 * 60 * 1000,
    horizonToleranceMs: 0,
    roundTripCostBps: 30,
  };

  const report = evaluateStudy([
    row(0, 100, 1),
    row(15, 100.20, 0),
  ], protocol);

  assert.equal(report.observationCount, 1);
  assert.ok(report.observations[0].grossBps > 0);
  assert.ok(report.observations[0].netBps < 0);
  assert.equal(report.decision, 'REJECTED');
});

test('a row outside the forward tolerance is not backfilled with later evidence', () => {
  const protocol = {
    ...PROTOCOL,
    minimumObservations: 1,
    horizonMs: 15 * 60 * 1000,
    horizonToleranceMs: 60 * 1000,
  };

  const report = evaluateStudy([
    row(0, 100, 1),
    row(17, 101, 0),
  ], protocol);

  assert.equal(report.observationCount, 0);
  assert.equal(report.decision, 'INSUFFICIENT_DATA');
});
