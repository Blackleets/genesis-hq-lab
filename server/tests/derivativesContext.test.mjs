import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveFundingFeatures,
  derivePositioningDynamics,
  derivePremiumFeatures,
} from '../genesis/derivativesContext.mjs';

test('deriveFundingFeatures keeps funding descriptive and deterministic', () => {
  const out = deriveFundingFeatures([
    { rate: 0.00012 },
    { rate: 0.00014 },
    { rate: 0.00010 },
  ]);

  assert.deepEqual(out, {
    fundingRateNow: 0.0001,
    fundingAvg: 0.00012,
    fundingAbsAvg: 0.00012,
    fundingPositiveShare: 1,
    fundingCumulative: 0.00036,
    fundingCrowd: 'long_payers',
  });
});

test('deriveFundingFeatures distinguishes negative payer pressure', () => {
  const out = deriveFundingFeatures([
    { rate: -0.00015 },
    { rate: -0.00011 },
    { rate: -0.00013 },
  ]);

  assert.equal(out.fundingCrowd, 'short_payers');
  assert.equal(out.fundingPositiveShare, 0);
  assert.equal(out.fundingAvg, -0.00013);
});

test('deriveFundingFeatures is honest on missing observations', () => {
  assert.deepEqual(deriveFundingFeatures([]), {
    fundingRateNow: null,
    fundingAvg: null,
    fundingAbsAvg: null,
    fundingPositiveShare: null,
    fundingCumulative: null,
    fundingCrowd: 'unknown',
  });
});

test('derivePremiumFeatures preserves persistent negative basis and recent impulse', () => {
  const out = derivePremiumFeatures([
    { close: -0.00010 },
    { close: -0.00020 },
    { close: -0.00030 },
    { close: -0.00040 },
    { close: -0.00050 },
    { close: -0.00060 },
  ]);

  assert.deepEqual(out, {
    premiumNowBps: -6,
    premiumAvgBps: -3.5,
    premiumRecentAvgBps: -5,
    premiumImpulseBps: -3,
    premiumPositiveShare: 0,
  });
});

test('derivePremiumFeatures does not fabricate basis from missing observations', () => {
  assert.deepEqual(derivePremiumFeatures([]), {
    premiumNowBps: null,
    premiumAvgBps: null,
    premiumRecentAvgBps: null,
    premiumImpulseBps: null,
    premiumPositiveShare: null,
  });
});

test('derivePositioningDynamics preserves recent OI acceleration and taker reversal', () => {
  const oi = [100, 102, 104, 106, 108, 110, 112, 115, 118, 120, 123, 126]
    .map((oiUsd, index) => ({ time: index, oiUsd }));
  const taker = [1.2, 1.1, 1.15, 0.9, 0.85, 0.8]
    .map((buySellRatio, index) => ({ time: index, buySellRatio }));

  assert.deepEqual(derivePositioningDynamics(oi, taker), {
    oiChangePct: 26,
    oiRecentChangePct: 12.5,
    oiAccelerationPct: 2.5,
    takerBias: 1,
    takerRecentBias: 0.85,
    takerImpulse: -0.3,
    takerPressure: 'sell_pressure',
    takerReversal: true,
  });
});

test('derivePositioningDynamics does not fabricate dynamics from missing data', () => {
  assert.deepEqual(derivePositioningDynamics([], []), {
    oiChangePct: null,
    oiRecentChangePct: null,
    oiAccelerationPct: null,
    takerBias: null,
    takerRecentBias: null,
    takerImpulse: null,
    takerPressure: 'unknown',
    takerReversal: false,
  });
});
