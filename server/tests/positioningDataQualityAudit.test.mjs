import test from 'node:test';
import assert from 'node:assert/strict';
import { auditPositioningRows } from '../research/positioningDataQualityAudit.mjs';

function row({ capturedAt, closeTime, schemaVersion = 4, windowMs = 60_000, symbol = 'BTCUSDT' } = {}) {
  return {
    schemaVersion,
    mode: 'RESEARCH_ONLY',
    provider: 'okx_public_market_data',
    symbol,
    capturedAt,
    price: { closeTime },
    positioning: { takerWindowMs: windowMs },
    provenance: { takerWindowMs: windowMs },
  };
}

test('separates clean tape integrity from minimum study readiness', () => {
  const rows = [
    row({ capturedAt: '2026-09-09T18:00:00.000Z', closeTime: '2026-09-09T17:59:59.999Z' }),
    row({ capturedAt: '2026-09-09T18:05:00.000Z', closeTime: '2026-09-09T18:04:59.999Z' }),
    row({ capturedAt: '2026-09-09T18:10:00.000Z', closeTime: '2026-09-09T18:09:59.999Z' }),
  ];
  const out = auditPositioningRows(rows);
  assert.equal(out.schemaVersion, 4);
  assert.equal(out.symbol, 'BTCUSDT');
  assert.equal(out.eligibleRowCount, 3);
  assert.equal(out.independentRowCount, 3);
  assert.equal(out.effectiveIndependentRatio, 1);
  assert.equal(out.defects.overlappingWindows, 0);
  assert.equal(out.defects.excessiveGaps, 0);
  assert.equal(out.maxGapMinutes, 60);
  assert.equal(out.qualityPass, true);
  assert.equal(out.readiness.minimumIndependentRows, 20);
  assert.equal(out.readiness.remainingIndependentRows, 17);
  assert.equal(out.readiness.readyForPredeclaredStudy, false);
  assert.equal(out.readiness.holdoutStillSealed, true);
  assert.equal(out.readiness.rankingAllowed, false);
  assert.equal(out.boundaries.holdoutUsedForRanking, false);
});

test('marks readiness only after a clean independent cohort reaches the fixed minimum', () => {
  const base = Date.parse('2026-09-09T18:00:00.000Z');
  const rows = Array.from({ length: 20 }, (_, i) => {
    const capturedAt = new Date(base + i * 5 * 60_000).toISOString();
    const closeTime = new Date(base + i * 5 * 60_000 - 1).toISOString();
    return row({ capturedAt, closeTime });
  });
  const out = auditPositioningRows(rows);
  assert.equal(out.qualityPass, true);
  assert.equal(out.independentRowCount, 20);
  assert.equal(out.readiness.remainingIndependentRows, 0);
  assert.equal(out.readiness.readyForPredeclaredStudy, true);
  assert.equal(out.readiness.rankingAllowed, false);
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
  assert.equal(out.readiness.readyForPredeclaredStudy, false);
});

test('an excessive gap starts a new clean cohort without bridging the outage', () => {
  const rows = [
    row({ capturedAt: '2026-09-09T18:00:00.000Z', closeTime: '2026-09-09T17:59:59.999Z' }),
    row({ capturedAt: '2026-09-09T18:05:00.000Z', closeTime: '2026-09-09T18:04:59.999Z' }),
    row({ capturedAt: '2026-09-09T19:06:00.000Z', closeTime: '2026-09-09T19:05:59.999Z' }),
    row({ capturedAt: '2026-09-09T19:11:00.000Z', closeTime: '2026-09-09T19:10:59.999Z' }),
  ];
  const out = auditPositioningRows(rows);
  assert.equal(out.historicalDefects.excessiveGaps, 1);
  assert.equal(out.cohortResetCount, 1);
  assert.equal(out.cohortPolicy, 'LATEST_CONTIGUOUS_SEGMENT_AFTER_EXCESSIVE_GAP');
  assert.equal(out.firstEligibleCapturedAt, '2026-09-09T19:06:00.000Z');
  assert.equal(out.eligibleRowCount, 2);
  assert.equal(out.independentRowCount, 2);
  assert.equal(out.defects.excessiveGaps, 0);
  assert.equal(out.qualityPass, true);
  assert.equal(out.readiness.readyForPredeclaredStudy, false);
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

test('flags duplicate closed bars inside the active cohort', () => {
  const rows = [
    row({ capturedAt: '2026-09-09T18:00:00.000Z', closeTime: '2026-09-09T17:59:59.999Z' }),
    row({ capturedAt: '2026-09-09T18:05:00.000Z', closeTime: '2026-09-09T17:59:59.999Z' }),
  ];
  const out = auditPositioningRows(rows);
  assert.equal(out.defects.duplicateCloseTimes, 1);
  assert.equal(out.qualityPass, false);
  assert.equal(out.readiness.readyForPredeclaredStudy, false);
});

test('isolates symbol cohorts so one asset can never count another asset observations', () => {
  const rows = [
    row({ capturedAt: '2026-09-09T18:00:00.000Z', closeTime: '2026-09-09T17:59:59.999Z', symbol: 'BTCUSDT' }),
    row({ capturedAt: '2026-09-09T18:05:00.000Z', closeTime: '2026-09-09T18:04:59.999Z', symbol: 'ETHUSDT' }),
    row({ capturedAt: '2026-09-09T18:10:00.000Z', closeTime: '2026-09-09T18:09:59.999Z', symbol: 'ETHUSDT' }),
  ];
  const eth = auditPositioningRows(rows, { symbol: 'ETHUSDT' });
  assert.equal(eth.symbol, 'ETHUSDT');
  assert.equal(eth.rawRowCount, 3);
  assert.equal(eth.eligibleRowCount, 2);
  assert.equal(eth.independentRowCount, 2);
});
