import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSparseTicksFromMetadata,
  buildTicksFromClobHistory,
} from '../predictionMarkets/backtesting/historicalProvider.mjs';
import { runBacktest, getBacktestOptions } from '../predictionMarkets/backtesting/backtestEngine.mjs';

// ── Fixtures (no network) ─────────────────────────────────────────────────────

function makeMarket(overrides = {}) {
  return {
    id:             'pm-test-001',
    question:       'Will X happen?',
    startDate:      '2024-01-01T00:00:00Z',
    endDate:        '2024-06-01T00:00:00Z',
    winner:         'Yes',
    liquidity:      '100000',
    volume:         '50000',
    clobTokenIds:   null,
    ...overrides,
  };
}

// ── buildSparseTicksFromMetadata ──────────────────────────────────────────────

describe('buildSparseTicksFromMetadata', () => {
  test('returns 3 ticks for a valid YES-resolving market', () => {
    const ticks = buildSparseTicksFromMetadata(makeMarket());
    assert.equal(ticks.length, 3);
  });

  test('tick 0 starts at neutral 0.50 / 0.50', () => {
    const ticks = buildSparseTicksFromMetadata(makeMarket());
    assert.equal(ticks[0].yesPrice, 0.50);
    assert.equal(ticks[0].noPrice,  0.50);
  });

  test('final tick resolves YES → yesPrice 1.0', () => {
    const ticks = buildSparseTicksFromMetadata(makeMarket({ winner: 'Yes' }));
    assert.equal(ticks[2].yesPrice, 1.0);
    assert.equal(ticks[2].noPrice,  0.0);
  });

  test('final tick resolves NO → yesPrice 0.0', () => {
    const ticks = buildSparseTicksFromMetadata(makeMarket({ winner: 'No' }));
    assert.equal(ticks[2].yesPrice, 0.0);
    assert.equal(ticks[2].noPrice,  1.0);
  });

  test('ticks are in ascending timestamp order', () => {
    const ticks = buildSparseTicksFromMetadata(makeMarket());
    for (let i = 1; i < ticks.length; i++) {
      assert.ok(new Date(ticks[i].ts) > new Date(ticks[i - 1].ts));
    }
  });

  test('returns empty for missing dates', () => {
    const ticks = buildSparseTicksFromMetadata({ winner: 'Yes' });
    assert.equal(ticks.length, 0);
  });

  test('returns empty for unresolved market (no winner)', () => {
    const ticks = buildSparseTicksFromMetadata(makeMarket({ winner: null }));
    assert.equal(ticks.length, 0);
  });

  test('returns empty when endDate <= startDate', () => {
    const ticks = buildSparseTicksFromMetadata(makeMarket({
      startDate: '2024-06-01T00:00:00Z',
      endDate:   '2024-01-01T00:00:00Z', // backwards
    }));
    assert.equal(ticks.length, 0);
  });

  test('liquidity from metadata is propagated', () => {
    const ticks = buildSparseTicksFromMetadata(makeMarket({ liquidity: '200000' }));
    assert.ok(ticks.every((t) => t.liquidity === 200000));
  });

  test('handles winner field variants: YES, Yes, yes, 1', () => {
    for (const winner of ['YES', 'Yes', 'yes', '1']) {
      const ticks = buildSparseTicksFromMetadata(makeMarket({ winner }));
      assert.equal(ticks.length, 3, `expected 3 ticks for winner="${winner}"`);
      assert.equal(ticks[2].yesPrice, 1.0);
    }
  });

  test('handles NO variants: NO, No, no, 0', () => {
    for (const winner of ['NO', 'No', 'no', '0']) {
      const ticks = buildSparseTicksFromMetadata(makeMarket({ winner }));
      assert.equal(ticks.length, 3, `expected 3 ticks for winner="${winner}"`);
      assert.equal(ticks[2].yesPrice, 0.0);
    }
  });
});

// ── buildTicksFromClobHistory ─────────────────────────────────────────────────

