import { pathToFileURL } from 'node:url';

export const FREE_RPC_BENCHMARK_POLICY = Object.freeze({
  tier: 'FREE_ONLY',
  monthlyBudgetUsd: 0,
  executionAuthority: false,
  liveLocked: true,
});

const DEFAULT_FREE_ENDPOINTS = Object.freeze([
  { id: 'solana-public', url: 'https://api.mainnet-beta.solana.com' },
]);

function splitUrls(value) {
  return String(value ?? '').split(',').map((url) => url.trim()).filter(Boolean);
}

export function getFreeRpcBenchmarkConfig(env = process.env) {
  const configured = splitUrls(env.GENESIS_SOLANA_FREE_RPC_URLS)
    .map((url, index) => ({ id: `configured-free-${index + 1}`, url }));
  return {
    endpoints: [...configured, ...DEFAULT_FREE_ENDPOINTS],
    samples: Math.max(1, Math.min(20, Number(env.GENESIS_SOLANA_RPC_BENCHMARK_SAMPLES) || 5)),
    timeoutMs: Math.max(500, Math.min(10_000, Number(env.GENESIS_SOLANA_REQUEST_TIMEOUT_MS) || 5_000)),
    policy: FREE_RPC_BENCHMARK_POLICY,
  };
}

async function getSlot({ endpoint, fetchImpl, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const response = await fetchImpl(endpoint.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSlot', params: [{ commitment: 'processed' }] }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`http_${response.status}`);
    const body = await response.json();
    if (!Number.isFinite(Number(body?.result))) throw new Error('invalid_slot');
    return { ok: true, latencyMs: performance.now() - started, slot: Number(body.result) };
  } catch (error) {
    return { ok: false, latencyMs: performance.now() - started, error: String(error?.message ?? error).slice(0, 120) };
  } finally {
    clearTimeout(timer);
  }
}

function percentile(values, p) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
}

export async function benchmarkFreeSolanaRpcs({ config = getFreeRpcBenchmarkConfig(), fetchImpl = fetch } = {}) {
  const results = [];
  for (const endpoint of config.endpoints) {
    const samples = [];
    for (let index = 0; index < config.samples; index += 1) {
      samples.push(await getSlot({ endpoint, fetchImpl, timeoutMs: config.timeoutMs }));
    }
    const successful = samples.filter((sample) => sample.ok);
    const latencies = successful.map((sample) => sample.latencyMs);
    results.push({
      providerId: endpoint.id,
      attempts: samples.length,
      successes: successful.length,
      successRate: successful.length / samples.length,
      p50LatencyMs: percentile(latencies, 0.5),
      p95LatencyMs: percentile(latencies, 0.95),
      latestSlot: successful.at(-1)?.slot ?? null,
      errors: samples.filter((sample) => !sample.ok).map((sample) => sample.error),
    });
  }
  return {
    observedAt: new Date().toISOString(),
    policy: config.policy,
    results: results.sort((a, b) => (b.successRate - a.successRate) || ((a.p50LatencyMs ?? Infinity) - (b.p50LatencyMs ?? Infinity))),
  };
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) process.stdout.write(`${JSON.stringify(await benchmarkFreeSolanaRpcs(), null, 2)}\n`);
