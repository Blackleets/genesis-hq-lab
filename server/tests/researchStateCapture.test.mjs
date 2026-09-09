import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSynchronizedResearchState } from '../genesis/researchStateCapture.mjs';

const derivatives = {
  symbol: 'BTCUSDT',
  oiUsdNow: 8_300_000_000,
  oiChangePct: -1.1,
  oiRecentChangePct: -0.4,
  oiAccelerationPct: -0.2,
  takerBias: 1.02,
  takerRecentBias: 1.18,
  takerImpulse: 0.22,
  takerPressure: 'buy_pressure',
  takerReversal: true,
  fundingRateNow: 0.00005,
  fundingAvg: 0.00004,
  fundingCrowd: 'balanced',
  premiumNowBps: -4.2,
  premiumRecentAvgBps: -3.8,
  premiumImpulseBps: -0.9,
  raw: {
    oi: [{ time: 1_700_000_000_000 }],
    taker: [{ time: 1_699_999_800_000 }],
    funding: [{ time: 1_699_999_000_000 }],
    premium: [{ time: 1_699_999_800_000 }],
  },
};

const leadLag = {
  symbol: 'BTCUSDT',
  spreadNowBps: -4.9,
  spreadAvgBps: -3.1,
  spreadVolBps: 1.2,
  returnCorr0: 0.96,
  bestLagBars: 1,
  bestLagCorr: 0.41,
  leader: 'spot',
  latestReturnDivergenceBps: 2.3,
  raw: {
    spot: [{ time: 1_700_000_000_000, close: 100 }],
    perp: [{ time: 1_700_000_000_000, close: 99.9 }],
  },
};

test('buildSynchronizedResearchState preserves source timestamps and rejects future data', () => {
  const state = buildSynchronizedResearchState({
    symbol: 'BTCUSDT',
    capturedAt: '2023-11-14T22:13:30.000Z',
    derivatives,
    leadLag,
  });

  assert.equal(state.mode, 'RESEARCH_ONLY');
  assert.equal(state.safeForResearch, true);
  assert.equal(state.integrity.noFutureData, true);
  assert.deepEqual(state.integrity.futureSources, []);
  assert.deepEqual(state.integrity.missingSources, []);
  assert.equal(state.sourceAgeMs.oi, 10_000);
  assert.equal(state.features.takerRecentBias, 1.18);
  assert.equal(state.features.leader, 'spot');
});

test('buildSynchronizedResearchState marks a future source unsafe instead of silently accepting look-ahead', () => {
  const futureLeadLag = {
    ...leadLag,
    raw: {
      spot: [{ time: 1_700_000_020_000, close: 100 }],
      perp: [{ time: 1_700_000_000_000, close: 99.9 }],
    },
  };
  const state = buildSynchronizedResearchState({
    symbol: 'BTCUSDT',
    capturedAt: '2023-11-14T22:13:30.000Z',
    derivatives,
    leadLag: futureLeadLag,
  });

  assert.equal(state.safeForResearch, false);
  assert.equal(state.integrity.noFutureData, false);
  assert.deepEqual(state.integrity.futureSources, ['spot']);
});

test('buildSynchronizedResearchState marks missing source timestamps unsafe', () => {
  const state = buildSynchronizedResearchState({
    symbol: 'BTCUSDT',
    capturedAt: '2023-11-14T22:13:30.000Z',
    derivatives: { ...derivatives, raw: { ...derivatives.raw, funding: [] } },
    leadLag,
  });

  assert.equal(state.safeForResearch, false);
  assert.deepEqual(state.integrity.missingSources, ['funding']);
});
