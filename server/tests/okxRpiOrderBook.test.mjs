import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveRpiOrderBookFeatures, getOkxRpiOrderBookContext } from '../genesis/okxRpiOrderBook.mjs';

test('deriveRpiOrderBookFeatures computes depth imbalance without direction inversion', () => {
  const result = deriveRpiOrderBookFeatures({
    bids: [['100', '6', '5', '2'], ['99', '4', '4', '1']],
    asks: [['101', '3', '3', '1'], ['102', '2', '1', '2']],
  });
  assert.equal(result.rpiBookLevelCount, 2);
  assert.equal(result.rpiBidDepth, 10);
  assert.equal(result.rpiAskDepth, 5);
  assert.ok(Math.abs(result.rpiDepthImbalance - (5 / 15)) < 1e-12);
  assert.ok(result.rpiDepthShare > 0 && result.rpiDepthShare < 1);
  assert.ok(result.rpiSpreadBps > 0);
});

test('getOkxRpiOrderBookContext preserves exchange timestamp and uses public endpoint', async () => {
  let requested = null;
  const fetchImpl = async url => {
    requested = url;
    return {
      ok: true,
      async json() {
        return { code: '0', data: [{
          asks: [['101', '5', '4', '2']],
          bids: [['100', '7', '6', '2']],
          ts: '1788950000123',
        }] };
      },
    };
  };
  const result = await getOkxRpiOrderBookContext('BTC-USDT-SWAP', { depth: 20, fetchImpl });
  assert.equal(result.time, 1788950000123);
  assert.equal(result.source, 'okx_books_rpi');
  assert.ok(requested.includes('/api/v5/market/books-rpi?'));
  assert.ok(requested.includes('BTC-USDT-SWAP'));
  assert.ok(result.rpiDepthImbalance > 0);
});

test('RPI depth share is zero when all displayed depth is organic', () => {
  const result = deriveRpiOrderBookFeatures({
    bids: [['100', '5', '5', '1']],
    asks: [['101', '5', '5', '1']],
  });
  assert.equal(result.rpiDepthShare, 0);
  assert.equal(result.rpiDepthImbalance, 0);
});
