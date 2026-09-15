import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateUnsignedAtomicRoundTrip, SOLANA_ATOMIC_SIMULATION_POLICY } from '../genesis/solanaAtomicShadowSimulator.mjs';

function tokenAccountData(amount) {
  const bytes = Buffer.alloc(165);
  bytes.writeBigUInt64LE(BigInt(amount), 64);
  return [bytes.toString('base64'), 'base64'];
}

test('unsigned simulator verifies final USDC balance and never gains execution authority', async () => {
  let method = null;
  const result = await simulateUnsignedAtomicRoundTrip({
    transaction: {
      transaction: { serialize: () => Buffer.from('unsigned-v0') },
      usdcTokenAccount: '11111111111111111111111111111111',
      preUsdcRaw: 25_000_000n,
      minimumFinalUsdcRaw: 25_050_000n,
    },
    config: { solanaRpcUrl: 'https://rpc.example.test' },
    fetchImpl: async (_url, options) => {
      const request = JSON.parse(options.body);
      method = request.method;
      assert.equal(request.params[1].sigVerify, false);
      assert.equal(request.params[1].replaceRecentBlockhash, true);
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { value: { err: null, unitsConsumed: 500_000, accounts: [{ data: tokenAccountData(25_060_000) }], logs: [] } } }), { status: 200 });
    },
  });
  assert.equal(method, 'simulateTransaction');
  assert.equal(result.success, true);
  assert.equal(result.balancesVerified, true);
  assert.equal(result.minOutVerified, true);
  assert.equal(SOLANA_ATOMIC_SIMULATION_POLICY.signs, false);
  assert.equal(SOLANA_ATOMIC_SIMULATION_POLICY.broadcasts, false);
  assert.equal(SOLANA_ATOMIC_SIMULATION_POLICY.liveLocked, true);
});

test('successful RPC simulation still fails closed when final USDC misses minimum', async () => {
  const result = await simulateUnsignedAtomicRoundTrip({
    transaction: {
      transaction: { serialize: () => Buffer.from('unsigned-v0') },
      usdcTokenAccount: '11111111111111111111111111111111',
      preUsdcRaw: 25_000_000n,
      minimumFinalUsdcRaw: 25_050_000n,
    },
    config: { solanaRpcUrl: 'https://rpc.example.test' },
    fetchImpl: async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { value: { err: null, unitsConsumed: 500_000, accounts: [{ data: tokenAccountData(25_010_000) }], logs: [] } } }), { status: 200 }),
  });
  assert.equal(result.success, false);
  assert.equal(result.minOutVerified, false);
  assert.equal(result.error, 'minimum_final_usdc_not_met');
});
