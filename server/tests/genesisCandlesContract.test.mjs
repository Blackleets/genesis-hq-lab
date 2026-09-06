import test from 'node:test';
import assert from 'node:assert/strict';
import { MARKET_PAIRS, normalizeWatchlist } from '../../api/genesis/candles.js';

test('watchlist preserves verified Binance values and source timestamps', () => {
  const rows = normalizeWatchlist([{
    symbol: 'BTCUSDT',
    lastPrice: '79854.60',
    priceChangePercent: '0.24',
    quoteVolume: '123456.78',
    closeTime: 1_725_000_000_000,
  }], '2026-09-06T00:00:00.000Z');

  assert.equal(rows.length, MARKET_PAIRS.length);
  assert.deepEqual(rows[0], {
    symbol: 'BTCUSDT',
    lastPrice: 79854.6,
    changePct: 0.24,
    quoteVolume: 123456.78,
    updatedAt: new Date(1_725_000_000_000).toISOString(),
    state: 'ready',
    source: 'binance_spot_public',
  });
});

test('watchlist never converts absent market values into zero', () => {
  const rows = normalizeWatchlist([{ symbol: 'ETHUSDT', lastPrice: null, priceChangePercent: '', quoteVolume: undefined }]);
  const eth = rows.find((row) => row.symbol === 'ETHUSDT');
  const doge = rows.find((row) => row.symbol === 'DOGEUSDT');

  assert.deepEqual({ price: eth?.lastPrice, change: eth?.changePct, volume: eth?.quoteVolume, state: eth?.state }, {
    price: null,
    change: null,
    volume: null,
    state: 'unavailable',
  });
  assert.equal(doge?.lastPrice, null);
  assert.equal(doge?.updatedAt, null);
  assert.equal(doge?.state, 'unavailable');
});
