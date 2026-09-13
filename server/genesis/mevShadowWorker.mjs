// mevShadowWorker.mjs
// Optional long-running SHADOW observer. It never signs or submits transactions.
// The worker is NOT auto-started by importing this module; operators launch it
// explicitly with `npm run mev:radar:watch` or use the opt-in Render start command.

import { getMevRadarConfig, scanMevOnchainRadarOnce } from './mevOnchainRadar.mjs';
import {
  createCaptureWindowTracker,
  summarizeCaptureReadiness,
} from './mevCaptureReadiness.mjs';
import {
  writeMevRadarHeartbeat,
  writeMevRadarPublicSnapshot,
} from './mevRadarState.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function publicRouteRows(evaluation) {
  if (!evaluation) return [];
  return [...(evaluation.candidates ?? []), ...(evaluation.rejected ?? [])]
    .sort((a, b) => (b.expectedNetPnlUsd ?? -Infinity) - (a.expectedNetPnlUsd ?? -Infinity))
    .slice(0, 8)
    .map((row) => ({
      route: row.routeId ?? `${row.buyDex ?? '?'} -> ${row.sellDex ?? '?'}`,
      expectedNetPnlUsd: row.expectedNetPnlUsd,
      stressNetPnlUsd: row.stressNetPnlUsd,
      netEdgeBps: row.netEdgeBps,
      status: row.verdict === 'SHADOW_CANDIDATE' ? 'qualified' : 'filtered',
      blockers: row.blockers ?? [],
      simulated: row.atomic === true && row.simulationSuccess === true,
      liquidityConfidence: Number.isFinite(row.liquidityConfidence) ? row.liquidityConfidence : null,
      capturedAt: row.capturedAt ?? null,
    }));
}

function publishCycle(result) {
  const summary = result.evaluation?.summary ?? null;
  return writeMevRadarPublicSnapshot({
    status: result.status,
    providerConfigured: result.providerConfigured === true,
    chainId: result.chainId ?? null,
    blockNumber: result.blockNumber ?? null,
    routesScanned: result.routesScanned ?? 0,
    routesQuoted: result.routesQuoted ?? 0,
    liquidityProbesAttempted: result.liquidityProbesAttempted ?? 0,
    liquidityProbesPassed: result.liquidityProbesPassed ?? 0,
    atomicSimulatorConfigured: result.atomicSimulatorConfigured === true,
    atomicSimulationsAttempted: result.atomicSimulationsAttempted ?? 0,
    atomicSimulationsPassed: result.atomicSimulationsPassed ?? 0,
    preCaptureReady: result.captureReadiness?.preCaptureReady ?? 0,
    captureState: result.captureReadiness?.state ?? 'BUILDING_EVIDENCE',
    captureWindowActive: result.captureWindow?.activeWindows ?? 0,
    captureWindowLongestObservations: result.captureWindow?.longestActiveObservations ?? 0,
    evaluated: summary?.evaluated ?? 0,
    qualified: result.evaluation?.candidates?.length ?? 0,
    filtered: result.evaluation?.rejected?.length ?? 0,
    theoreticalExpectedNetPnlUsd: summary?.theoreticalExpectedNetPnlUsd ?? null,
    theoreticalStressNetPnlUsd: summary?.theoreticalStressNetPnlUsd ?? null,
    medianNetEdgeBps: summary?.medianCandidateNetEdgeBps ?? null,
    topRoutes: publicRouteRows(result.evaluation),
    error: result.error ?? null,
  });
}

