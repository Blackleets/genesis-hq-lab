import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveFundingFeatures, derivePositioningDynamics } from '../genesis/derivativesContext.mjs';

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
