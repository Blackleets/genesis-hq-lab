import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveFundingFeatures } from '../genesis/derivativesContext.mjs';

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