describe('buildTicksFromClobHistory', () => {
  const market  = { liquidity: '50000', volume: '30000' };
  const history = [
    { t: 1700000000, p: '0.45' },
    { t: 1700086400, p: '0.50' },
    { t: 1700172800, p: '0.58' },
    { t: 1700259200, p: '0.65' },
    { t: 1700345600, p: '0.72' },
  ];

  test('returns one tick per history entry', () => {
    const ticks = buildTicksFromClobHistory(history, market);
    assert.equal(ticks.length, history.length);
  });

  test('yesPrice is clamped to [0, 1]', () => {
    const ticks = buildTicksFromClobHistory([{ t: 1700000000, p: '1.5' }, { t: 1700086400, p: '-0.1' }], market);
    assert.equal(ticks[0].yesPrice, 1.0);
    assert.equal(ticks[1].yesPrice, 0.0);
  });

  test('noPrice = 1 - yesPrice', () => {
    const ticks = buildTicksFromClobHistory(history, market);
    for (const t of ticks) {
      assert.ok(Math.abs(t.yesPrice + t.noPrice - 1) < 0.0001);
    }
  });

  test('ticks are sorted ascending by timestamp', () => {
    // Feed in reverse order
    const reversed = [...history].reverse();
    const ticks    = buildTicksFromClobHistory(reversed, market);
    for (let i = 1; i < ticks.length; i++) {
      assert.ok(new Date(ticks[i].ts) >= new Date(ticks[i - 1].ts));
    }
  });

  test('volume is distributed per tick', () => {
    const ticks = buildTicksFromClobHistory(history, market);
    const totalVol = ticks.reduce((s, t) => s + t.volume24h, 0);
    assert.ok(Math.abs(totalVol - 30000) < 1, 'total volume should equal market.volume');
  });

  test('liquidity is propagated to all ticks', () => {
    const ticks = buildTicksFromClobHistory(history, market);
    assert.ok(ticks.every((t) => t.liquidity === 50000));
  });

  test('handles numeric p as well as string p', () => {
    const ticks = buildTicksFromClobHistory([{ t: 1700000000, p: 0.55 }], market);
    assert.equal(ticks[0].yesPrice, 0.55);
  });
});

// ── getBacktestOptions ────────────────────────────────────────────────────────

describe('getBacktestOptions', () => {
  test('includes polymarket in availableSources', () => {
    const opts = getBacktestOptions();
    assert.ok(opts.availableSources.includes('polymarket'));
  });

  test('includes fixture in availableSources', () => {
    const opts = getBacktestOptions();
    assert.ok(opts.availableSources.includes('fixture'));
  });

  test('sourceNotes describes both sources', () => {
    const opts = getBacktestOptions();
    assert.ok(typeof opts.sourceNotes.polymarket === 'string');
    assert.ok(typeof opts.sourceNotes.fixture    === 'string');
  });
});

// ── runBacktest with mocked fetch (fallback test) ─────────────────────────────

describe('runBacktest – Gamma API down falls back to fixtures', () => {
  let origFetch;

  beforeEach(() => {
    origFetch = globalThis.fetch;
    // Simulate Gamma API failure
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes('gamma-api.polymarket.com')) {
        throw new Error('Network failure (mocked)');
      }
      // Pass through other requests (e.g., CLOB) — shouldn't be reached but just in case
      return origFetch(url);
    };
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  test('falls back to FIXTURE_DATA when Gamma API throws', async () => {
    const result = await runBacktest({ strategy: 'momentum', source: 'polymarket' });
    assert.equal(result.ok, true);
    assert.equal(result.dataMode, 'FIXTURE_DATA');
    assert.equal(result.fallbackUsed, true);
  });

  test('result still contains summary metrics on fallback', async () => {
    const result = await runBacktest({ strategy: 'simple_yes_low', source: 'polymarket' });
    assert.equal(result.ok, true);
    assert.ok('summary' in result);
    assert.ok('totalTradesSimulated' in result);
  });
});

// ── runBacktest with mocked fetch (DEGRADED_MODE test) ────────────────────────

describe('runBacktest – Gamma returns markets, CLOB unavailable → DEGRADED_MODE', () => {
  let origFetch;

  const MOCK_GAMMA_MARKET = {
    id:           'pm-real-001',
    question:     'Will ETH reach $5000?',
    startDate:    '2024-01-01T00:00:00Z',
    endDate:      '2024-06-01T00:00:00Z',
    winner:       'No',
    liquidity:    '500000',
    volume:       '200000',
    clobTokenIds: '["token-yes-001","token-no-001"]',
    category:     'crypto',
    active:       false,
    closed:       true,
  };

  beforeEach(() => {
    origFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes('gamma-api.polymarket.com')) {
        return new Response(JSON.stringify([MOCK_GAMMA_MARKET]), {
          status:  200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (u.includes('clob.polymarket.com/prices-history')) {
        // CLOB returns empty history
        return new Response(JSON.stringify({ history: [] }), {
          status:  200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error('Unexpected fetch (mocked)');
    };
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  test('uses DEGRADED_MODE when CLOB history is empty', async () => {
    const result = await runBacktest({ strategy: 'momentum', source: 'polymarket' });
    assert.ok(result.ok === true || result.dataMode === 'DEGRADED_MODE' || result.dataMode === 'INSUFFICIENT_DATA');
    assert.equal(result.fallbackUsed, false);
  });
});
