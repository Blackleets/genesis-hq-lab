import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { buildFounderSnapshot, founderScope, MODES } from '../founderReadiness.mjs';
import { founderResponse, handleFounderRequest } from '../founderHttp.mjs';
import vercelHandler from '../../../api/genesis/founder.js';

const NOW = Date.parse('2026-09-05T12:00:00.000Z');
function fixture() {
  const env = {
    GENESIS_OWNER_ADDRESS: `0x${randomBytes(20).toString('hex')}`,
    GENESIS_EXECUTION_VENUE: 'binance', GENESIS_ACCOUNT_ID: 'unit-test-account',
    GENESIS_STRATEGY_ID: 'scalp-research', GENESIS_STRATEGY_VERSION: 'test-v1',
    GENESIS_REVISION: 'test-revision', GENESIS_MAX_DAILY_LOSS_USD: '20',
    GENESIS_MAX_ORDER_NOTIONAL_USD: '100', GENESIS_FOUNDER_PAUSED: 'false',
    BINANCE_API_KEY: randomBytes(20).toString('hex'), BINANCE_API_SECRET: randomBytes(32).toString('hex'),
    GENESIS_PREFLIGHT_HMAC_KEY: randomBytes(32).toString('hex'),
  };
  const proof = { version: 1, issuedAt: new Date(NOW).toISOString(), expiresAt: new Date(NOW + 60_000).toISOString(),
    gates: { ownerVerified: true, killSwitchArmed: true, killSwitchTested: true, founderPauseClear: true,
      strategyApproved: true, truthLedgerOnline: true, ledgerReconciled: true, auditLogOnline: true,
      brokerAuthenticated: true, executionSafetyVerified: true },
    connectors: Object.fromEntries(['binance', 'execution_broker'].map(id => [id, { status: 'online', mode: 'read_only', checkedAt: new Date(NOW).toISOString() }])),
  };
  return { env, proof };
}
function sign(env, proof) {
  env.GENESIS_PREFLIGHT_JSON = JSON.stringify({ ...proof, scope: founderScope(env) });
  env.GENESIS_PREFLIGHT_SIGNATURE = createHmac('sha256', env.GENESIS_PREFLIGHT_HMAC_KEY).update(env.GENESIS_PREFLIGHT_JSON).digest('hex');
  return env;
}
const blocked = env => assert.equal(buildFounderSnapshot(env, NOW).readiness, 'BLOCKED');

test('no real envs -> BLOCKED with complete contract and execution locked', () => {
  const s = buildFounderSnapshot({}, NOW);
  assert.equal(s.readiness, 'BLOCKED');
  for (const key of ['ok', 'owner', 'mode', 'readiness', 'connectors', 'agents', 'risk', 'cutover', 'blockers', 'updatedAt']) assert.ok(key in s);
  assert.deepEqual(s.connectors.map(c => c.id), ['owner_wallet', 'okx', 'binance', 'forex', 'prediction_markets', 'lp_farming', 'execution_broker']);
  assert.equal(s.agents.length, 7);
  assert.equal(s.agents.find(a => a.id === 'EXECUTION').mode, 'live_locked');
  assert.equal(s.agents.find(a => a.id === 'AUDITOR').metrics.source, 'Truth Ledger v2');
  assert.equal(s.agents.find(a => a.id === 'SENTINEL').status, 'blocking');
  assert.equal(s.cutover.canExecute, false);
  assert.ok(s.blockers.length >= 9);
});

test('all gates true -> READY_FOR_EXTERNAL_CUTOVER, never executable', () => {
  const { env, proof } = fixture();
  sign(env, proof);
  const before = JSON.stringify(env);
  const s = buildFounderSnapshot(env, NOW);
  assert.equal(s.readiness, 'READY_FOR_EXTERNAL_CUTOVER');
  assert.equal(s.mode, 'ready_for_external_cutover');
  assert.equal(s.cutover.canExecute, false);
  assert.equal(s.cutover.requiresExternalOwnerConfirmation, true);
  assert.deepEqual(s.blockers, []);
  assert.equal(s.connectors.find(c => c.id === 'execution_broker').status, 'locked');
  assert.equal(JSON.stringify(env), before);
  assert.deepEqual(s, buildFounderSnapshot(env, NOW));
});

for (const field of Object.keys(fixture().proof.gates)) {
  for (const value of [undefined, false, 'true']) {
    test(`missing/false/nonboolean ${field} (${String(value)}) blocks readiness`, () => {
      const { env, proof } = fixture(); proof.gates[field] = value;
      blocked(sign(env, proof));
    });
  }
}

for (const field of ['BINANCE_API_KEY', 'BINANCE_API_SECRET', 'GENESIS_ACCOUNT_ID', 'GENESIS_OWNER_ADDRESS', 'GENESIS_STRATEGY_VERSION', 'GENESIS_STRATEGY_ID', 'GENESIS_REVISION']) {
  test(`missing ${field} blocks even with signed gates true`, () => {
    const { env, proof } = fixture(); delete env[field]; blocked(sign(env, proof));
  });
}

