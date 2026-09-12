// RESEARCH_ONLY independence audit for causal microstructure outcomes.
// Companion to the locked H1 v2 study: does not change thresholds, outcomes, gates, or protocol hash.
// It measures how many observations remain after removing overlapping forward-return windows.

import fs from 'node:fs';

function ms(value) {
  const n = Date.parse(value ?? '');
  return Number.isFinite(n) ? n : null;
}

export function selectNonOverlapping(observations = []) {
  const ordered = [...observations]
    .filter(x => ms(x?.entryAt) !== null && ms(x?.exitAt) !== null)
    .sort((a, b) => ms(a.entryAt) - ms(b.entryAt) || ms(a.exitAt) - ms(b.exitAt));
  const selected = [];
  let lastExitMs = -Infinity;
  for (const observation of ordered) {
    const entryMs = ms(observation.entryAt);
    const exitMs = ms(observation.exitAt);
    if (entryMs < lastExitMs || exitMs <= entryMs) continue;
    selected.push(observation);
    lastExitMs = exitMs;
  }
  return selected;
}

export function auditCohort(observations = []) {
  const valid = observations.filter(x => ms(x?.entryAt) !== null && ms(x?.exitAt) !== null && ms(x.exitAt) > ms(x.entryAt));
  const independent = selectNonOverlapping(valid);
  const overlapCount = Math.max(0, valid.length - independent.length);
  return {
    rawObservationCount: valid.length,
    effectiveIndependentCount: independent.length,
    overlapCount,
    overlapRate: valid.length ? overlapCount / valid.length : 0,
    statisticallyIndependent: overlapCount === 0,
    independentWindows: independent.map(x => ({
      cohort: x.cohort ?? null,
      entryAt: x.entryAt,
      exitAt: x.exitAt,
      side: x.side ?? null,
      netBps: Number.isFinite(Number(x.netBps)) ? Number(x.netBps) : null,
    })),
  };
}

export function buildIndependenceAudit(study = {}) {
  const h1 = auditCohort(study?.observations ?? []);
  const control = auditCohort(study?.control?.observations ?? []);
  return {
    auditVersion: 1,
    mode: 'RESEARCH_ONLY',
    studyVersion: study?.studyVersion ?? null,
    protocolHash: study?.protocolHash ?? null,
    purpose: 'Detect overlapping forward-return windows so repeated exposure to the same market move is not mistaken for independent evidence.',
    h1,
    control,
    warning: (h1.overlapCount + control.overlapCount) > 0
      ? 'Overlapping outcomes detected. Use effectiveIndependentCount for statistical sufficiency checks before any promotion decision.'
      : null,
  };
}

if (process.argv[1]?.endsWith('observationIndependenceAudit.mjs')) {
  const input = process.argv[2];
  const outIndex = process.argv.indexOf('--out');
  const out = outIndex >= 0 ? process.argv[outIndex + 1] : null;
  if (!input) throw new Error('study report path required');
  const study = JSON.parse(fs.readFileSync(input, 'utf8'));
  const audit = buildIndependenceAudit(study);
  const text = `${JSON.stringify(audit, null, 2)}\n`;
  if (out) fs.writeFileSync(out, text);
  console.log(text);
}
