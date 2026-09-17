import test from 'node:test';
import assert from 'node:assert/strict';
import {
  impermanentLossBps,
  scoreLiquiditySnapshot,
  forwardLiquidityWindow,
  shouldScoreLiquidityForwardWindow,
  buildLiquiditySleeve,
  solanaOperationCostBps,
} from '../../src/core/solanaLiquidityEconomics.mjs';

test('impermanent loss is zero when price does not move', () => {
  assert.ok(Math.abs(impermanentLossBps(1)) < 1e-12);
});

test('high fees can pass research screen but do not imply paper eligibility', () => {
  const scored = scoreLiquiditySnapshot({
    venue: 'TEST', poolAddress: 'pool', symbol: 'SOL',
    tvlUsd: 1_000_000, fees24hUsd: 5_000, volume24hUsd: 5_000_000,
    priceUsd: 200, priceChange24hPct: 1, officialSource: true,
  });
  assert.equal(scored.screenPass, true);
  const sleeve = buildLiquiditySleeve([], { officialObservationRatio: 1 });
  assert.equal(sleeve.paperCapitalEligible, false);
  assert.equal(sleeve.samples, 0);
});

test('volatile low-fee pool is rejected by stress economics', () => {
  const scored = scoreLiquiditySnapshot({
    venue: 'TEST', poolAddress: 'pool', symbol: 'WIF',
    tvlUsd: 1_000_000, fees24hUsd: 50, volume24hUsd: 5_000_000,
    priceUsd: 2, priceChange24hPct: 18, officialSource: true,
  });
  assert.equal(scored.screenPass, false);
  assert.ok(scored.expectedNetStressBps < 0);
});

test('forward window charges IL and out-of-range rebalance reserve', () => {
  const prev = {
    venue: 'TEST', poolAddress: 'pool', symbol: 'SOL',
    observedAt: '2026-09-17T00:00:00Z',
    priceUsd: 100, dailyFeeYieldBps: 20, officialSource: true,
  };
  const curr = {
    venue: 'TEST', poolAddress: 'pool', symbol: 'SOL',
    observedAt: '2026-09-17T01:00:00Z',
    priceUsd: 108, officialSource: true,
  };
  const w = forwardLiquidityWindow(prev, curr, 1);
  assert.equal(w.outOfRange, true);
  assert.ok(w.ilBps > 0);
  assert.ok(w.rebalanceBps > 0);
});

test('paper eligibility needs a statistically adequate forward sample', () => {
  const windows = Array.from({ length: 60 }, (_, i) => ({
    netBps: i % 5 === 0 ? -0.4 : 1.2,
    officialSource: true,
  }));
  const sleeve = buildLiquiditySleeve(windows, { officialObservationRatio: 1 });
  assert.equal(sleeve.samples, 60);
  assert.equal(sleeve.paperCapitalEligible, true);
  assert.equal(sleeve.liveEligible, false);
});


test('forward evidence counts deterioration after an eligible entry and blocks cherry-picked re-entry', () => {
  const entered = {
    screenPass: true,
    officialSource: true,
    priceUsd: 100,
    dailyFeeYieldBps: 12,
    observedAt: '2026-09-17T00:00:00Z',
  };
  const deteriorated = {
    screenPass: false,
    officialSource: true,
    priceUsd: 92,
    observedAt: '2026-09-17T01:00:00Z',
  };
  assert.equal(shouldScoreLiquidityForwardWindow(entered, deteriorated), true);

  const wasNeverEligible = { ...entered, screenPass: false };
  assert.equal(shouldScoreLiquidityForwardWindow(wasNeverEligible, deteriorated), false);

  const window = forwardLiquidityWindow(entered, deteriorated, 1);
  assert.ok(window);
  assert.ok(window.netBps < 0);
});


test('generic relative pair price supports correlated LP economics without pretending it is USD', () => {
  const scored = scoreLiquiditySnapshot({
    venue: 'RAYDIUM_CLMM',
    poolAddress: 'correlated',
    symbol: 'mSOL',
    pair: 'mSOL/SOL',
    tvlUsd: 2_000_000,
    fees24hUsd: 1_200,
    volume24hUsd: 1_500_000,
    price: 1.18,
    priceChange24hPct: 0.25,
    officialSource: true,
  });
  assert.equal(scored.checks.price, true);
  assert.equal(scored.price, 1.18);
  assert.ok(scored.ilStressBps >= 0);
});


test('fixed Solana operation cost scales down in bps as LP notional grows', () => {
  const small = solanaOperationCostBps({
    baseFeeLamports: 5_000,
    priorityFeeLamports: 5_000,
    solUsd: 100,
    txCount: 4,
    notionalUsd: 100,
  });
  const large = solanaOperationCostBps({
    baseFeeLamports: 5_000,
    priorityFeeLamports: 5_000,
    solUsd: 100,
    txCount: 4,
    notionalUsd: 1_000,
  });
  assert.ok(small.bps > large.bps);
  assert.ok(Math.abs(small.totalUsd - large.totalUsd) < 1e-12);
});
