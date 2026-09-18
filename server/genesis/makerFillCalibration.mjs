// RESEARCH_ONLY empirical maker fill calibration.
// Converts durable queue-depletion observations into conservative cohort-level
// fill probabilities. No model guesses, no order placement, no live authority.

export const MAKER_FILL_CALIBRATION_VERSION = 'maker_fill_calibration_v1';
export const MAKER_FILL_CALIBRATION_MODE = 'RESEARCH_ONLY';

export const DEFAULT_FILL_CALIBRATION_POLICY = Object.freeze({
  minSamplesPerCohort: 30,
  wilsonZ: 1.96,
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
});

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

export function normalizeFillObservation(raw = {}, policy = DEFAULT_FILL_CALIBRATION_POLICY) {
  const side = normalizeSide(raw.side);
  const queueCoverage = nonNegative(raw.queueCoverage);
  const spreadBps = nonNegative(raw.spreadBps);
  const filled = probability(raw.fillRatio);
  const observedAtMs = Date.parse(raw.observedAt ?? raw.capturedAt ?? '');
  const valid =
    side !== null &&
    queueCoverage !== null &&
    spreadBps !== null &&
    filled !== null &&
    Number.isFinite(observedAtMs);

  if (!valid) return null;

  const queueBucket = bucketFor(queueCoverage, policy.queueCoverageBuckets);
  const spreadBucket = bucketFor(spreadBps, policy.spreadBucketsBps);
  if (!queueBucket || !spreadBucket) return null;

  return {
    side,
    queueCoverage,
    spreadBps,
    fillRatio: filled,
    filled: filled > 0,
    observedAt: new Date(observedAtMs).toISOString(),
    queueBucket,
    spreadBucket,
  };
}

export function calibrateMakerFillProbability(observations = [], policyOverrides = {}) {
  const policy = { ...DEFAULT_FILL_CALIBRATION_POLICY, ...policyOverrides };
  const normalized = observations
    .map(row => normalizeFillObservation(row, policy))
    .filter(Boolean);

  const cohorts = new Map();
  for (const row of normalized) {
    const key = [row.side, row.queueBucket, row.spreadBucket].join('|');
    if (!cohorts.has(key)) cohorts.set(key, []);
    cohorts.get(key).push(row);
  }

  const results = [...cohorts.entries()].map(([key, rows]) => {
    const [side, queueBucket, spreadBucket] = key.split('|');
    const sampleSize = rows.length;
    const fills = rows.filter(row => row.filled).length;
    const empiricalFillProbability = sampleSize > 0 ? fills / sampleSize : null;
    const meanFillRatio = sampleSize > 0
      ? rows.reduce((sum, row) => sum + row.fillRatio, 0) / sampleSize
      : null;
    const conservativeFillProbability = wilsonLowerBound(fills, sampleSize, policy.wilsonZ);
    const sufficient = sampleSize >= policy.minSamplesPerCohort;

    return {
      side,
      queueBucket,
      spreadBucket,
      sampleSize,
      fills,
      empiricalFillProbability,
      meanFillRatio,
      conservativeFillProbability,
      status: sufficient ? 'CALIBRATED' : 'INSUFFICIENT_DATA',
      usableFillProbability: sufficient ? conservativeFillProbability : null,
    };
  }).sort((a, b) =>
    a.side.localeCompare(b.side) ||
    a.queueBucket.localeCompare(b.queueBucket) ||
    a.spreadBucket.localeCompare(b.spreadBucket));

  return {
    mode: MAKER_FILL_CALIBRATION_MODE,
    version: MAKER_FILL_CALIBRATION_VERSION,
    policy: {
      minSamplesPerCohort: policy.minSamplesPerCohort,
      wilsonZ: policy.wilsonZ,
    },
    rawObservationCount: observations.length,
    validObservationCount: normalized.length,
    rejectedObservationCount: observations.length - normalized.length,
    cohorts: results,
    calibratedCohortCount: results.filter(row => row.status === 'CALIBRATED').length,
    notes: [
      'Fill probability is conditioned on observed side, queue-coverage bucket and spread bucket.',
      'The usable probability is the Wilson lower confidence bound, not the optimistic sample mean.',
      'Cohorts below the minimum sample size fail closed as INSUFFICIENT_DATA.',
      'This research module has no execution authority.',
    ],
  };
}

export function lookupConservativeFillProbability(report, { side, queueCoverage, spreadBps } = {}) {
  if (!report || report.version !== MAKER_FILL_CALIBRATION_VERSION) return null;
  const normalized = normalizeFillObservation({
    side,
    queueCoverage,
    spreadBps,
    fillRatio: 0,
    observedAt: '2000-01-01T00:00:00.000Z',
  });
  if (!normalized) return null;
  const cohort = report.cohorts?.find(row =>
    row.side === normalized.side &&
    row.queueBucket === normalized.queueBucket &&
    row.spreadBucket === normalized.spreadBucket);
  return cohort?.status === 'CALIBRATED' ? cohort.usableFillProbability : null;
}
