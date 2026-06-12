import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeOrderAmounts,
  buildSignedOrder,
  serializeOrder,
} from '../predictionMarkets/execution/clobSigner.mjs';
import { buildAuthHeaders, getClobCredentials } from '../predictionMarkets/execution/clobApiClient.mjs';

// Test private key — never use in production, deterministic for tests
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
// Corresponding address from viem
const EXPECTED_ADDRESS  = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

describe('computeOrderAmounts', () => {
  test('BUY: makerAmount = price * size, takerAmount = size', () => {
    const { makerAmount, takerAmount } = computeOrderAmounts('BUY', 0.5, 10);
    assert.equal(makerAmount, BigInt(Math.round(0.5 * 10 * 1e6)));
    assert.equal(takerAmount, BigInt(Math.round(10 * 1e6)));
  });

  test('SELL: makerAmount = size, takerAmount = price * size', () => {
    const { makerAmount, takerAmount } = computeOrderAmounts('SELL', 0.6, 20);
    assert.equal(makerAmount, BigInt(Math.round(20 * 1e6)));
    assert.equal(takerAmount, BigInt(Math.round(0.6 * 20 * 1e6)));
  });

  test('throws for price >= 1', () => {
    assert.throws(() => computeOrderAmounts('BUY', 1.0, 10), /price must be in/);
  });

  test('throws for price <= 0', () => {
    assert.throws(() => computeOrderAmounts('BUY', 0, 10), /price must be in/);
  });

  test('throws for negative size', () => {
    assert.throws(() => computeOrderAmounts('BUY', 0.5, -1), /sizeUsd must be positive/);
  });

  test('amounts are BigInt', () => {
    const { makerAmount, takerAmount } = computeOrderAmounts('BUY', 0.3, 5);
    assert.equal(typeof makerAmount, 'bigint');
    assert.equal(typeof takerAmount, 'bigint');
  });
});

describe('buildSignedOrder', () => {
  test('returns orderStruct, signature, signerAddress', async () => {
    const result = await buildSignedOrder(
      { tokenId: '12345', side: 'BUY', price: 0.5, sizeUsd: 10 },
      TEST_PRIVATE_KEY,
    );
    assert.ok(result.orderStruct, 'orderStruct present');
    assert.ok(result.signature?.startsWith('0x'), 'signature is 0x hex');
    assert.equal(result.signerAddress.toLowerCase(), EXPECTED_ADDRESS.toLowerCase());
  });

  test('orderStruct has all 12 required fields', async () => {
    const { orderStruct } = await buildSignedOrder(
      { tokenId: '99', side: 'BUY', price: 0.4, sizeUsd: 5 },
      TEST_PRIVATE_KEY,
    );
    const REQUIRED = ['salt', 'maker', 'signer', 'taker', 'tokenId', 'makerAmount', 'takerAmount', 'expiration', 'nonce', 'feeRateBps', 'side', 'signatureType'];
    for (const f of REQUIRED) {
      assert.ok(f in orderStruct, `missing field: ${f}`);
    }
  });

  test('salt is unique per call', async () => {
    const params = { tokenId: '1', side: 'BUY', price: 0.5, sizeUsd: 10 };
    const r1 = await buildSignedOrder(params, TEST_PRIVATE_KEY);
    const r2 = await buildSignedOrder(params, TEST_PRIVATE_KEY);
    assert.notEqual(r1.orderStruct.salt.toString(), r2.orderStruct.salt.toString(), 'salt should be random');
  });

  test('BUY side maps to 0', async () => {
    const { orderStruct } = await buildSignedOrder(
      { tokenId: '1', side: 'BUY', price: 0.5, sizeUsd: 10 },
      TEST_PRIVATE_KEY,
    );
    assert.equal(orderStruct.side, 0);
  });

  test('SELL side maps to 1', async () => {
    const { orderStruct } = await buildSignedOrder(
      { tokenId: '1', side: 'SELL', price: 0.5, sizeUsd: 10 },
      TEST_PRIVATE_KEY,
    );
    assert.equal(orderStruct.side, 1);
  });

  test('throws for missing private key', async () => {
    await assert.rejects(
      () => buildSignedOrder({ tokenId: '1', side: 'BUY', price: 0.5, sizeUsd: 10 }, ''),
      /privateKey must be a 0x-prefixed/,
    );
  });

  test('throws for invalid price', async () => {
    await assert.rejects(
      () => buildSignedOrder({ tokenId: '1', side: 'BUY', price: 1.5, sizeUsd: 10 }, TEST_PRIVATE_KEY),
      /price must be in/,
    );
  });
});

