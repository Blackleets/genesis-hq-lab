import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { bucketTradesByWindow } from '../crypto/backtest/breakoutWalkForward.mjs';

describe('bucketTradesByWindow', () => {
  it('distributes trades into consecutive equal-time windows', () => {
    // openTimes 0..100, 5 windows → boundaries every 20.
    const trades = [
      { openTime: 0, side: 'SHORT' },
      { openTime: 19, side: 'LONG' },
      { openTime: 25, side: 'SHORT' },
      { openTime: 55, side: 'SHORT' },
      { openTime: 100, side: 'LONG' }, // max → clamps into last window
    ];
    const buckets = bucketTradesByWindow(trades, 5);
    assert.equal(buckets.length, 5);
    assert.equal(buckets[0].trades.length, 2); // openTime 0, 19
    assert.equal(buckets[1].trades.length, 1); // 25
    assert.equal(buckets[2].trades.length, 1); // 55
    assert.equal(buckets[4].trades.length, 1); // 100 clamped into last
    // Every trade is accounted for exactly once.
    assert.equal(buckets.reduce((n, b) => n + b.trades.length, 0), trades.length);
  });

  it('returns empty windows for no trades', () => {
    const buckets = bucketTradesByWindow([], 4);
    assert.equal(buckets.length, 4);
    assert.ok(buckets.every((b) => b.trades.length === 0));
  });
});
