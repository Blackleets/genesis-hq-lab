import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveRpiOrderBookFeatures, getOkxRpiOrderBookContext } from '../genesis/okxRpiOrderBook.mjs';

test('deriveRpiOrderBookFeatures computes depth imbalance without direction inversion', () => {
  const result = deriveRpiOrderBookFeatures({
    bids: [['100', '6', '5', '2'], ['99', '4', '4', '1']],
    asks: [['101', '3', '3', '1'], ['102', '2', '1', '2']],
  });
  assert.equal(result.rpiBookLevelCount, 2);
  assert.equal(result.rpiBestBid, 100);
  assert.equal(result.rpiBestAsk, 101);
  assert.equal(result.rpiBestBidQty, 6);
  assert.equal(result.rpiBestAskQty, 3);
  assert.equal(result.rpiMidPrice, 100.5);
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
  assert.equal(result.rpiBestBid, 100);
  assert.equal(result.rpiBestAsk, 101);
  assert.equal(result.rpiMidPrice, 100.5);
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

test('invalid or crossed book never fabricates a mid price', () => {
  const result = deriveRpiOrderBookFeatures({
    bids: [['102', '5', '5', '1']],
    asks: [['101', '5', '5', '1']],
  });
  assert.equal(result.rpiMidPrice, null);
  assert.equal(result.rpiSpreadBps, null);
  assert.equal(result.rpiMicroprice, null);
});


test('RPI book derives microprice and 10/25 bps depth-band imbalance', () => {
  const features = deriveRpiOrderBookFeatures({
    bids: [
      ['100.0', '10', '8', '2'],
      ['99.9', '5', '4', '1'],
    ],
    asks: [
      ['100.2', '5', '4', '3'],
      ['100.3', '5', '4', '2'],
    ],
  });

  assert.ok(features.rpiMicroprice > features.rpiMidPrice);
  assert.ok(features.rpiMicropriceSkewBps > 0);
  assert.equal(features.rpiBidDepth10Bps, 10);
  assert.equal(features.rpiAskDepth10Bps, 5);
  assert.ok(Math.abs(features.rpiDepthImbalance10Bps - (1 / 3)) < 1e-12);
  assert.equal(features.rpiBidDepth25Bps, 15);
  assert.equal(features.rpiAskDepth25Bps, 10);
  assert.ok(Math.abs(features.rpiDepthImbalance25Bps - 0.2) < 1e-12);
  assert.equal(features.rpiBidOrderCount, 3);
  assert.equal(features.rpiAskOrderCount, 5);
  assert.equal(features.rpiOrderCountImbalance, -0.25);
});

test('one-sided book does not fabricate microprice or depth-band metrics', () => {
  const features = deriveRpiOrderBookFeatures({
    bids: [['100.0', '10', '8', '2']],
    asks: [],
  });
  assert.equal(features.rpiMidPrice, null);
  assert.equal(features.rpiMicroprice, null);
  assert.equal(features.rpiMicropriceSkewBps, null);
  assert.equal(features.rpiBidDepth10Bps, null);
  assert.equal(features.rpiDepthImbalance10Bps, null);
});


test('missing numeric fields are rejected instead of coerced to zero', () => {
  const features = deriveRpiOrderBookFeatures({
    bids: [[null, '5', '5', '1']],
    asks: [['101', '5', '5', '1']],
  });
  assert.equal(features.rpiBestBid, null);
  assert.equal(features.rpiMidPrice, null);
  assert.equal(features.rpiMicroprice, null);
});
