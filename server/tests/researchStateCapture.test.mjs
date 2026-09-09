import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSynchronizedResearchState, deriveCrossCaptureFeatures, SOURCE_FRESHNESS_BUDGET_MS, MAX_CROSS_CAPTURE_GAP_MS } from '../genesis/researchStateCapture.mjs';

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
  referenceSource: 'binance_futures_index',
  spreadNowBps: -4.9,
  spreadAvgBps: -3.1,
  spreadVolBps: 1.2,
  returnCorr0: 0.96,
  bestLagBars: 1,
  bestLagCorr: 0.41,
  leader: 'reference',
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
  assert.equal(state.referenceSource, 'binance_futures_index');
  assert.equal(state.integrity.noFutureData, true);
  assert.equal(state.integrity.allSourcesFresh, true);
  assert.deepEqual(state.integrity.futureSources, []);
  assert.deepEqual(state.integrity.missingSources, []);
  assert.deepEqual(state.integrity.staleSources, []);
  assert.equal(state.sourceAgeMs.oi, 10_000);
  assert.equal(state.sourceFreshnessBudgetMs.oi, SOURCE_FRESHNESS_BUDGET_MS.oi);
  assert.equal(state.features.takerRecentBias, 1.18);
  assert.equal(state.features.leader, 'reference');
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
  assert.deepEqual(state.integrity.futureSources, ['reference']);
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

test('buildSynchronizedResearchState rejects present-but-stale evidence by source cadence', () => {
  const staleOiTime = 1_700_000_010_000 - SOURCE_FRESHNESS_BUDGET_MS.oi - 1;
  const state = buildSynchronizedResearchState({
    symbol: 'BTCUSDT',
    capturedAt: '2023-11-14T22:13:30.000Z',
    derivatives: {
      ...derivatives,
      raw: { ...derivatives.raw, oi: [{ time: staleOiTime }] },
    },
    leadLag,
  });

  assert.equal(state.safeForResearch, false);
  assert.equal(state.integrity.allSourcesFresh, false);
  assert.deepEqual(state.integrity.staleSources, ['oi']);
  assert.equal(state.integrity.missingSources.length, 0);
  assert.equal(state.integrity.futureSources.length, 0);
});

test('deriveCrossCaptureFeatures creates only causal same-provider deltas', () => {
  const previous = {
    safeForResearch: true,
    provider: 'okx',
    symbol: 'BTCUSDT',
    capturedAt: '2026-09-09T10:00:00.000Z',
    features: { oiUsdNow: 2_000_000_000, takerBias: 1.2, fundingRateNow: 0.00005, premiumNowBps: -4.0, spreadNowBps: -4.0 },
  };
  const current = {
    safeForResearch: true,
    provider: 'okx',
    symbol: 'BTCUSDT',
    capturedAt: '2026-09-09T10:15:00.000Z',
    features: { oiUsdNow: 2_020_000_000, takerBias: 1.5, fundingRateNow: 0.00007, premiumNowBps: -3.5, spreadNowBps: -3.6 },
  };
  const result = deriveCrossCaptureFeatures(current, previous);
  assert.equal(result.available, true);
  assert.equal(result.gapMs, 15 * 60 * 1000);
  assert.ok(Math.abs(result.oiCrossCaptureChangePct - 1) < 1e-12);
  assert.ok(Math.abs(result.takerBiasCrossCaptureChange - 0.3) < 1e-12);
  assert.ok(Math.abs(result.fundingCrossCaptureDeltaBps - 0.2) < 1e-12);
  assert.ok(Math.abs(result.premiumCrossCaptureDeltaBps - 0.5) < 1e-12);
  assert.ok(Math.abs(result.spreadCrossCaptureDeltaBps - 0.4) < 1e-12);
});

test('deriveCrossCaptureFeatures refuses venue mixing and stale prior captures', () => {
  const base = {
    safeForResearch: true,
    provider: 'okx',
    symbol: 'BTCUSDT',
    capturedAt: '2026-09-09T10:00:00.000Z',
    features: { oiUsdNow: 2_000_000_000, takerBias: 1.2, fundingRateNow: 0.00005, premiumNowBps: -4, spreadNowBps: -4 },
  };
  const venueMix = deriveCrossCaptureFeatures({ ...base, provider: 'binance', capturedAt: '2026-09-09T10:15:00.000Z' }, base);
  assert.equal(venueMix.available, false);
  const stale = deriveCrossCaptureFeatures({ ...base, capturedAt: new Date(Date.parse(base.capturedAt) + MAX_CROSS_CAPTURE_GAP_MS + 1).toISOString() }, base);
  assert.equal(stale.available, false);
});
