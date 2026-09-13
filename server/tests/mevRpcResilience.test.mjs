import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_PUBLIC_RPC_ENDPOINTS,
  createRpcCircuitBreaker,
  getRpcCandidates,
  probeEthereumRpc,
  selectHealthyEthereumRpc,
} from '../genesis/mevResilientWorker.mjs';

test('configured RPCs are preferred and public fallbacks remain available', () => {
  const candidates = getRpcCandidates({
    GENESIS_MEV_RPC_URL: 'https://configured.example/rpc',
    GENESIS_MEV_RPC_URLS: 'https://configured-2.example/rpc,https://configured.example/rpc',
  });

  assert.equal(candidates[0].source, 'configured_1');
  assert.equal(candidates[0].configured, true);
  assert.equal(candidates[1].source, 'configured_2');
  assert.equal(candidates.length, 2 + DEFAULT_PUBLIC_RPC_ENDPOINTS.length);
  assert.equal(new Set(candidates.map((item) => item.url)).size, candidates.length);
});

test('public fallbacks can be explicitly disabled', () => {
  const candidates = getRpcCandidates({
    GENESIS_MEV_PUBLIC_RPC_FALLBACK: 'false',
  });
  assert.deepEqual(candidates, []);
});

test('RPC probe accepts Ethereum mainnet without exposing the URL', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x1' }),
  });
  const candidate = { source: 'configured_1', url: 'https://secret.example/key-should-not-leak' };
  const result = await probeEthereumRpc(candidate, { fetchImpl });

  assert.deepEqual(result, { ok: true, source: 'configured_1' });
  assert.equal(JSON.stringify(result).includes('key-should-not-leak'), false);
});

test('RPC probe rejects a healthy endpoint on the wrong chain', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x89' }),
  });
  const result = await probeEthereumRpc({ source: 'wrong_chain', url: 'https://polygon.example' }, { fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'wrong_chain');
});

test('selector skips failed providers and chooses the first healthy Ethereum RPC', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    if (url.includes('bad.example')) {
      return { ok: false, status: 503, json: async () => ({}) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x1' }),
    };
  };

  const selected = await selectHealthyEthereumRpc({
    env: {
      GENESIS_MEV_RPC_URLS: 'https://bad.example,https://good.example',
      GENESIS_MEV_PUBLIC_RPC_FALLBACK: 'false',
    },
    fetchImpl,
  });

  assert.equal(selected.ok, true);
  assert.equal(selected.source, 'configured_2');
  assert.equal(selected.configured, true);
  assert.equal(selected.url, 'https://good.example');
  assert.deepEqual(seen, ['https://bad.example', 'https://good.example']);
  assert.equal(selected.attempts[0].reason, 'http_503');
  assert.equal(selected.attempts[1].ok, true);
});

test('configured providers remain preferred over rotating public fallbacks', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    return {
      ok: true,
      status: 200,
      json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x1' }),
    };
  };

  const selected = await selectHealthyEthereumRpc({
    env: { GENESIS_MEV_RPC_URL: 'https://configured.example' },
    fetchImpl,
    publicStartIndex: 1,
  });

  assert.equal(selected.source, 'configured_1');
  assert.deepEqual(seen, ['https://configured.example']);
});

test('public provider order rotates when no configured provider is available', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    return {
      ok: true,
      status: 200,
      json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x1' }),
    };
  };

  const selected = await selectHealthyEthereumRpc({
    env: {},
    fetchImpl,
    publicStartIndex: 1,
  });

  assert.equal(selected.source, 'ankr_public');
  assert.deepEqual(seen, ['https://rpc.ankr.com/eth']);
});

test('deep-scan circuit breaker quarantines a provider for deterministic cycles', () => {
  const breaker = createRpcCircuitBreaker({ cooldownCycles: 3 });
  breaker.recordFailure('publicnode', 10);

  assert.equal(breaker.isBlocked('publicnode', 10), true);
  assert.equal(breaker.isBlocked('publicnode', 11), true);
  assert.equal(breaker.isBlocked('publicnode', 12), true);
  assert.equal(breaker.isBlocked('publicnode', 13), false);
  assert.deepEqual(breaker.blockedSources(13), []);
});

test('selector excludes providers quarantined after deeper scan failures', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    return {
      ok: true,
      status: 200,
      json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x1' }),
    };
  };

  const selected = await selectHealthyEthereumRpc({
    env: {},
    fetchImpl,
    blockedSources: ['publicnode'],
  });

  assert.equal(selected.source, 'ankr_public');
  assert.deepEqual(seen, ['https://rpc.ankr.com/eth']);
});
