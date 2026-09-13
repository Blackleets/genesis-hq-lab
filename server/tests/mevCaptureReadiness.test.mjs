import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCaptureWindowTracker,
  isPreCaptureReady,
  summarizeCaptureReadiness,
} from '../genesis/mevCaptureReadiness.mjs';

function row(overrides = {}) {
  return {
    executable: true,
    mode: 'SHADOW',
    executionAuthority: false,
    routeFingerprint: 'route-1',
    routeId: 'dex_a->dex_b:USDC-WETH-USDC',
    blockNumber: '100',
    capturedAt: '2026-09-13T00:00:00.000Z',
    atomic: true,
    simulationSuccess: true,
    netPnlUsd: 8,
    stressNetPnlUsd: 3,
    netEdgeBps: 12,
    liquidityConfidence: 0.9,
    blockers: ['inclusionProbability', 'expectedNetPositive'],
    verdict: 'NO_GO',
    ...overrides,
  };
}

test('route can be pre-capture ready without being promoted', () => {
  const candidate = row();
  assert.equal(isPreCaptureReady(candidate), true);
  assert.equal(candidate.verdict, 'NO_GO');
  const summary = summarizeCaptureReadiness({ candidates: [], rejected: [candidate] });
  assert.equal(summary.preCaptureReady, 1);
  assert.equal(summary.state, 'CAPTURE_EVIDENCE_REQUIRED');
  assert.equal(summary.inclusionProbabilityMeasured, false);
  assert.equal(summary.executionAuthority, false);
});

test('any non-capture blocker keeps route out of pre-capture readiness', () => {
  assert.equal(isPreCaptureReady(row({ blockers: ['inclusionProbability', 'stressPositive'] })), false);
  assert.equal(isPreCaptureReady(row({ atomic: false })), false);
  assert.equal(isPreCaptureReady(row({ liquidityConfidence: 0 })), false);
});

test('capture window tracker measures persistence without inventing probability', () => {
  const tracker = createCaptureWindowTracker();
  const first = tracker.update({ candidates: [], rejected: [row()] }, {
    blockNumber: '100',
    capturedAt: '2026-09-13T00:00:00.000Z',
  });
  assert.equal(first.activeWindows, 1);
  assert.equal(first.longestActiveObservations, 1);

  const second = tracker.update({ candidates: [], rejected: [row({ blockNumber: '101', capturedAt: '2026-09-13T00:00:12.000Z' })] }, {
    blockNumber: '101',
    capturedAt: '2026-09-13T00:00:12.000Z',
  });
  assert.equal(second.activeWindows, 1);
  assert.equal(second.longestActiveObservations, 2);

  const snap = tracker.snapshot();
  assert.equal(snap.activeWindows, 1);
  assert.equal(snap.closedWindows, 0);

  const closed = tracker.update({ candidates: [], rejected: [row({ blockers: ['stressPositive'] })] }, {
    blockNumber: '102',
    capturedAt: '2026-09-13T00:00:24.000Z',
  });
  assert.equal(closed.activeWindows, 0);
  assert.equal(closed.closedWindows, 1);
  assert.equal(closed.totalPreCaptureObservations, 2);
  assert.match(closed.note, /not inclusion probability/i);
});
