import test from 'node:test';
import assert from 'node:assert/strict';
import { benchmarkFreeSolanaRpcs, getFreeRpcBenchmarkConfig } from '../genesis/solanaFreeRpcBenchmark.mjs';

test('free RPC benchmark discloses no endpoint URLs and never gains execution authority', async () => {
  const config = getFreeRpcBenchmarkConfig({
    GENESIS_SOLANA_FREE_RPC_URLS: 'https://free-one.example/key-secret,https://free-two.example',
    GENESIS_SOLANA_RPC_BENCHMARK_SAMPLES: '2',
  });
  let slot = 100;
  const report = await benchmarkFreeSolanaRpcs({
    config,
    fetchImpl: async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: slot += 1 }), { status: 200 }),
  });
  assert.equal(report.policy.monthlyBudgetUsd, 0);
  assert.equal(report.policy.executionAuthority, false);
  assert.equal(report.policy.liveLocked, true);
  assert.equal(report.results.length, 3);
  assert.equal(JSON.stringify(report).includes('key-secret'), false);
  assert.ok(report.results.every((row) => row.successRate === 1));
});
