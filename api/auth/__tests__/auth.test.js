// api/auth/__tests__/auth.test.js — vitest suite for the SIWES wallet auth flow.
// Covers: nonce uniqueness + expiry, signature rejection, single-use nonces,
// JWT issue/verify round-trip, operator vs user role assignment.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { jwtVerify } from 'jose';

// Deterministic JWT secret for tests (sessions.js reads this lazily per call).
process.env.AUTH_JWT_SECRET = 'test-only-secret-do-not-use-in-prod-0123456789abcdef';

import nonceHandler, { nonceStore, NONCE_TTL_MS } from '../nonce.js';
import verifyHandler from '../verify.js';

const TEST_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'; // throwaway test key, no funds
const TEST_ADDR = privateKeyToAccount(TEST_KEY).address.toLowerCase();
const OTHER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'; // throwaway test key
const OTHER_ADDR = privateKeyToAccount(OTHER_KEY).address;

let ipCounter = 0;

function mockReq(body) {
  return {
    method: 'POST',
    headers: { origin: 'https://genesis.test', host: 'genesis.test' },
    socket: { remoteAddress: `10.0.${++ipCounter}.1` }, // fresh IP per request -> no rate-limit interference
    body,
  };
}

function mockRes() {
  const res = {
    statusCode: 0,
    headers: {},
    body: null,
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[k] = v; return this; },
    send(b) { this.body = b; return this; },
  };
  res.json = () => JSON.parse(res.body);
  return res;
}

async function requestNonce(address = TEST_ADDR) {
  const req = mockReq({ address });
  const res = mockRes();
  await nonceHandler(req, res);
  return { req, res, json: JSON.parse(res.body) };
}

async function doVerify({ address = TEST_ADDR, key = TEST_KEY, nonce, message }) {
  const acct = privateKeyToAccount(key);
  const signature = await acct.signMessage({ message });
  const req = mockReq({ address, signature, nonce });
  const res = mockRes();
  await verifyHandler(req, res);
  return { req, res, json: JSON.parse(res.body) };
}

beforeEach(() => {
  nonceStore.clear();
  delete process.env.OPERATOR_ADDRESSES;
});

afterEach(() => {
  delete process.env.OPERATOR_ADDRESSES;
});