test('limits reject zero, negative, infinity, NaN, whitespace, junk and booleans', () => {
  for (const name of ['GENESIS_MAX_DAILY_LOSS_USD', 'GENESIS_MAX_ORDER_NOTIONAL_USD']) {
    for (const value of ['', ' ', '0', '-1', 'Infinity', 'NaN', '20oops', true]) {
      const { env, proof } = fixture(); env[name] = value; blocked(sign(env, proof));
    }
  }
});
test('founder pause active/missing blocks and is never modified', () => {
  for (const value of [undefined, 'true', 'FALSE']) {
    const { env, proof } = fixture(); env.GENESIS_FOUNDER_PAUSED = value; blocked(sign(env, proof));
    assert.equal(env.GENESIS_FOUNDER_PAUSED, value);
  }
});
test('unknown/prototype venues fail closed without throwing', () => {
  for (const venue of ['__proto__', 'constructor', 'ibkr', '']) blocked({ GENESIS_EXECUTION_VENUE: venue });
});
test('stale/future/invalid/scope-mismatched or tampered preflight blocks', () => {
  const { env, proof } = fixture(); sign(env, proof);
  assert.equal(buildFounderSnapshot(env, NOW + 60_001).readiness, 'BLOCKED');
  assert.equal(buildFounderSnapshot(env, NOW - 1).readiness, 'BLOCKED');
  blocked({ ...env, GENESIS_REVISION: 'changed' });
  blocked({ ...env, BINANCE_API_SECRET: 'rotated' });
  blocked({ ...env, GENESIS_MAX_DAILY_LOSS_USD: '200' });
  blocked({ ...env, GENESIS_PREFLIGHT_JSON: env.GENESIS_PREFLIGHT_JSON + ' ' });
  blocked({ ...env, GENESIS_PREFLIGHT_SIGNATURE: 'bad' });
  blocked({ ...env, GENESIS_PREFLIGHT_HMAC_KEY: '' });
  blocked({ ...env, GENESIS_PREFLIGHT_JSON: 'null' });
});
test('each missing/degraded/stale selected broker check blocks despite other healthy connectors', () => {
  for (const id of ['execution_broker', 'binance']) {
    for (const check of [undefined, { status: 'offline', checkedAt: new Date(NOW).toISOString() }, { status: 'online', checkedAt: new Date(NOW - 60_001).toISOString() }]) {
      const { env, proof } = fixture(); proof.connectors[id] = check; blocked(sign(env, proof));
    }
  }
});
test('paper and testnet health are visible but cannot promote to external cutover', () => {
  assert.deepEqual(MODES, ['read_only', 'paper', 'testnet', 'live_locked', 'ready_for_external_cutover']);
  for (const mode of ['paper', 'testnet']) {
    const { env, proof } = fixture(); proof.connectors.binance.mode = mode; sign(env, proof);
    const s = buildFounderSnapshot(env, NOW);
    assert.equal(s.readiness, 'BLOCKED');
    assert.equal(s.connectors.find(c => c.id === 'binance').mode, mode);
  }
});
test('secrets, identities and untrusted proof strings do not appear anywhere in JSON', () => {
  const { env, proof } = fixture();
  const poison = randomBytes(30).toString('hex');
  env.UNRELATED_SECRET = poison; proof.untrusted = poison;
  proof.connectors.binance.error = poison;
  sign(env, proof);
  const json = JSON.stringify(buildFounderSnapshot(env, NOW));
  for (const value of [poison, env.GENESIS_OWNER_ADDRESS, env.GENESIS_ACCOUNT_ID, env.BINANCE_API_KEY,
    env.BINANCE_API_SECRET, env.GENESIS_PREFLIGHT_JSON, env.GENESIS_PREFLIGHT_SIGNATURE, env.GENESIS_PREFLIGHT_HMAC_KEY]) assert.equal(json.includes(value), false);
  assert.equal(json.includes('UNRELATED_SECRET'), false);
});
test('both venue and gateway require an explicit read_only live-account check mode', () => {
  for (const id of ['binance', 'execution_broker']) {
    for (const mode of [undefined, 'testnet', 'paper', 'live', 'invalid']) {
      const { env, proof } = fixture(); proof.connectors[id].mode = mode; blocked(sign(env, proof));
    }
  }
});
test('legacy live flags have no effect and no caller env is changed', () => {
  const env = Object.freeze({ LIVE_MODE: 'true', REAL_TRADING: 'true', REAL_TRADING_CONFIRM: 'true', LIVE_OFF: 'false' });
  blocked(env); assert.equal(env.LIVE_OFF, 'false');
});

test('HTTP method contract includes OPTIONS, HEAD and write methods', () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD', undefined]) assert.equal(founderResponse(method, {}, NOW).status, 405);
  assert.equal(founderResponse('GET', {}, NOW).status, 200);
});
test('Vercel handler sends no-store JSON and 405 + Allow for non-GET', () => {
  for (const method of ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD']) {
    const res = { headers: {}, status(n) { this.code = n; return this; }, setHeader(k, v) { this.headers[k] = v; return this; }, send(body) { this.body = body; } };
    vercelHandler({ method }, res);
    assert.equal(res.code, method === 'GET' ? 200 : 405);
    assert.match(res.headers['Cache-Control'], /no-store/);
    if (method !== 'GET') assert.equal(res.headers.Allow, 'GET');
    assert.equal(JSON.parse(res.body).ok, method === 'GET');
  }
});
test('Node adapter works over actual HTTP with no-store, blocked GET and rejected writes', async () => {
  const server = createServer(handleFounderRequest);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/genesis/founder`;
    const res = await fetch(url);
    assert.equal(res.status, 200); assert.match(res.headers.get('cache-control'), /no-store/);
    const s = await res.json(); assert.equal(s.readiness, 'BLOCKED');
    for (const method of ['POST', 'PATCH', 'OPTIONS', 'HEAD', 'DELETE']) {
      const denied = await fetch(url, { method }); assert.equal(denied.status, 405); assert.equal(denied.headers.get('allow'), 'GET');
    }
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
