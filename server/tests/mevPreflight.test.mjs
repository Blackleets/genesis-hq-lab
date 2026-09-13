import test from 'node:test';
import assert from 'node:assert/strict';

import { runArbitragePreflight } from '../genesis/mevPreflight.mjs';

const EXECUTOR = '0x0000000000000000000000000000000000000001';

function readyRow() {
  return {
    executable: true,
    mode: 'SHADOW',
    executionAuthority: false,
    routeFingerprint: 'route-1',
    routeId: 'dex_a->dex_b:USDC-WETH-USDC',
    blockNumber: '123',
    atomic: true,
    simulationSuccess: true,
    netPnlUsd: 7,
    stressNetPnlUsd: 2,
    netEdgeBps: 10,
    liquidityConfidence: 0.91,
    blockers: ['inclusionProbability', 'expectedNetPositive'],
    verdict: 'NO_GO',
  };
}

test('preflight fails closed when RPC is absent', async () => {
  const result = await runArbitragePreflight({ env: {} });
  assert.equal(result.ok, false);
  assert.equal(result.state, 'CONFIGURATION_REQUIRED');
  assert.equal(result.executionAuthority, false);
  assert.equal(result.liveExecutionReady, false);
  assert.deepEqual(result.missing, ['GENESIS_MEV_RPC_URL']);
});

test('preflight identifies capture evidence as final shadow boundary', async () => {
  const scanner = async ({ persist }) => {
    assert.equal(persist, false);
    return {
      blockNumber: '123',
      routesScanned: 6,
      routesQuoted: 6,
      liquidityProbesPassed: 6,
      atomicSimulationsPassed: 4,
      evaluation: { candidates: [], rejected: [readyRow()] },
    };
  };

  const result = await runArbitragePreflight({
    env: {
      GENESIS_MEV_RPC_URL: 'http://example.invalid',
      GENESIS_MEV_EXECUTOR_ADDRESS: EXECUTOR,
      GENESIS_MEV_NOTIONAL_USD: '1000',
    },
    scanner,
  });

  assert.equal(result.ok, true);
  assert.equal(result.state, 'CAPTURE_EVIDENCE_REQUIRED');
  assert.equal(result.preCaptureReady, 1);
  assert.equal(result.liveExecutionReady, false);
  assert.equal(result.executionAuthority, false);
  assert.ok(result.missing.includes('measured_inclusion_competition_evidence'));
});

test('preflight never reports live readiness from a successful read-only scan', async () => {
  const result = await runArbitragePreflight({
    env: { GENESIS_MEV_RPC_URL: 'http://example.invalid' },
    scanner: async () => ({
      blockNumber: '123',
      routesScanned: 6,
      routesQuoted: 6,
      liquidityProbesPassed: 6,
      atomicSimulationsPassed: 0,
      evaluation: { candidates: [], rejected: [] },
    }),
  });
  assert.equal(result.liveExecutionReady, false);
  assert.equal(result.state, 'ATOMIC_EXECUTOR_REQUIRED');
});
