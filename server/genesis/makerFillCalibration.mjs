// RESEARCH_ONLY empirical maker fill calibration.
// Sequential protocol: calibration -> validation -> sealed holdout.
// No model guesses, no order placement, no live authority.

import { createHash } from 'node:crypto';

export const MAKER_FILL_CALIBRATION_VERSION = 'maker_fill_calibration_v4_sequential_validation';
export const REQUIRED_MAKER_OBSERVATION_VERSION = 'maker_queue_depletion_tape_v2_exact_flow_horizon';
export const MAKER_FILL_CALIBRATION_MODE = 'RESEARCH_ONLY';

export const DEFAULT_FILL_CALIBRATION_POLICY = Object.freeze({
  protocolVersion: 1,
  calibrationSamplesPerCohort: 100,
  validationSamplesPerCohort: 50,
  holdoutSamplesPerCohort: 50,
  wilsonZ: 1.96,
  allowedHorizonsMs: Object.freeze([1_000, 3_000, 10_000]),
  maxMarkoutHorizonDriftRatio: 0.25,
  queueCoverageBuckets: Object.freeze([
    { id: 'lt_0_5', min: 0, max: 0.5 },
    { id: '0_5_to_1', min: 0.5, max: 1 },
    { id: '1_to_2', min: 1, max: 2 },
    { id: 'gte_2', min: 2, max: Infinity },
  ]),
  spreadBucketsBps: Object.freeze([
    { id: 'lt_2', min: 0, max: 2 },
    { id: '2_to_5', min: 2, max: 5 },
    { id: 'gte_5', min: 5, max: Infinity },
  ]),
  holdoutPolicy: 'SEALED_NO_METRICS_IN_ROUTINE_REPORT_ONE_TIME_EXPLICIT_AUDIT_ONLY',
});

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'number' && !Number.isFinite(value)) return JSON.stringify(String(value));
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function makerFillPolicyHash(policy = DEFAULT_FILL_CALIBRATION_POLICY) {
  return createHash('sha256').update(canonical(policy)).digest('hex');
}

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function probability(value) {
  const n = finite(value);
  return n !== null && n >= 0 && n <= 1 ? n : null;
}

function nonNegative(value) {
  const n = finite(value);
  return n !== null && n >= 0 ? n : null;
}

function normalizeSide(value) {
  const side = String(value ?? '').toUpperCase();
  return side === 'BUY' || side === 'SELL' ? side : null;
}

function bucketFor(value, buckets) {
  if (value === null) return null;
  return buckets.find(bucket => value >= bucket.min && value < bucket.max)?.id ?? null;
}

function quantile(values, q) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * q;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  if (lo === hi) return sorted[lo];
  const weight = index - lo;
  return sorted[lo] * (1 - weight) + sorted[hi] * weight;
}

export function wilsonLowerBound(successes, trials, z = 1.96) {
  if (!Number.isInteger(successes) || !Number.isInteger(trials) || trials <= 0 || successes < 0 || successes > trials) {
    return null;
  }
  const zz = z * z;
  const p = successes / trials;
  const denominator = 1 + zz / trials;
  const center = p + zz / (2 * trials);
  const margin = z * Math.sqrt((p * (1 - p) + zz / (4 * trials)) / trials);
  return Math.max(0, (center - margin) / denominator);
}

function summarizeRows(rows = [], z = 1.96) {
  const sampleSize = rows.length;
  if (!sampleSize) {
    return {
      sampleSize: 0,
      fills: 0,
      empiricalFillProbability: null,
      meanFillRatio: null,
      conservativeFillProbability: null,
      adverseSelectionSamples: 0,
      adverseSelectionP50Bps: null,
      adverseSelectionP75Bps: null,
      adverseSelectionP90Bps: null,
      meanSpreadCaptureBps: null,
    };
  }

  const fills = rows.filter(row => row.filled).length;
  const adverseRows = rows
    .filter(row => row.filled && row.adverseSelectionBps !== null)
    .map(row => row.adverseSelectionBps);
  const spreadCaptureRows = rows
    .filter(row => row.filled && row.spreadCaptureBps !== null)
    .map(row => row.spreadCaptureBps);

  return {
    sampleSize,
    fills,
    empiricalFillProbability: fills / sampleSize,
    meanFillRatio: rows.reduce((sum, row) => sum + row.fillRatio, 0) / sampleSize,
    conservativeFillProbability: wilsonLowerBound(fills, sampleSize, z),
    adverseSelectionSamples: adverseRows.length,
    adverseSelectionP50Bps: quantile(adverseRows, 0.50),
    adverseSelectionP75Bps: quantile(adverseRows, 0.75),
    adverseSelectionP90Bps: quantile(adverseRows, 0.90),
    meanSpreadCaptureBps: spreadCaptureRows.length
      ? spreadCaptureRows.reduce((sum, value) => sum + value, 0) / spreadCaptureRows.length
      : null,
  };
}

