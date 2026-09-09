import test from 'node:test';
import assert from 'node:assert/strict';
import { auditPositioningRows } from '../research/positioningDataQualityAudit.mjs';

function row({ capturedAt, closeTime, schemaVersion = 4, windowMs = 60_000 } = {}) {
  return {
    schemaVersion,
    mode: 'RESEARCH_ONLY',
    provider: 'okx_public_market_data',
    symbol: 'BTCUSDT',
    capturedAt,
    price: { closeTime },
    positioning: { takerWindowMs: windowMs },
    provenance: { takerWindowMs: windowMs },
  };
}

test('passes a clean same-schema non-overlapping cohort', () => {
  const rows = [
    row({ capturedAt: '2026-09-09T18:00:00.000Z', closeTime: '2026-09-09T17:59:59.999Z' }),
    row({ capturedAt: '2026-09-09T18:05:00.000Z', closeTime: '2026-09-09T18:04:59.999Z' }),
    row({ capturedAt: '2026-09-09T18:10:00.000Z', closeTime: '2026-09-09T18:09:59.999Z' }),
  ];
  const out = auditPositioningRows(rows);
  assert.equal(out.eligibleRowCount, 3);
  assert.equal(out.independentRowCount, 3);
  assert.equal(out.effectiveIndependentRatio, 1);
  assert.equal(out.defects.overlappingWindows, 0);
  assert.equal(out.defects.duplicateCloseTimes, 0);
  assert.equal(out.qualityPass, true);
  assert.equal(out.boundaries.holdoutUsedForRanking, false);
});

test('detects overlapping taker windows and reduces effective independent sample', () => {
  const rows = [
    row({ capturedAt: '2026-09-09T18:00:00.000Z', closeTime: '2026-09-09T17:59:59.999Z' }),
    row({ capturedAt: '2026-09-09T18:00:30.000Z', closeTime: '2026-09-09T18:00:29.999Z' }),
    row({ capturedAt: '2026-09-09T18:02:00.000Z', closeTime: '2026-09-09T18:01:59.999Z' }),
  ];
  const out = auditPositioningRows(rows);
  assert.equal(out.eligibleRowCount, 3);
  assert.equal(out.independentRowCount, 2);
  assert.equal(out.defects.overlappingWindows, 1);
  assert.ok(out.effectiveIndependentRatio < 0.95);
  assert.equal(out.qualityPass, false);
});

test('keeps old schemas visible but excludes them from the v4 quality cohort', () => {
  const rows = [
    row({ capturedAt: '2026-09-09T17:55:00.000Z', closeTime: '2026-09-09T17:54:59.999Z', schemaVersion: 3 }),
    row({ capturedAt: '2026-09-09T18:00:00.000Z', closeTime: '2026-09-09T17:59:59.999Z' }),
  ];
  const out = auditPositioningRows(rows);
  assert.equal(out.rawRowCount, 2);
  assert.equal(out.eligibleRowCount, 1);
  assert.equal(out.schemaCounts['3'], 1);
  assert.equal(out.schemaCounts['4'], 1);
});

test('flags duplicate closed bars', () => {
  const rows = [
    row({ capturedAt: '2026-09-09T18:00:00.000Z', closeTime: '2026-09-09T17:59:59.999Z' }),
    row({ capturedAt: '2026-09-09T18:05:00.000Z', closeTime: '2026-09-09T17:59:59.999Z' }),
  ];
  const out = auditPositioningRows(rows);
  assert.equal(out.defects.duplicateCloseTimes, 1);
  assert.equal(out.qualityPass, false);
});