describe('POST /api/auth/nonce', () => {
  it('returns ok:true with a 32-hex nonce and a SIWES message including the no-transfer disclaimer', async () => {
    const { json } = await requestNonce();
    expect(json.ok).toBe(true);
    expect(json.nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(json.message).toContain(`Address: ${TEST_ADDR}`);
    expect(json.message).toContain(json.nonce);
    expect(json.message).toContain('Solo autenticación. Esta firma NO autoriza transacciones ni transferencias.');
  });

  it('generates unique nonces across calls', async () => {
    const a = await requestNonce();
    const b = await requestNonce();
    expect(a.json.nonce).not.toBe(b.json.nonce);
    expect(nonceStore.size).toBe(2);
  });

  it('stores nonces with a ~5 minute expiry', async () => {
    const { json } = await requestNonce();
    const rec = nonceStore.get(json.nonce);
    expect(rec).toBeDefined();
    expect(rec.expiresAt - Date.now()).toBeGreaterThan(NONCE_TTL_MS - 5000);
    expect(rec.addressLower).toBe(TEST_ADDR);
  });

  it('rejects invalid addresses and wrong methods', async () => {
    const { res } = await requestNonce('not-an-address');
    expect(res.statusCode).toBe(400);
    const req = { method: 'GET', headers: {}, socket: { remoteAddress: '10.9.9.9' } };
    const res2 = mockRes();
    await nonceHandler(req, res2);
    expect(res2.statusCode).toBe(405);
  });
});

describe('POST /api/auth/verify', () => {
  it('verifies a valid EIP-191 personal_sign and returns a session', async () => {
    const { json: n } = await requestNonce();
    const { res, json } = await doVerify({ nonce: n.nonce, message: n.message });
    expect(res.statusCode).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.session.role).toBe('user');
    expect(json.session.token).toBeUndefined();
    expect(res.headers['Set-Cookie']).toContain('HttpOnly; Secure; SameSite=Strict');
    expect(json.session.expiresAt - json.session.issuedAt).toBe(24 * 60 * 60);
    expect(nonceStore.has(n.nonce)).toBe(false); // consumed
  });

  it('rejects an invalid signature (signed by a different wallet)', async () => {
    const { json: n } = await requestNonce(TEST_ADDR);
    const { res, json } = await doVerify({
      address: TEST_ADDR,
      key: OTHER_KEY, // wrong signer
      nonce: n.nonce,
      message: n.message,
    });
    expect(res.statusCode).toBe(401);
    expect(json.error).toBe('invalid_signature');
  });

  it('rejects a signature over a tampered message', async () => {
    const { json: n } = await requestNonce();
    const tampered = n.message.replace('NO autoriza transacciones', 'SÍ autoriza transacciones');
    const { res } = await doVerify({ nonce: n.nonce, message: tampered });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a reused nonce (single use)', async () => {
    const { json: n } = await requestNonce();
    const first = await doVerify({ nonce: n.nonce, message: n.message });
    expect(first.res.statusCode).toBe(200);
    const second = await doVerify({ nonce: n.nonce, message: n.message });
    expect(second.res.statusCode).toBe(401);
    expect(second.json.error).toBe('invalid_or_expired_nonce');
  });

  it('rejects an expired nonce', async () => {
    const { json: n } = await requestNonce();
    const rec = nonceStore.get(n.nonce);
    rec.expiresAt = Date.now() - 1; // force expiry
    const { res, json } = await doVerify({ nonce: n.nonce, message: n.message });
    expect(res.statusCode).toBe(401);
    expect(json.error).toBe('invalid_or_expired_nonce');
  });

  it('rejects when nonce was issued to a different address', async () => {
    const { json: n } = await requestNonce(TEST_ADDR);
    const { res } = await doVerify({ address: OTHER_ADDR, key: OTHER_KEY, nonce: n.nonce, message: n.message });
    expect(res.statusCode).toBe(401);
  });
});

describe('JWT session token', () => {
  it('decodes and validates with jose (sub, role, iat, exp)', async () => {
    const { json: n } = await requestNonce();
    const { res } = await doVerify({ nonce: n.nonce, message: n.message });
    const secret = new TextEncoder().encode(process.env.AUTH_JWT_SECRET);
    const { payload, protectedHeader } = await jwtVerify(res.headers['Set-Cookie'].split(';')[0].split('=')[1], secret, { algorithms: ['HS256'] });
    expect(protectedHeader.alg).toBe('HS256');
    expect(payload.sub).toBe(TEST_ADDR); // lowercase
    expect(payload.role).toBe('user');
    expect(typeof payload.iat).toBe('number');
    expect(payload.exp).toBe(payload.iat + 24 * 60 * 60);
  });

  it('fails validation when signed with a different secret', async () => {
    const { json: n } = await requestNonce();
    const { res } = await doVerify({ nonce: n.nonce, message: n.message });
    const badSecret = new TextEncoder().encode('wrong-secret-wrong-secret-wrong');
    await expect(jwtVerify(res.headers['Set-Cookie'].split(';')[0].split('=')[1], badSecret)).rejects.toThrow();
  });
});

describe('role assignment (OPERATOR_ADDRESSES)', () => {
  it("assigns 'operator' when the address is whitelisted (case-insensitive)", async () => {
    process.env.OPERATOR_ADDRESSES = `  ${TEST_ADDR.toUpperCase()} , someoneelse.eth `;
    const { json: n } = await requestNonce();
    const { res, json } = await doVerify({ nonce: n.nonce, message: n.message });
    expect(res.statusCode).toBe(200);
    expect(json.session.role).toBe('operator');
  });

  it("assigns 'user' when the address is not whitelisted", async () => {
    process.env.OPERATOR_ADDRESSES = '0x0000000000000000000000000000000000000001';
    const { json: n } = await requestNonce();
    const { res } = await doVerify({ nonce: n.nonce, message: n.message });
    expect(res.json().session.role).toBe('user');
  });
});
