import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAKER_FILL_CALIBRATION_MODE,
  MAKER_FILL_CALIBRATION_VERSION,
  calibrateMakerFillProbability,
  lookupConservativeFillProbability,
  normalizeFillObservation,
  wilsonLowerBound,
} from '../genesis/makerFillCalibration.mjs';

function rows(count, overrides = {}) {
  return Array.from({ length: count }, (_, i) => ({
    side: 'BUY',
    targetHorizonMs: 10_000,
    queueCoverage: 1.4,
    spreadBps: 3,
    fillRatio: i % 2 === 0 ? 1 : 0,
    adverseSelectionBps: i % 2 === 0 ? 2 + (i % 5) : null,
    spreadCaptureBps: i % 2 === 0 ? 1.5 : null,
    observedAt: new Date(Date.UTC(2026, 8, 18, 12, 0, i)).toISOString(),
    ...overrides,
  }));
}

test('calibration remains research-only and fails closed below sample minimum', () => {
  const report = calibrateMakerFillProbability(rows(10));
  assert.equal(report.mode, MAKER_FILL_CALIBRATION_MODE);
  assert.equal(report.version, MAKER_FILL_CALIBRATION_VERSION);
  assert.equal(report.executionAuthority, false);
  assert.equal(report.liveLocked, true);
  assert.equal(report.cohorts.length, 1);
  assert.equal(report.cohorts[0].status, 'INSUFFICIENT_DATA');
  assert.equal(report.cohorts[0].usableFillProbability, null);
  assert.equal(lookupConservativeFillProbability(report, {
    side: 'BUY',
    targetHorizonMs: 10_000,
    queueCoverage: 1.4,
    spreadBps: 3,
  }), null);
});

test('sufficient cohort exposes conservative Wilson lower bound, not sample mean', () => {
  const report = calibrateMakerFillProbability(rows(120));
  const cohort = report.cohorts[0];
  assert.equal(cohort.status, 'CALIBRATED');
  assert.equal(cohort.sampleSize, 120);
  assert.equal(cohort.fills, 60);
  assert.equal(cohort.empiricalFillProbability, 0.5);
  assert.ok(cohort.usableFillProbability > 0);
  assert.ok(cohort.usableFillProbability < cohort.empiricalFillProbability);
  assert.equal(
    cohort.usableFillProbability,
    wilsonLowerBound(60, 120, 1.96),
  );
  assert.equal(cohort.targetHorizonMs, 10_000);
});

test('BUY and SELL observations never share a calibration cohort', () => {
  const report = calibrateMakerFillProbability([
    ...rows(100, { side: 'BUY', fillRatio: 1 }),
    ...rows(100, { side: 'SELL', fillRatio: 0 }),
  ]);
  assert.equal(report.cohorts.length, 2);
  const buy = report.cohorts.find(row => row.side === 'BUY');
  const sell = report.cohorts.find(row => row.side === 'SELL');
  assert.equal(buy.empiricalFillProbability, 1);
  assert.equal(sell.empiricalFillProbability, 0);
});

test('1s 3s and 10s horizons never share a cohort', () => {
  const report = calibrateMakerFillProbability([
    ...rows(100, { targetHorizonMs: 1_000, fillRatio: 0 }),
    ...rows(100, { targetHorizonMs: 3_000, fillRatio: 0.5 }),
    ...rows(100, { targetHorizonMs: 10_000, fillRatio: 1 }),
  ]);
  assert.equal(report.cohorts.length, 3);
  assert.deepEqual(report.cohorts.map(row => row.targetHorizonMs), [1_000, 3_000, 10_000]);
});

test('queue coverage and spread buckets remain separated', () => {
  const report = calibrateMakerFillProbability([
    ...rows(100, { queueCoverage: 0.7, spreadBps: 3, fillRatio: 0 }),
    ...rows(100, { queueCoverage: 2.5, spreadBps: 6, fillRatio: 1 }),
  ]);
  assert.equal(report.cohorts.length, 2);
  assert.notEqual(report.cohorts[0].queueBucket, report.cohorts[1].queueBucket);
  assert.notEqual(report.cohorts[0].spreadBucket, report.cohorts[1].spreadBucket);
});

test('malformed evidence and unsupported horizons are rejected rather than coerced', () => {
  const valid = rows(1)[0];
  const report = calibrateMakerFillProbability([
    valid,
    { ...valid, queueCoverage: '' },
    { ...valid, spreadBps: -1 },
    { ...valid, fillRatio: 1.1 },
    { ...valid, side: 'UNKNOWN' },
    { ...valid, observedAt: 'not-a-time' },
    { ...valid, targetHorizonMs: 2_000 },
    { ...valid, targetHorizonMs: null },
  ]);
  assert.equal(report.rawObservationCount, 8);
  assert.equal(report.validObservationCount, 1);
  assert.equal(report.rejectedObservationCount, 7);
});

test('partial fill counts as a fill but mean fill ratio preserves execution fraction', () => {
  const report = calibrateMakerFillProbability(rows(100, { fillRatio: 0.25 }));
  const cohort = report.cohorts[0];
  assert.equal(cohort.fills, 100);
  assert.equal(cohort.empiricalFillProbability, 1);
  assert.equal(cohort.meanFillRatio, 0.25);
});

test('filled adverse selection is summarized separately from fill probability', () => {
  const report = calibrateMakerFillProbability(rows(100, {
    fillRatio: 1,
    adverseSelectionBps: 4,
    spreadCaptureBps: 2,
  }));
  const cohort = report.cohorts[0];
  assert.equal(cohort.adverseSelectionSamples, 100);
  assert.equal(cohort.adverseSelectionP50Bps, 4);
  assert.equal(cohort.adverseSelectionP75Bps, 4);
  assert.equal(cohort.adverseSelectionP90Bps, 4);
  assert.equal(cohort.meanSpreadCaptureBps, 2);
});

test('lookup requires the exact calibrated horizon and matching cohort', () => {
  const report = calibrateMakerFillProbability(rows(100, { fillRatio: 1 }));
  const p = lookupConservativeFillProbability(report, {
    side: 'BUY',
    targetHorizonMs: 10_000,
    queueCoverage: 1.2,
    spreadBps: 4,
  });
  assert.ok(p > 0 && p < 1);
  assert.equal(lookupConservativeFillProbability(report, {
    side: 'BUY',
    targetHorizonMs: 3_000,
    queueCoverage: 1.2,
    spreadBps: 4,
  }), null);
  assert.equal(lookupConservativeFillProbability(report, {
    side: 'SELL',
    targetHorizonMs: 10_000,
    queueCoverage: 1.2,
    spreadBps: 4,
  }), null);
});

test('normalizer rejects NaN primitives explicitly', () => {
  assert.equal(normalizeFillObservation({
    side: 'BUY',
    targetHorizonMs: 10_000,
    queueCoverage: Number.NaN,
    spreadBps: 2,
    fillRatio: 1,
    observedAt: '2026-09-18T12:00:00Z',
  }), null);
});
