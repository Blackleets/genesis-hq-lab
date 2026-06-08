import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const { applyManualContextBlocks } = await import('../strategies/scalpingEngine.mjs');

describe('applyManualContextBlocks', () => {
  const baseSignal = {
    action: 'TRADE',
    side: 'LONG',
    confidence: 0.86,
    rawConfidence: 0.86,
    signals: ['EMA_BULL_CROSS', 'RSI_BULL_MOMENTUM'],
    regime: 'BULL',
    bias: 0,
    vetoed: false,
  };

  it('blocks the configured toxic hour via confidence gate only', () => {
    const result = applyManualContextBlocks({ ...baseSignal, confidence: 0.76, rawConfidence: 0.76 }, { pair: 'BTCUSDT' }, '2026-06-08T16:10:00Z');
    assert.equal(result.blockedByHour, true);
    assert.equal(result.blockedByPair, false);
    assert.equal(result.blockedByConfidenceBand, false);
    assert.equal(result.confidence, 0.40);
    assert.equal(result.hour, '16');
  });

  it('does not alter a non-blocked context', () => {
    const result = applyManualContextBlocks({ ...baseSignal, confidence: 0.76, rawConfidence: 0.76 }, { pair: 'BTCUSDT' }, '2026-06-08T12:10:00Z');
    assert.equal(result.blockedByHour, false);
    assert.equal(result.blockedByPair, false);
    assert.equal(result.blockedByConfidenceBand, false);
    assert.equal(result.confidence, 0.76);
    assert.equal(result.confidenceBand, '70-79');
  });

  it('blocks the configured toxic confidence band via confidence gate only', () => {
    const result = applyManualContextBlocks(baseSignal, { pair: 'BTCUSDT' }, '2026-06-08T12:10:00Z');
    assert.equal(result.blockedByHour, false);
    assert.equal(result.blockedByPair, false);
    assert.equal(result.blockedByConfidenceBand, true);
    assert.equal(result.confidence, 0.40);
    assert.equal(result.confidenceBand, '80-89');
  });
});
