import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectNonOverlapping, auditCohort, buildIndependenceAudit } from '../research/observationIndependenceAudit.mjs';

const obs = (entryAt, exitAt, netBps = 1, cohort = 'H1') => ({ cohort, entryAt, exitAt, side: 'LONG', netBps });

test('selectNonOverlapping removes windows sharing the same market interval', () => {
  const rows = [
    obs('2026-09-09T10:00:00Z', '2026-09-09T10:15:00Z'),
    obs('2026-09-09T10:05:00Z', '2026-09-09T10:20:00Z'),
    obs('2026-09-09T10:15:00Z', '2026-09-09T10:30:00Z'),
  ];
  const selected = selectNonOverlapping(rows);
  assert.equal(selected.length, 2);
  assert.equal(selected[0].entryAt, '2026-09-09T10:00:00Z');
  assert.equal(selected[1].entryAt, '2026-09-09T10:15:00Z');
});

test('auditCohort reports raw and effective independent sample sizes', () => {
  const audit = auditCohort([
    obs('2026-09-09T10:00:00Z', '2026-09-09T10:15:00Z'),
    obs('2026-09-09T10:05:00Z', '2026-09-09T10:20:00Z'),
    obs('2026-09-09T10:20:00Z', '2026-09-09T10:35:00Z'),
  ]);
  assert.equal(audit.rawObservationCount, 3);
  assert.equal(audit.effectiveIndependentCount, 2);
  assert.equal(audit.overlapCount, 1);
  assert.ok(Math.abs(audit.overlapRate - (1 / 3)) < 1e-12);
  assert.equal(audit.statisticallyIndependent, false);
});

test('buildIndependenceAudit never mutates or reclassifies the locked study', () => {
  const study = {
    studyVersion: 2,
    protocolHash: 'locked-hash',
    observations: [obs('2026-09-09T10:00:00Z', '2026-09-09T10:15:00Z')],
    control: { observations: [obs('2026-09-09T10:00:00Z', '2026-09-09T10:15:00Z', -2, 'TAKER_ONLY_CONTROL')] },
    decision: 'INSUFFICIENT_DATA',
  };
  const audit = buildIndependenceAudit(study);
  assert.equal(audit.mode, 'RESEARCH_ONLY');
  assert.equal(audit.studyVersion, 2);
  assert.equal(audit.protocolHash, 'locked-hash');
  assert.equal(audit.h1.effectiveIndependentCount, 1);
  assert.equal(audit.control.effectiveIndependentCount, 1);
  assert.equal(study.decision, 'INSUFFICIENT_DATA');
});
