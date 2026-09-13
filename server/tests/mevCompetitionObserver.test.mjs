import test from 'node:test';
import assert from 'node:assert/strict';

import { isPreCaptureReady } from '../genesis/mevCaptureReadiness.mjs';
import { createCompetitionObserver } from '../genesis/mevCompetitionObserver.mjs';

function readyRow(overrides = {}) {
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
    blockers: ['inclusionProbabilityKnown', 'inclusionProbability', 'expectedNetPositive'],
    verdict: 'NO_GO',
    ...overrides,
  };
}

test('unknown inclusion is treated as the remaining capture boundary', () => {
  assert.equal(isPreCaptureReady(readyRow()), true);
  assert.equal(isPreCaptureReady(readyRow({ blockers: ['stressPositive'] })), false);
});

test('observer measures next-observation survival and edge decay without fabricating inclusion', () => {
  const observer = createCompetitionObserver();

  const first = observer.observe({ candidates: [], rejected: [readyRow()] }, {
    blockNumber: '100',
    capturedAt: '2026-09-13T00:00:00.000Z',
  });
  assert.equal(first.transitionsObserved, 0);
  assert.equal(first.activePreCaptureRoutes, 1);

  const second = observer.observe({ candidates: [], rejected: [readyRow({
    blockNumber: '101',
    capturedAt: '2026-09-13T00:00:12.000Z',
    netEdgeBps: 9,
  })] }, {
    blockNumber: '101',
    capturedAt: '2026-09-13T00:00:12.000Z',
  });

  assert.equal(second.transitionsObserved, 1);
  assert.equal(second.nextObservationSurvivalRate, 1);
  assert.equal(second.medianSurvivingEdgeDecayBps, 3);
  assert.equal(second.inclusionProbabilityMeasured, false);
  assert.equal(second.captureProbabilityMeasured, false);
  assert.match(second.note, /not inclusion probability/i);
});

test('observer records route disappearance as failed survival', () => {
  const observer = createCompetitionObserver();
  observer.observe({ candidates: [], rejected: [readyRow()] }, { blockNumber: '100' });
  const second = observer.observe({ candidates: [], rejected: [] }, { blockNumber: '101' });
  assert.equal(second.transitionsObserved, 1);
  assert.equal(second.nextObservationSurvivalRate, 0);
  assert.equal(second.activePreCaptureRoutes, 0);
});