function validateSequentialPolicy(policy) {
  for (const key of ['calibrationSamplesPerCohort', 'validationSamplesPerCohort', 'holdoutSamplesPerCohort']) {
    if (!Number.isInteger(policy[key]) || policy[key] <= 0) throw new Error(`invalid_${key}`);
  }
  if (!(Number(policy.wilsonZ) > 0)) throw new Error('invalid_wilsonZ');
}

export function normalizeFillObservation(raw = {}, policy = DEFAULT_FILL_CALIBRATION_POLICY) {
  const durableSchema = finite(raw.schemaVersion);
  if (durableSchema !== null && raw.version !== REQUIRED_MAKER_OBSERVATION_VERSION) return null;

  const side = normalizeSide(raw.side);
  const targetHorizonMs = nonNegative(raw.targetHorizonMs);
  const queueCoverage = nonNegative(raw.queueCoverage);
  const spreadBps = nonNegative(raw.spreadBps);
  const fillRatio = probability(raw.fillRatio);
  const adverseSelectionBps = nonNegative(raw.adverseSelectionBps);
  const spreadCaptureBps = nonNegative(raw.spreadCaptureBps);
  const observedAtMs = Date.parse(raw.observedAt ?? raw.capturedAt ?? '');
  const flowHorizonMs = nonNegative(raw.flowHorizonMs);
  const markoutHorizonDriftRatio = nonNegative(raw.markoutHorizonDriftRatio);

  const durableTimingValid =
    durableSchema === null ||
    (
      flowHorizonMs === targetHorizonMs &&
      markoutHorizonDriftRatio !== null &&
      markoutHorizonDriftRatio <= policy.maxMarkoutHorizonDriftRatio
    );

  const horizonAllowed =
    targetHorizonMs !== null &&
    targetHorizonMs > 0 &&
    policy.allowedHorizonsMs.includes(targetHorizonMs);

  if (
    side === null ||
    !horizonAllowed ||
    !durableTimingValid ||
    queueCoverage === null ||
    spreadBps === null ||
    fillRatio === null ||
    !Number.isFinite(observedAtMs)
  ) return null;

  const queueBucket = bucketFor(queueCoverage, policy.queueCoverageBuckets);
  const spreadBucket = bucketFor(spreadBps, policy.spreadBucketsBps);
  if (!queueBucket || !spreadBucket) return null;

  return {
    side,
    targetHorizonMs,
    flowHorizonMs: flowHorizonMs ?? targetHorizonMs,
    markoutHorizonDriftRatio,
    queueCoverage,
    spreadBps,
    fillRatio,
    filled: fillRatio > 0,
    adverseSelectionBps,
    spreadCaptureBps,
    observedAt: new Date(observedAtMs).toISOString(),
    observedAtMs,
    queueBucket,
    spreadBucket,
  };
}

