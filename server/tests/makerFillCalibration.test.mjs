import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAKER_FILL_CALIBRATION_MODE,
  calibrateMakerFillProbability,
  lookupConservativeFillProbability,
  normalizeFillObservation,
  wilsonLowerBound,
} from '../genesis/makerFillCalibration.mjs';

function rows(count, overrides = {}) {
  return Array.from({ length: count }, (_, i) => ({
    side: 'BUY',
    queueCoverage: 1.4,
    spreadBps: 3,
    fillRatio: i % 2 === 0 ? 1 : 0,
    observedAt: new Date(Date.UTC(2026, 8, 18, 12, 0, i)).toISOString(),
    ...overrides,
  }));
}

test('calibration remains research-only and fails closed below sample minimum', () => {
  const report = calibrateMakerFillProbability(rows(10));
  assert.equal(report.mode, MAKER_FILL_CALIBRATION_MODE);
  assert.equal(report.cohorts.length, 1);
  assert.equal(report.cohorts[0].status, 'INSUFFICIENT_DATA');
  assert.equal(report.cohorts[0].usableFillProbability, null);
  assert.equal(lookupConservativeFillProbability(report, {
    side: 'BUY',
    queueCoverage: 1.4,
    spreadBps: 3,
  }), null);
});

test('sufficient cohort exposes conservative Wilson lower bound, not sample mean', () => {
  const report = calibrateMakerFillProbability(rows(40));
  const cohort = report.cohorts[0];
  assert.equal(cohort.status, 'CALIBRATED');
  assert.equal(cohort.sampleSize, 40);
  assert.equal(cohort.fills, 20);
  assert.equal(cohort.empiricalFillProbability, 0.5);
  assert.ok(cohort.usableFillProbability > 0);
  assert.ok(cohort.usableFillProbability < cohort.empiricalFillProbability);
  assert.equal(
    cohort.usableFillProbability,
    wilsonLowerBound(20, 40, 1.96),
  );
});

test('BUY and SELL observations never share a calibration cohort', () => {
  const report = calibrateMakerFillProbability([
    ...rows(30, { side: 'BUY', fillRatio: 1 }),
    ...rows(30, { side: 'SELL', fillRatio: 0 }),
  ]);
  assert.equal(report.cohorts.length, 2);
  const buy = report.cohorts.find(row => row.side === 'BUY');
  const sell = report.cohorts.find(row => row.side === 'SELL');
  assert.equal(buy.empiricalFillProbability, 1);
  assert.equal(sell.empiricalFillProbability, 0);
});

test('queue coverage and spread buckets remain separated', () => {
  const report = calibrateMakerFillProbability([
    ...rows(30, { queueCoverage: 0.7, spreadBps: 3, fillRatio: 0 }),
    ...rows(30, { queueCoverage: 2.5, spreadBps: 6, fillRatio: 1 }),
  ]);
  assert.equal(report.cohorts.length, 2);
  assert.notEqual(report.cohorts[0].queueBucket, report.cohorts[1].queueBucket);
  assert.notEqual(report.cohorts[0].spreadBucket, report.cohorts[1].spreadBucket);
});

test('malformed evidence is rejected rather than coerced into a cohort', () => {
  const valid = rows(1)[0];
  const report = calibrateMakerFillProbability([
    valid,
    { ...valid, queueCoverage: '' },
    { ...valid, spreadBps: -1 },
    { ...valid, fillRatio: 1.1 },
    { ...valid, side: 'UNKNOWN' },
    { ...valid, observedAt: 'not-a-time' },
  ]);
  assert.equal(report.rawObservationCount, 6);
  assert.equal(report.validObservationCount, 1);
  assert.equal(report.rejectedObservationCount, 5);
});

test('partial fill counts as a fill but mean fill ratio preserves execution fraction', () => {
  const report = calibrateMakerFillProbability(rows(30, { fillRatio: 0.25 }));
  const cohort = report.cohorts[0];
  assert.equal(cohort.fills, 30);
  assert.equal(cohort.empiricalFillProbability, 1);
  assert.equal(cohort.meanFillRatio, 0.25);
});

test('lookup uses only calibrated matching cohort', () => {
  const report = calibrateMakerFillProbability(rows(30, { fillRatio: 1 }));
  const p = lookupConservativeFillProbability(report, {
    side: 'BUY',
    queueCoverage: 1.2,
    spreadBps: 4,
  });
  assert.ok(p > 0 && p < 1);
  assert.equal(lookupConservativeFillProbability(report, {
    side: 'SELL',
    queueCoverage: 1.2,
    spreadBps: 4,
  }), null);
});

test('normalizer rejects future-irrelevant malformed primitives explicitly', () => {
  assert.equal(normalizeFillObservation({
    side: 'BUY',
    queueCoverage: Number.NaN,
    spreadBps: 2,
    fillRatio: 1,
    observedAt: '2026-09-18T12:00:00Z',
  }), null);
});
