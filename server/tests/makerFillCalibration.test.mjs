import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAKER_FILL_CALIBRATION_MODE,
  MAKER_FILL_CALIBRATION_VERSION,
  calibrateMakerFillProbability,
  lookupConservativeFillProbability,
  makerFillPolicyHash,
  normalizeFillObservation,
  wilsonLowerBound,
} from '../genesis/makerFillCalibration.mjs';

function rows(count, overrides = {}, startIndex = 0) {
  return Array.from({ length: count }, (_, i) => {
    const n = startIndex + i;
    return {
      side: 'BUY',
      targetHorizonMs: 10_000,
      queueCoverage: 1.4,
      spreadBps: 3,
      fillRatio: n % 2 === 0 ? 1 : 0,
      adverseSelectionBps: n % 2 === 0 ? 2 + (n % 5) : null,
      spreadCaptureBps: n % 2 === 0 ? 1.5 : null,
      observedAt: new Date(Date.UTC(2026, 8, 18, 12, 0, n)).toISOString(),
      ...overrides,
    };
  });
}

function validatedRows({ holdoutFillRatio = 0, extra = 0 } = {}) {
  return [
    ...rows(100, { fillRatio: 1 }, 0),
    ...rows(50, {}, 100),
    ...rows(50, { fillRatio: holdoutFillRatio }, 150),
    ...rows(extra, { fillRatio: 1 }, 200),
  ];
}

test('calibration remains research-only with a stable protocol hash', () => {
  const report = calibrateMakerFillProbability(rows(10));
  assert.equal(report.mode, MAKER_FILL_CALIBRATION_MODE);
  assert.equal(report.version, MAKER_FILL_CALIBRATION_VERSION);
  assert.equal(report.executionAuthority, false);
  assert.equal(report.liveLocked, true);
  assert.match(report.protocolSha256, /^[a-f0-9]{64}$/);
  assert.equal(report.protocolSha256, makerFillPolicyHash(report.policy));
});

test('fewer than 100 observations only accumulate calibration and expose no usable probability', () => {
  const report = calibrateMakerFillProbability(rows(99, { fillRatio: 1 }));
  const cohort = report.cohorts[0];
  assert.equal(cohort.status, 'ACCUMULATING_CALIBRATION');
  assert.equal(cohort.calibration.count, 99);
  assert.equal(cohort.calibration.complete, false);
  assert.equal(cohort.validation.count, 0);
  assert.equal(cohort.validation.metrics, null);
  assert.equal(cohort.holdout.metrics, null);
  assert.equal(cohort.usableFillProbability, null);
  assert.equal(cohort.eligibleForShadowCalibration, false);
});

test('100 calibration observations do not become usable before validation', () => {
  const report = calibrateMakerFillProbability(rows(100, { fillRatio: 1 }));
  const cohort = report.cohorts[0];
  assert.equal(cohort.status, 'CALIBRATION_COMPLETE_AWAITING_VALIDATION');
  assert.equal(cohort.calibration.complete, true);
  assert.equal(cohort.validation.complete, false);
  assert.equal(cohort.usableFillProbability, null);
  assert.equal(lookupConservativeFillProbability(report, {
    side: 'BUY',
    targetHorizonMs: 10_000,
    queueCoverage: 1.2,
    spreadBps: 4,
  }), null);
});

test('partial validation remains sealed while accumulating', () => {
  const report = calibrateMakerFillProbability([
    ...rows(100, { fillRatio: 1 }, 0),
    ...rows(49, { fillRatio: 0 }, 100),
  ]);
  const cohort = report.cohorts[0];
  assert.equal(cohort.validation.count, 49);
  assert.equal(cohort.validation.complete, false);
  assert.equal(cohort.validation.status, 'SEALED_ACCUMULATING');
  assert.equal(cohort.validation.metrics, null);
  assert.equal(cohort.usableFillProbability, null);
});

test('150 observations reveal completed validation and use the more conservative lower bound', () => {
  const observations = [
    ...rows(100, { fillRatio: 1 }, 0),
    ...rows(50, {}, 100), // 25 fills / 50
  ];
  const report = calibrateMakerFillProbability(observations);
  const cohort = report.cohorts[0];
  const expected = Math.min(
    wilsonLowerBound(100, 100, 1.96),
    wilsonLowerBound(25, 50, 1.96),
  );
  assert.equal(cohort.status, 'VALIDATED_RESEARCH_HOLDOUT_ACCUMULATING');
  assert.equal(cohort.validation.complete, true);
  assert.equal(cohort.validation.metrics.sampleSize, 50);
  assert.equal(cohort.validation.metrics.fills, 25);
  assert.equal(cohort.usableFillProbability, expected);
  assert.equal(cohort.eligibleForShadowCalibration, true);
  assert.equal(lookupConservativeFillProbability(report, {
    side: 'BUY',
    targetHorizonMs: 10_000,
    queueCoverage: 1.2,
    spreadBps: 4,
  }), expected);
});

