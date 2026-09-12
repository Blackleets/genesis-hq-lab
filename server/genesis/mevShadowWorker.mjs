// mevShadowWorker.mjs
// Optional long-running SHADOW observer. It never signs or submits transactions.
// The worker is NOT auto-started by importing this module; operators launch it
// explicitly with `npm run mev:shadow:watch` or wire it into a deployment later.

import { getMevRadarConfig, scanMevOnchainRadarOnce } from './mevOnchainRadar.mjs';
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
        candidates: result.evaluation?.candidates?.length ?? 0,
        filtered: result.evaluation?.rejected?.length ?? 0,
        lastCapturedAt: result.capturedAt ?? null,
        error: result.error ?? null,
      });
      publishCycle(result);

      if (typeof onCycle === 'function') await onCycle(result);
      if (once) return result;
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
        candidates: 0,
        filtered: 0,
        error: message,
      });
      writeMevRadarPublicSnapshot({
        status,
        providerConfigured: Boolean(config.providerConfigured),
        routesScanned: 0,
        routesQuoted: 0,
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

  console.log(`[mev-shadow] mode=SHADOW executionAuthority=false interval=${config.intervalMs}ms`);
  if (!config.providerConfigured) {
    console.log('[mev-shadow] Provider not configured');
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
        qualified: result.evaluation?.candidates?.length ?? 0,
        filtered: result.evaluation?.rejected?.length ?? 0,
      }));
    },
  });
}
