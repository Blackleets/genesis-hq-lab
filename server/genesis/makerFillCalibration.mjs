// RESEARCH_ONLY empirical maker fill calibration.
// Converts durable queue-depletion observations into conservative cohort-level
// fill probabilities and fill-conditioned adverse-selection distributions.
// No model guesses, no order placement, no live authority.

export const MAKER_FILL_CALIBRATION_VERSION = 'maker_fill_calibration_v3_exact_flow_horizon';
export const REQUIRED_MAKER_OBSERVATION_VERSION = 'maker_queue_depletion_tape_v2_exact_flow_horizon';
export const MAKER_FILL_CALIBRATION_MODE = 'RESEARCH_ONLY';

export const DEFAULT_FILL_CALIBRATION_POLICY = Object.freeze({
  minSamplesPerCohort: 100,
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
  const valid =
    side !== null &&
    horizonAllowed &&
    durableTimingValid &&
    queueCoverage !== null &&
    spreadBps !== null &&
    fillRatio !== null &&
    Number.isFinite(observedAtMs);

  if (!valid) return null;

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
    const key = [row.targetHorizonMs, row.side, row.queueBucket, row.spreadBucket].join('|');
    if (!cohorts.has(key)) cohorts.set(key, []);
    cohorts.get(key).push(row);
  }

  const results = [...cohorts.entries()].map(([key, rows]) => {
    const [targetHorizonMsRaw, side, queueBucket, spreadBucket] = key.split('|');
    const targetHorizonMs = Number(targetHorizonMsRaw);
    const sampleSize = rows.length;
    const fills = rows.filter(row => row.filled).length;
    const empiricalFillProbability = sampleSize > 0 ? fills / sampleSize : null;
    const meanFillRatio = sampleSize > 0
      ? rows.reduce((sum, row) => sum + row.fillRatio, 0) / sampleSize
      : null;
    const conservativeFillProbability = wilsonLowerBound(fills, sampleSize, policy.wilsonZ);
    const adverseRows = rows
      .filter(row => row.filled && row.adverseSelectionBps !== null)
      .map(row => row.adverseSelectionBps);
    const spreadCaptureRows = rows
      .filter(row => row.filled && row.spreadCaptureBps !== null)
      .map(row => row.spreadCaptureBps);
    const sufficient = sampleSize >= policy.minSamplesPerCohort;

    return {
      targetHorizonMs,
      side,
      queueBucket,
      spreadBucket,
      sampleSize,
      fills,
      empiricalFillProbability,
      meanFillRatio,
      conservativeFillProbability,
      adverseSelectionSamples: adverseRows.length,
      adverseSelectionP50Bps: quantile(adverseRows, 0.50),
      adverseSelectionP75Bps: quantile(adverseRows, 0.75),
      adverseSelectionP90Bps: quantile(adverseRows, 0.90),
      meanSpreadCaptureBps: spreadCaptureRows.length
        ? spreadCaptureRows.reduce((sum, value) => sum + value, 0) / spreadCaptureRows.length
        : null,
      status: sufficient ? 'CALIBRATED' : 'INSUFFICIENT_DATA',
      usableFillProbability: sufficient ? conservativeFillProbability : null,
    };
  }).sort((a, b) =>
    a.targetHorizonMs - b.targetHorizonMs ||
    a.side.localeCompare(b.side) ||
    a.queueBucket.localeCompare(b.queueBucket) ||
    a.spreadBucket.localeCompare(b.spreadBucket));

  return {
    mode: MAKER_FILL_CALIBRATION_MODE,
    version: MAKER_FILL_CALIBRATION_VERSION,
    executionAuthority: false,
    liveLocked: true,
    policy: {
      minSamplesPerCohort: policy.minSamplesPerCohort,
      wilsonZ: policy.wilsonZ,
      allowedHorizonsMs: policy.allowedHorizonsMs,
      maxMarkoutHorizonDriftRatio: policy.maxMarkoutHorizonDriftRatio,
      requiredObservationVersion: REQUIRED_MAKER_OBSERVATION_VERSION,
    },
    rawObservationCount: observations.length,
    validObservationCount: normalized.length,
    rejectedObservationCount: observations.length - normalized.length,
    cohorts: results,
    calibratedCohortCount: results.filter(row => row.status === 'CALIBRATED').length,
    notes: [
      'Fill probability is conditioned on exact flow horizon, side, queue-coverage bucket and spread bucket.',
      'The usable probability is the Wilson lower confidence bound, not the optimistic sample mean.',
      'Adverse selection is measured only on filled observations and reported as p50/p75/p90.',
      'Durable maker_queue_depletion_tape_v1 rows are retained historically but rejected from v3 calibration because their flow window could extend beyond the target horizon.',
      'Cohorts below the minimum sample size fail closed as INSUFFICIENT_DATA.',
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
  return cohort?.status === 'CALIBRATED' ? cohort.usableFillProbability : null;
}
