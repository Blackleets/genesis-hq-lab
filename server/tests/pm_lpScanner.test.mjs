import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { rankBySpread, findWideSpreadMarkets } from '../predictionMarkets/liquidity/spreadScanner.mjs';

function makeMarket(overrides = {}) {
  return {
    source: 'polymarket',
    marketId: `mkt-${Math.random().toString(36).slice(2)}`,
    slug: 'test',
    title: 'Test market',
    outcome: 'YES',
    yesPrice: 0.5,
    noPrice: 0.5,
    spread: 0.04,
    volume24h: 10000,
    liquidity: 80000,
    endDate: null,
    status: 'active',
    category: 'general',
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('rankBySpread', () => {
  test('returns empty for empty input', () => {
    assert.deepEqual(rankBySpread([]), []);
  });

  test('filters out closed markets', () => {
    const markets = [makeMarket({ status: 'closed', spread: 0.15 }), makeMarket({ spread: 0.05 })];
    const result = rankBySpread(markets);
    assert.equal(result.length, 1);
    assert.equal(result[0].status, 'active');
  });

  test('filters out markets with null spread', () => {
    const markets = [makeMarket({ spread: null }), makeMarket({ spread: 0.05 })];
    const result = rankBySpread(markets);
    assert.equal(result.length, 1);
  });

  test('sorts by spread descending', () => {
    const markets = [makeMarket({ spread: 0.03 }), makeMarket({ spread: 0.10 }), makeMarket({ spread: 0.07 })];
    const result = rankBySpread(markets);
    assert.ok(result[0].spread >= result[1].spread);
    assert.ok(result[1].spread >= result[2].spread);
  });

  test('adds _spreadPct annotation', () => {
    const markets = [makeMarket({ spread: 0.05 })];
    const result = rankBySpread(markets);
    assert.ok(result[0]._spreadPct?.endsWith('%'));
  });

  test('filters by minLiquidity', () => {
    const markets = [
      makeMarket({ spread: 0.10, liquidity: 1000 }),
      makeMarket({ spread: 0.08, liquidity: 100000 }),
    ];
    const result = rankBySpread(markets, { minLiquidity: 50000 });
    assert.equal(result.length, 1);
    assert.equal(result[0].liquidity, 100000);
  });
});

describe('findWideSpreadMarkets', () => {
  test('returns only markets above threshold', () => {
    const markets = [
      makeMarket({ spread: 0.03 }),
      makeMarket({ spread: 0.08 }),
      makeMarket({ spread: 0.15 }),
    ];
    const result = findWideSpreadMarkets(markets, 0.06);
    assert.equal(result.length, 2);
    assert.ok(result.every((m) => (m.spread ?? 0) > 0.06));
  });

  test('returns empty when no markets meet threshold', () => {
    const markets = [makeMarket({ spread: 0.02 }), makeMarket({ spread: 0.03 })];
    const result = findWideSpreadMarkets(markets, 0.10);
    assert.deepEqual(result, []);
  });
});
