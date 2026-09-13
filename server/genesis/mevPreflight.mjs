// mevPreflight.mjs
// One-command, read-only readiness check for Arbitrage Radar.
//
// It never signs, sends, deploys, or requests a private key. The purpose is to
// tell the operator exactly which evidence/configuration boundary is still open.

import { getAtomicSimulatorConfig } from './mevAtomicSimulator.mjs';
import { summarizeCaptureReadiness } from './mevCaptureReadiness.mjs';
import { getMevRadarConfig, scanMevOnchainRadarOnce } from './mevOnchainRadar.mjs';

export const PREFLIGHT_VERSION = 'arbitrage_preflight_v1';

export async function runArbitragePreflight({
  env = process.env,
  scanner = scanMevOnchainRadarOnce,
} = {}) {
  const radarConfig = getMevRadarConfig(env);
  const atomicConfig = getAtomicSimulatorConfig(env);

  const base = {
    version: PREFLIGHT_VERSION,
    mode: 'SHADOW',
    executionAuthority: false,
    liveExecutionReady: false,
    providerConfigured: radarConfig.providerConfigured,
    executorConfigured: atomicConfig.executorConfigured,
    notionalUsd: radarConfig.notionalUsd,
  };

  if (!radarConfig.providerConfigured) {
    return {
      ...base,
      ok: false,
      state: 'CONFIGURATION_REQUIRED',
      missing: ['GENESIS_MEV_RPC_URL'],
      note: 'Configure a read-only Ethereum RPC before starting continuous observation.',
    };
  }

  try {
    const scan = await scanner({
      config: radarConfig,
      atomicSimulatorConfig: atomicConfig,
      persist: false,
    });
    const capture = summarizeCaptureReadiness(scan.evaluation);
    const missing = [];
    if (!atomicConfig.executorConfigured) missing.push('GENESIS_MEV_EXECUTOR_ADDRESS');
    if ((scan.liquidityProbesPassed ?? 0) === 0) missing.push('liquidity_proof');
    if (atomicConfig.executorConfigured && (scan.atomicSimulationsPassed ?? 0) === 0) missing.push('atomic_simulation_proof');
    if (capture.preCaptureReady === 0) missing.push('pre_capture_positive_route');
    missing.push('measured_inclusion_competition_evidence');

    let state = 'OBSERVATION_READY';
    if (!atomicConfig.executorConfigured) state = 'ATOMIC_EXECUTOR_REQUIRED';
    else if ((scan.atomicSimulationsPassed ?? 0) === 0) state = 'ATOMIC_PROOF_REQUIRED';
    else if (capture.preCaptureReady === 0) state = 'EVIDENCE_ACCUMULATION';
    else state = 'CAPTURE_EVIDENCE_REQUIRED';

    return {
      ...base,
      ok: true,
      state,
      blockNumber: scan.blockNumber ?? null,
      routesScanned: scan.routesScanned ?? 0,
      routesQuoted: scan.routesQuoted ?? 0,
      liquidityProbesPassed: scan.liquidityProbesPassed ?? 0,
      atomicSimulationsPassed: scan.atomicSimulationsPassed ?? 0,
      preCaptureReady: capture.preCaptureReady,
      missing: [...new Set(missing)],
      capture,
      note: 'SHADOW system readiness only. Real-money execution remains structurally disabled.',
    };
  } catch (error) {
    return {
      ...base,
      ok: false,
      state: 'PREFLIGHT_FAILED',
      missing: ['healthy_read_only_scan'],
      error: error instanceof Error ? error.message.slice(0, 400) : String(error).slice(0, 400),
      note: 'No execution was attempted.',
    };
  }
}

if (process.argv[1]?.endsWith('mevPreflight.mjs')) {
  const result = await runArbitragePreflight();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 2;
}
