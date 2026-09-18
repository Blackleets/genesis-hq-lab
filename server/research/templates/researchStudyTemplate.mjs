// RESEARCH_ONLY contributor template.
// Copy this file into a new study module and replace the example hypothesis.
// It has no network access and no execution authority.

import crypto from 'node:crypto';

export const RESEARCH_TEMPLATE_MODE = 'RESEARCH_ONLY';
export const RESEARCH_TEMPLATE_EXECUTION_AUTHORITY = false;

export const TEMPLATE_PROTOCOL = Object.freeze({
  studyVersion: 1,
  hypothesis: 'Replace with a falsifiable hypothesis.',
  minimumObservations: 30,
  roundTripCostBps: 10,
  holdoutPolicy: 'DO_NOT_TUNE_ON_HOLDOUT',
});

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function protocolSha256(protocol = TEMPLATE_PROTOCOL) {
  return crypto.createHash('sha256').update(canonical(protocol)).digest('hex');
}

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function evaluateTemplateStudy(observations = [], protocol = TEMPLATE_PROTOCOL) {
  const accepted = observations
    .map((row) => ({
      grossBps: finite(row?.grossBps),
      sourceTimestamp: finite(row?.sourceTimestamp),
      capturedAt: row?.capturedAt ?? null,
    }))
    .filter((row) => row.grossBps !== null && row.sourceTimestamp !== null && Number.isFinite(Date.parse(row.capturedAt)))
    .filter((row) => row.sourceTimestamp <= Date.parse(row.capturedAt));

  const minimum = Number(protocol.minimumObservations);
  const costBps = Number(protocol.roundTripCostBps);
  if (!(Number.isFinite(minimum) && minimum > 0 && Number.isFinite(costBps) && costBps >= 0)) {
    throw new Error('invalid_research_protocol');
  }

  const net = accepted.map((row) => row.grossBps - costBps);
  const meanNetBps = net.length ? net.reduce((sum, value) => sum + value, 0) / net.length : null;

  return {
    mode: RESEARCH_TEMPLATE_MODE,
    executionAuthority: RESEARCH_TEMPLATE_EXECUTION_AUTHORITY,
    studyVersion: protocol.studyVersion,
    protocolSha256: protocolSha256(protocol),
    observationCount: accepted.length,
    rejectedObservationCount: observations.length - accepted.length,
    meanNetBps,
    verdict:
      accepted.length < minimum
        ? 'INSUFFICIENT_DATA'
        : meanNetBps > 0
          ? 'SURVIVES_INITIAL_SCREEN'
          : 'REJECTED',
    holdoutPolicy: protocol.holdoutPolicy,
  };
}