test('holdout outcomes are sealed and cannot alter routine calibration output', () => {
  const losses = calibrateMakerFillProbability(validatedRows({ holdoutFillRatio: 0 }));
  const wins = calibrateMakerFillProbability(validatedRows({ holdoutFillRatio: 1 }));
  const a = losses.cohorts[0];
  const b = wins.cohorts[0];
  assert.equal(a.status, 'HOLDOUT_READY_ONE_TIME_AUDIT');
  assert.equal(a.holdout.count, 50);
  assert.equal(a.holdout.complete, true);
  assert.equal(a.holdout.metrics, null);
  assert.deepEqual(a, b);
});

test('rows after the first 200 cannot alter the locked protocol allocation', () => {
  const base = calibrateMakerFillProbability(validatedRows({ holdoutFillRatio: 0 }));
  const extra = calibrateMakerFillProbability(validatedRows({ holdoutFillRatio: 0, extra: 30 }));
  const a = base.cohorts[0];
  const b = extra.cohorts[0];
  assert.equal(a.usableFillProbability, b.usableFillProbability);
  assert.deepEqual(a.calibration, b.calibration);
  assert.deepEqual(a.validation, b.validation);
  assert.deepEqual(a.holdout, b.holdout);
  assert.equal(b.postProtocolObservationCount, 30);
});

test('chronological allocation is deterministic even when input order is reversed', () => {
  const observations = validatedRows({ holdoutFillRatio: 0 });
  const forward = calibrateMakerFillProbability(observations);
  const reversed = calibrateMakerFillProbability([...observations].reverse());
  assert.deepEqual(forward.cohorts, reversed.cohorts);
});

test('BUY SELL and horizon cohorts never mix', () => {
  const report = calibrateMakerFillProbability([
    ...rows(10, { side: 'BUY', targetHorizonMs: 1_000 }, 0),
    ...rows(10, { side: 'SELL', targetHorizonMs: 1_000 }, 20),
    ...rows(10, { side: 'BUY', targetHorizonMs: 3_000 }, 40),
  ]);
  assert.equal(report.cohorts.length, 3);
  assert.deepEqual(
    report.cohorts.map(x => [x.targetHorizonMs, x.side]),
    [[1_000, 'BUY'], [1_000, 'SELL'], [3_000, 'BUY']],
  );
});

test('queue coverage and spread buckets remain separated', () => {
  const report = calibrateMakerFillProbability([
    ...rows(10, { queueCoverage: 0.7, spreadBps: 3 }, 0),
    ...rows(10, { queueCoverage: 2.5, spreadBps: 6 }, 20),
  ]);
  assert.equal(report.cohorts.length, 2);
  assert.notEqual(report.cohorts[0].queueBucket, report.cohorts[1].queueBucket);
  assert.notEqual(report.cohorts[0].spreadBucket, report.cohorts[1].spreadBucket);
});

test('malformed evidence and unsupported horizons are rejected instead of coerced', () => {
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

test('durable v1 and drifted v2 observations fail closed', () => {
  const base = {
    ...rows(1)[0],
    schemaVersion: 1,
    version: 'maker_queue_depletion_tape_v2_exact_flow_horizon',
    flowHorizonMs: 10_000,
    markoutHorizonDriftRatio: 0.1,
  };
  assert.equal(normalizeFillObservation({
    ...base,
    version: 'maker_queue_depletion_tape_v1',
  }), null);
  assert.equal(normalizeFillObservation({ ...base, flowHorizonMs: 11_000 }), null);
  assert.equal(normalizeFillObservation({ ...base, markoutHorizonDriftRatio: 0.251 }), null);
  assert.notEqual(normalizeFillObservation(base), null);
});

test('invalid sequential split policy is rejected', () => {
  assert.throws(
    () => calibrateMakerFillProbability(rows(1), { validationSamplesPerCohort: 0 }),
    /invalid_validationSamplesPerCohort/,
  );
});


test('protocol hash is reproducible from the persisted JSON policy', () => {
  const report = calibrateMakerFillProbability(rows(10));
  const persistedPolicy = JSON.parse(JSON.stringify(report.policy));
  assert.equal(makerFillPolicyHash(persistedPolicy), report.protocolSha256);
  assert.equal(persistedPolicy.queueCoverageBuckets.at(-1).max, null);
  assert.equal(persistedPolicy.spreadBucketsBps.at(-1).max, null);
});