export async function runMevShadowWorker({
  once = false,
  persist = true,
  config = getMevRadarConfig(),
  onCycle = null,
  captureWindowTracker = createCaptureWindowTracker(),
} = {}) {
  let cycles = 0;
  let observationsRecorded = 0;

  do {
    const startedAt = new Date().toISOString();
    try {
      const result = await scanMevOnchainRadarOnce({ config, persist });
      cycles += 1;
      const quoted = result.routesQuoted ?? 0;
      observationsRecorded += quoted;
      const captureReadiness = summarizeCaptureReadiness(result.evaluation);
      const captureWindow = captureWindowTracker.update(result.evaluation, {
        blockNumber: result.blockNumber ?? null,
        capturedAt: result.capturedAt ?? startedAt,
      });
      const enrichedResult = { ...result, captureReadiness, captureWindow };

      writeMevRadarHeartbeat({
        status: result.status,
        providerConfigured: result.providerConfigured === true,
        mode: 'SHADOW',
        executionAuthority: false,
        startedAt,
        cycles,
        blockNumber: result.blockNumber ?? null,
        routesScanned: result.routesScanned ?? 0,
        routesQuoted: quoted,
        observationsRecorded,
        liquidityProbesAttempted: result.liquidityProbesAttempted ?? 0,
        liquidityProbesPassed: result.liquidityProbesPassed ?? 0,
        atomicSimulatorConfigured: result.atomicSimulatorConfigured === true,
        atomicSimulationsAttempted: result.atomicSimulationsAttempted ?? 0,
        atomicSimulationsPassed: result.atomicSimulationsPassed ?? 0,
        preCaptureReady: captureReadiness.preCaptureReady,
        captureState: captureReadiness.state,
        captureWindowActive: captureWindow.activeWindows,
        captureWindowLongestObservations: captureWindow.longestActiveObservations,
        candidates: result.evaluation?.candidates?.length ?? 0,
        filtered: result.evaluation?.rejected?.length ?? 0,
        lastCapturedAt: result.capturedAt ?? null,
        error: result.error ?? null,
      });
      publishCycle(enrichedResult);

      if (typeof onCycle === 'function') await onCycle(enrichedResult);
      if (once) return enrichedResult;
    } catch (error) {
      cycles += 1;
      const message = error instanceof Error ? error.message : String(error);
      const status = message === 'provider_not_configured' ? 'provider_not_configured' : 'degraded';
      writeMevRadarHeartbeat({
        status,
        providerConfigured: Boolean(config.providerConfigured),
        mode: 'SHADOW',
        executionAuthority: false,
        startedAt,
        cycles,
        blockNumber: null,
        routesScanned: 0,
        observationsRecorded,
        liquidityProbesAttempted: 0,
        liquidityProbesPassed: 0,
        atomicSimulatorConfigured: false,
        atomicSimulationsAttempted: 0,
        atomicSimulationsPassed: 0,
        preCaptureReady: 0,
        captureState: 'BUILDING_EVIDENCE',
        captureWindowActive: captureWindowTracker.snapshot().activeWindows,
        candidates: 0,
        filtered: 0,
        error: message,
      });
      writeMevRadarPublicSnapshot({
        status,
        providerConfigured: Boolean(config.providerConfigured),
        routesScanned: 0,
        routesQuoted: 0,
        liquidityProbesAttempted: 0,
        liquidityProbesPassed: 0,
        atomicSimulatorConfigured: false,
        atomicSimulationsAttempted: 0,
        atomicSimulationsPassed: 0,
        preCaptureReady: 0,
        captureState: 'BUILDING_EVIDENCE',
        captureWindowActive: captureWindowTracker.snapshot().activeWindows,
        evaluated: 0,
        qualified: 0,
        filtered: 0,
        topRoutes: [],
        error: message,
      });
      if (once) throw error;
    }

    await sleep(config.intervalMs);
  } while (true);
}

if (process.argv[1]?.endsWith('mevShadowWorker.mjs')) {
  const once = process.argv.includes('--once');
  const config = getMevRadarConfig();

  console.log(`[arbitrage-radar] mode=SHADOW executionAuthority=false interval=${config.intervalMs}ms`);
  if (!config.providerConfigured) {
    console.log('[arbitrage-radar] Provider not configured');
  }

  await runMevShadowWorker({
    once,
    persist: true,
    config,
    onCycle: async (result) => {
      console.log(JSON.stringify({
        at: new Date().toISOString(),
        block: result.blockNumber ?? null,
        quoted: result.routesQuoted ?? 0,
        liquidityProofs: result.liquidityProbesPassed ?? 0,
        simulated: result.atomicSimulationsPassed ?? 0,
        preCaptureReady: result.captureReadiness?.preCaptureReady ?? 0,
        activeCaptureWindows: result.captureWindow?.activeWindows ?? 0,
        qualified: result.evaluation?.candidates?.length ?? 0,
        filtered: result.evaluation?.rejected?.length ?? 0,
      }));
    },
  });
}
