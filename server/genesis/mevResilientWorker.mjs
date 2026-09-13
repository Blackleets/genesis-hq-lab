// mevResilientWorker.mjs
// Always-on SHADOW wrapper for Arbitrage Radar with read-only RPC failover.
//
// Safety contract:
// - no wallet/private key/signing/broadcast
// - no execution authority
// - configured RPCs are preferred, but public read-only fallbacks keep SHADOW
//   observation alive when no secret-backed provider is available
// - provider URLs are never printed because configured URLs may contain keys

import { createCaptureWindowTracker } from './mevCaptureReadiness.mjs';
import { createCompetitionObserver } from './mevCompetitionObserver.mjs';
import { getMevRadarConfig } from './mevOnchainRadar.mjs';
import { runMevShadowWorker } from './mevShadowWorker.mjs';

export const DEFAULT_PUBLIC_RPC_ENDPOINTS = Object.freeze([
  { source: 'publicnode', url: 'https://ethereum-rpc.publicnode.com' },
  { source: 'ankr_public', url: 'https://rpc.ankr.com/eth' },
]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function splitUrls(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getRpcCandidates(env = process.env) {
  const configured = [
    ...splitUrls(env.GENESIS_MEV_RPC_URL),
    ...splitUrls(env.GENESIS_MEV_RPC_URLS),
  ];

  const candidates = configured.map((url, index) => ({
    source: `configured_${index + 1}`,
    url,
    configured: true,
  }));

  const publicFallbackEnabled = String(env.GENESIS_MEV_PUBLIC_RPC_FALLBACK ?? 'true').toLowerCase() !== 'false';
  if (publicFallbackEnabled) {
    for (const endpoint of DEFAULT_PUBLIC_RPC_ENDPOINTS) {
      candidates.push({ ...endpoint, configured: false });
    }
  }

  const seen = new Set();
  return candidates.filter((candidate) => {
    if (!candidate.url || seen.has(candidate.url)) return false;
    seen.add(candidate.url);
    return true;
  });
}

export async function probeEthereumRpc(candidate, {
  fetchImpl = globalThis.fetch,
  timeoutMs = 4_000,
} = {}) {
  if (!candidate?.url || typeof fetchImpl !== 'function') {
    return { ok: false, source: candidate?.source ?? 'unknown', reason: 'invalid_probe_input' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(candidate.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_chainId',
        params: [],
      }),
      signal: controller.signal,
    });
    if (!response?.ok) {
      return { ok: false, source: candidate.source, reason: `http_${response?.status ?? 'error'}` };
    }
    const payload = await response.json();
    if (payload?.result !== '0x1') {
      return { ok: false, source: candidate.source, reason: 'wrong_chain' };
    }
    return { ok: true, source: candidate.source };
  } catch (error) {
    const reason = error?.name === 'AbortError' ? 'timeout' : 'rpc_unreachable';
    return { ok: false, source: candidate.source, reason };
  } finally {
    clearTimeout(timer);
  }
}

export async function selectHealthyEthereumRpc({
  env = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = 4_000,
} = {}) {
  const attempts = [];
  for (const candidate of getRpcCandidates(env)) {
    const probe = await probeEthereumRpc(candidate, { fetchImpl, timeoutMs });
    attempts.push(probe);
    if (probe.ok) {
      return {
        ok: true,
        source: candidate.source,
        configured: candidate.configured === true,
        url: candidate.url,
        attempts,
      };
    }
  }
  return { ok: false, source: null, configured: false, url: null, attempts };
}

export async function runResilientMevShadowWorker({
  once = false,
  env = process.env,
  fetchImpl = globalThis.fetch,
  sleepFn = sleep,
  onCycle = null,
} = {}) {
  const captureWindowTracker = createCaptureWindowTracker();
  const competitionObserver = createCompetitionObserver();
  const baseConfig = getMevRadarConfig(env);
  const intervalMs = baseConfig.intervalMs;
  let cycles = 0;

  do {
    cycles += 1;
    const selected = await selectHealthyEthereumRpc({ env, fetchImpl });

    if (!selected.ok) {
      // Ask the existing worker to publish its fail-closed provider state.
      try {
        await runMevShadowWorker({
          once: true,
          persist: true,
          config: getMevRadarConfig({ ...env, GENESIS_MEV_RPC_URL: '' }),
          captureWindowTracker,
          competitionObserver,
        });
      } catch {
        // The one-shot worker intentionally throws after publishing the degraded state.
      }

      console.warn(`[arbitrage-radar] cycle=${cycles} provider=unavailable mode=SHADOW executionAuthority=false`);
      if (typeof onCycle === 'function') {
        await onCycle({ ok: false, status: 'provider_unavailable', providerSource: null, cycles });
      }
      if (once) return { ok: false, status: 'provider_unavailable', providerSource: null, cycles };
    } else {
      const config = getMevRadarConfig({ ...env, GENESIS_MEV_RPC_URL: selected.url });
      try {
        const result = await runMevShadowWorker({
          once: true,
          persist: true,
          config,
          captureWindowTracker,
          competitionObserver,
        });
        const safeResult = {
          ...result,
          providerSource: selected.source,
          providerConfiguredExternally: selected.configured,
          cycles,
        };
        console.log(JSON.stringify({
          at: new Date().toISOString(),
          mode: 'SHADOW',
          executionAuthority: false,
          provider: selected.source,
          block: result.blockNumber ?? null,
          quoted: result.routesQuoted ?? 0,
          qualified: result.evaluation?.candidates?.length ?? 0,
          filtered: result.evaluation?.rejected?.length ?? 0,
        }));
        if (typeof onCycle === 'function') await onCycle(safeResult);
        if (once) return safeResult;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[arbitrage-radar] cycle=${cycles} provider=${selected.source} status=degraded error=${message.slice(0, 160)}`);
        if (typeof onCycle === 'function') {
          await onCycle({ ok: false, status: 'degraded', providerSource: selected.source, cycles, error: message });
        }
        if (once) throw error;
      }
    }

    await sleepFn(intervalMs);
  } while (true);
}

if (process.argv[1]?.endsWith('mevResilientWorker.mjs')) {
  const once = process.argv.includes('--once');
  console.log('[arbitrage-radar] resilient-provider mode=SHADOW executionAuthority=false');
  await runResilientMevShadowWorker({ once });
}