describe('serializeOrder', () => {
  test('serializes all BigInt fields to strings', async () => {
    const { orderStruct, signature, signerAddress } = await buildSignedOrder(
      { tokenId: '777', side: 'BUY', price: 0.6, sizeUsd: 15 },
      TEST_PRIVATE_KEY,
    );
    const serialized = serializeOrder(orderStruct, signature, signerAddress);

    // All numeric fields should be strings (not BigInt)
    for (const field of ['salt', 'tokenId', 'makerAmount', 'takerAmount', 'expiration', 'nonce', 'feeRateBps']) {
      assert.equal(typeof serialized[field], 'string', `${field} should be string`);
    }
    // signature is 0x hex string
    assert.ok(serialized.signature.startsWith('0x'));
  });
});

describe('buildAuthHeaders', () => {
  test('returns required POLY_ headers', () => {
    const headers = buildAuthHeaders('POST', '/order', { test: true }, {
      apiKey: 'test-key',
      secret: 'test-secret',
      passphrase: 'test-pass',
      signerAddress: '0xabc',
    });
    assert.ok('POLY_ADDRESS' in headers);
    assert.ok('POLY_SIGNATURE' in headers);
    assert.ok('POLY_TIMESTAMP' in headers);
    assert.ok('POLY_API_KEY' in headers);
    assert.ok('POLY_PASSPHRASE' in headers);
    assert.equal(headers['POLY_API_KEY'], 'test-key');
  });

  test('signature is non-empty when secret is provided', () => {
    const headers = buildAuthHeaders('POST', '/order', {}, {
      apiKey: 'k', secret: 'sec', passphrase: 'pp', signerAddress: '0x1',
    });
    assert.ok(headers['POLY_SIGNATURE'].length > 0);
  });

  test('POLY_TIMESTAMP is a numeric string', () => {
    const headers = buildAuthHeaders('GET', '/markets', null, {
      apiKey: 'k', secret: 's', passphrase: 'p', signerAddress: '0x1',
    });
    assert.ok(/^\d+$/.test(headers['POLY_TIMESTAMP']));
  });
});

describe('getClobCredentials', () => {
  test('handles missing env vars gracefully', () => {
    const saved = { key: process.env.POLYMARKET_API_KEY, pk: process.env.POLYMARKET_PRIVATE_KEY };
    delete process.env.POLYMARKET_API_KEY;
    delete process.env.POLYMARKET_PRIVATE_KEY;
    const creds = getClobCredentials();
    assert.equal(creds.apiKey, null);
    assert.equal(creds.privateKey, null);
    // restore
    if (saved.key !== undefined) process.env.POLYMARKET_API_KEY = saved.key;
    if (saved.pk  !== undefined) process.env.POLYMARKET_PRIVATE_KEY = saved.pk;
  });

  test('parses JSON API key format', () => {
    const saved = process.env.POLYMARKET_API_KEY;
    process.env.POLYMARKET_API_KEY = JSON.stringify({ apiKey: 'ak', secret: 's', passphrase: 'pp' });
    const creds = getClobCredentials();
    assert.equal(creds.apiKey, 'ak');
    assert.equal(creds.secret, 's');
    assert.equal(creds.passphrase, 'pp');
    process.env.POLYMARKET_API_KEY = saved;
  });

  test('handles plain string API key format', () => {
    const saved = process.env.POLYMARKET_API_KEY;
    process.env.POLYMARKET_API_KEY = 'plain-key-string';
    const creds = getClobCredentials();
    assert.equal(creds.apiKey, 'plain-key-string');
    process.env.POLYMARKET_API_KEY = saved;
  });
});
