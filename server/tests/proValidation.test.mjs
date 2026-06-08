import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { computeMacd, summarizeTimeframe } from '../crypto/proValidation.mjs';

describe('computeMacd', () => {
  it('returns histogram > 0 on a rising series', () => {
    const closes = Array.from({ length: 80 }, (_, i) => 100 + i);
    const macd = computeMacd(closes);
    assert.ok((macd.histogram ?? 0) > 0);
  });

  it('returns zeros on insufficient candles', () => {
    const macd = computeMacd([1, 2, 3]);
    assert.equal(macd.histogram, 0);
  });
});

describe('summarizeTimeframe', () => {
  it('flags bullish conditions as confirm_long', () => {
    const closes = Array.from({ length: 100 }, (_, i) => 100 + i * 1.5);
    const tf = summarizeTimeframe(closes, '1h');
    assert.equal(tf.trend, 'bullish');
    assert.equal(tf.verdict, 'confirm_long');
  });

  it('flags bearish conditions as confirm_short', () => {
    const closes = Array.from({ length: 100 }, (_, i) => 300 - i * 2);
    const tf = summarizeTimeframe(closes, '4h');
    assert.equal(tf.trend, 'bearish');
    assert.equal(tf.verdict, 'confirm_short');
  });

  it('returns insufficient when candles are missing', () => {
    const tf = summarizeTimeframe([1, 2, 3], '15m');
    assert.equal(tf.verdict, 'insufficient');
  });
});
