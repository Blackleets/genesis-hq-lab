import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildShadowCandidatePayload, evaluateShadowCandidateSnapshot } from '../crypto/shadowCandidate.mjs';

describe('shadowCandidate diagnostics', () => {
  it('returns a stable empty payload when disabled', () => {
    const payload = buildShadowCandidatePayload({ running: false, candidateId: null, pairSet: [] });
    assert.equal(payload.running, false);
    assert.deepEqual(payload.byPair, []);
    assert.deepEqual(payload.byHour, []);
    assert.deepEqual(payload.recent, []);
  });

  it('tracks would-trade and blocked signals without opening trades', () => {
    const candidate = {
      candidateId: 'btc_trend_1h_v1',
      pairSet: ['BTCUSDT'],
      signalFn: () => ({ action: 'TRADE', side: 'LONG', confidence: 0.75, reasons: ['stub'] }),
      signalParams: {},
    };
    const snapshot = {
      candidateId: null,
      running: false,
      pairSet: [],
      signalsSeen: 0,
      wouldTradeCount: 0,
      blockedCount: 0,
      byPair: new Map(),
      byHour: new Map(),
      recent: [],
    };
    const payload = evaluateShadowCandidateSnapshot({
      candidate,
      contexts: [{ pair: 'BTCUSDT', price: 100, closes: Array.from({ length: 360 }, (_, index) => 100 + index * 0.1) }],
      openedAt: '2026-06-08T12:00:00.000Z',
      snapshot,
    });
    assert.equal(payload.running, true);
    assert.equal(payload.candidateId, 'btc_trend_1h_v1');
    assert.equal(payload.signalsSeen, 1);
    assert.equal(payload.wouldTradeCount, 1);
    assert.equal(payload.blockedCount, 0);
    assert.equal(payload.byPair[0].pair, 'BTCUSDT');
  });
});
