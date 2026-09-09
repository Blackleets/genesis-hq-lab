import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveSpotPerpLeadLag } from '../genesis/spotPerpLeadLag.mjs';

function closesFromReturns(returns, start = 100) {
  const closes = [start];
  for (const ret of returns) closes.push(closes[closes.length - 1] * Math.exp(ret));
  return closes.map((close, index) => ({ time: index * 60_000, close }));
}

test('deriveSpotPerpLeadLag detects a one-bar spot lead without implying a trade', () => {
  const spotReturns = [
    0.001, -0.002, 0.003, 0.0015, -0.001,
    0.0025, -0.003, 0.004, -0.0025, 0.001,
    0.0035, -0.0015, 0.002, -0.002, 0.001,
    0.0022, -0.0018, 0.0032, -0.0027, 0.0013,
    0.0028, -0.0034, 0.0017, 0.0024,
  ];
  const perpReturns = [0, ...spotReturns.slice(0, -1)];
  const result = deriveSpotPerpLeadLag(
    closesFromReturns(spotReturns),
    closesFromReturns(perpReturns),
    { maxLagBars: 3, minAlignedPoints: 20 },
  );

  assert.equal(result.alignedPoints, spotReturns.length + 1);
  assert.equal(result.bestLagBars, 1);
  assert.equal(result.bestLagCorr, 1);
  assert.equal(result.leader, 'spot');
  assert.equal(typeof result.spreadNowBps, 'number');
  assert.equal(typeof result.latestReturnDivergenceBps, 'number');
});

test('deriveSpotPerpLeadLag is honest when synchronized history is insufficient', () => {
  const result = deriveSpotPerpLeadLag(
    [{ time: 0, close: 100 }, { time: 60_000, close: 101 }],
    [{ time: 0, close: 100 }, { time: 60_000, close: 101 }],
  );

  assert.deepEqual(result, {
    alignedPoints: 2,
    spreadNowBps: null,
    spreadAvgBps: null,
    spreadVolBps: null,
    returnCorr0: null,
    bestLagBars: null,
    bestLagCorr: null,
    leader: 'unknown',
    latestReturnDivergenceBps: null,
  });
});

test('deriveSpotPerpLeadLag aligns by timestamp instead of array position', () => {
  const spot = Array.from({ length: 25 }, (_, index) => ({
    time: index * 60_000,
    close: 100 + index,
  }));
  const perp = Array.from({ length: 25 }, (_, index) => ({
    time: (index + 5) * 60_000,
    close: 100 + index,
  }));

  const result = deriveSpotPerpLeadLag(spot, perp, { minAlignedPoints: 20 });
  assert.equal(result.alignedPoints, 20);
});