export function calibrateMakerFillProbability(observations = [], policyOverrides = {}) {
  const policy = { ...DEFAULT_FILL_CALIBRATION_POLICY, ...policyOverrides };
  validateSequentialPolicy(policy);

  const normalized = observations
    .map(row => normalizeFillObservation(row, policy))
    .filter(Boolean)
    .sort((a, b) => a.observedAtMs - b.observedAtMs);

  const cohorts = new Map();
  for (const row of normalized) {
    const key = [row.targetHorizonMs, row.side, row.queueBucket, row.spreadBucket].join('|');
    if (!cohorts.has(key)) cohorts.set(key, []);
    cohorts.get(key).push(row);
  }

  const calibrationN = policy.calibrationSamplesPerCohort;
  const validationN = policy.validationSamplesPerCohort;
  const holdoutN = policy.holdoutSamplesPerCohort;
  const validationEnd = calibrationN + validationN;
  const protocolEnd = validationEnd + holdoutN;

  const results = [...cohorts.entries()].map(([key, rows]) => {
    const [targetHorizonMsRaw, side, queueBucket, spreadBucket] = key.split('|');
    const targetHorizonMs = Number(targetHorizonMsRaw);
    const sampleSize = rows.length;

    const calibrationRows = rows.slice(0, calibrationN);
    const validationRows = rows.slice(calibrationN, validationEnd);
    const holdoutRows = rows.slice(validationEnd, protocolEnd);

    const calibration = summarizeRows(calibrationRows, policy.wilsonZ);
    const validationComplete = validationRows.length === validationN;
    const validationMetrics = validationComplete
      ? summarizeRows(validationRows, policy.wilsonZ)
      : null;

    const calibrationComplete = calibrationRows.length === calibrationN;
    const holdoutComplete = holdoutRows.length === holdoutN;

    let status = 'ACCUMULATING_CALIBRATION';
    if (calibrationComplete && !validationComplete) status = 'CALIBRATION_COMPLETE_AWAITING_VALIDATION';
    if (validationComplete && !holdoutComplete) status = 'VALIDATED_RESEARCH_HOLDOUT_ACCUMULATING';
    if (validationComplete && holdoutComplete) status = 'HOLDOUT_READY_ONE_TIME_AUDIT';

    const usableFillProbability = validationComplete
      ? Math.min(
          calibration.conservativeFillProbability ?? 0,
          validationMetrics?.conservativeFillProbability ?? 0,
        )
      : null;

    return {
      targetHorizonMs,
      side,
      queueBucket,
      spreadBucket,
      sampleSize,
      protocolObservationCount: Math.min(sampleSize, protocolEnd),
      postProtocolObservationCount: Math.max(0, sampleSize - protocolEnd),
      status,
      calibration: {
        required: calibrationN,
        count: calibrationRows.length,
        complete: calibrationComplete,
        metrics: calibration,
      },
      validation: {
        required: validationN,
        count: validationRows.length,
        complete: validationComplete,
        status: validationComplete ? 'REVEALED_COMPLETE' : 'SEALED_ACCUMULATING',
        metrics: validationMetrics,
      },
      holdout: {
        required: holdoutN,
        count: holdoutRows.length,
        complete: holdoutComplete,
        status: holdoutComplete ? 'READY_FOR_EXPLICIT_ONE_TIME_AUDIT' : 'SEALED_ACCUMULATING',
        metrics: null,
      },
      usableFillProbability,
      eligibleForShadowCalibration:
        validationComplete &&
        Number.isFinite(usableFillProbability),
    };
  }).sort((a, b) =>
    a.targetHorizonMs - b.targetHorizonMs ||
    a.side.localeCompare(b.side) ||
    a.queueBucket.localeCompare(b.queueBucket) ||
    a.spreadBucket.localeCompare(b.spreadBucket));

  const jsonStableBuckets = buckets => buckets.map(bucket => ({
    id: bucket.id,
    min: bucket.min,
    max: Number.isFinite(bucket.max) ? bucket.max : null,
  }));

  const policyForReport = {
    protocolVersion: policy.protocolVersion,
    calibrationSamplesPerCohort: calibrationN,
    validationSamplesPerCohort: validationN,
    holdoutSamplesPerCohort: holdoutN,
    wilsonZ: policy.wilsonZ,
    allowedHorizonsMs: policy.allowedHorizonsMs,
    maxMarkoutHorizonDriftRatio: policy.maxMarkoutHorizonDriftRatio,
    queueCoverageBuckets: jsonStableBuckets(policy.queueCoverageBuckets),
    spreadBucketsBps: jsonStableBuckets(policy.spreadBucketsBps),
    holdoutPolicy: policy.holdoutPolicy,
    requiredObservationVersion: REQUIRED_MAKER_OBSERVATION_VERSION,
  };

  return {
    mode: MAKER_FILL_CALIBRATION_MODE,
    version: MAKER_FILL_CALIBRATION_VERSION,
    executionAuthority: false,
    liveLocked: true,
    policy: policyForReport,
    protocolSha256: makerFillPolicyHash(policyForReport),
    rawObservationCount: observations.length,
    validObservationCount: normalized.length,
    rejectedObservationCount: observations.length - normalized.length,
    cohorts: results,
    calibratedCohortCount: results.filter(row => row.calibration.complete).length,
    validatedCohortCount: results.filter(row => row.validation.complete).length,
    holdoutReadyCohortCount: results.filter(row => row.holdout.complete).length,
    notes: [
      'The first 100 chronological observations per cohort are calibration data.',
      'The next 50 observations are sealed while accumulating and revealed only when validation is complete.',
      'Usable fill probability is unavailable until validation completes and then uses the minimum Wilson lower bound across calibration and validation.',
      'The following 50 observations form a sealed holdout; routine reports expose only holdout count/status, never holdout outcomes or metrics.',
      'Holdout metrics require a separate explicit one-time audit and are never used for ranking or tuning.',
      'Rows after the first 200 observations per cohort do not alter the locked v1 calibration/validation/holdout allocation.',
      'This research module has no execution authority.',
    ],
  };
}

export function lookupConservativeFillProbability(report, {
  side,
  targetHorizonMs,
  queueCoverage,
  spreadBps,
} = {}) {
  if (!report || report.version !== MAKER_FILL_CALIBRATION_VERSION) return null;

  const normalized = normalizeFillObservation({
    side,
    targetHorizonMs,
    queueCoverage,
    spreadBps,
    fillRatio: 0,
    observedAt: '2000-01-01T00:00:00.000Z',
  });
  if (!normalized) return null;

  const cohort = report.cohorts?.find(row =>
    row.targetHorizonMs === normalized.targetHorizonMs &&
    row.side === normalized.side &&
    row.queueBucket === normalized.queueBucket &&
    row.spreadBucket === normalized.spreadBucket);

  return cohort?.eligibleForShadowCalibration === true
    ? cohort.usableFillProbability
    : null;
}
