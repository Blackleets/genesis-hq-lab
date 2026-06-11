// replay.mjs — replays market price history tick by tick for backtesting.
// Supports fixture data only (no historical data source configured yet).
// Returns INSUFFICIENT_DATA if the market has fewer than MIN_TICKS ticks.

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const MIN_TICKS = 3;

const _require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Load the bundled fixture data set.
 *
 * @returns {{ markets: object[], _meta: object }}
 */
export function loadFixtures() {
  const fixturePath = path.join(__dirname, 'fixtures', 'sample.json');
  return _require(fixturePath);
}

/**
 * Replay a single market's price history as an ordered tick array.
 *
 * @param {string} marketId - fixture market ID
 * @returns {{ ok: boolean, dataMode: string, ticks: object[], resolution: string|null, error?: string }}
 */
export function replayMarket(marketId) {
  const fixtures = loadFixtures();
  const market = fixtures.markets.find((m) => m.marketId === marketId);

  if (!market) {
    return {
      ok: false,
      dataMode: 'FIXTURE_DATA',
      error: `INSUFFICIENT_DATA: market "${marketId}" not found in fixtures`,
      ticks: [],
      resolution: null,
    };
  }

  const ticks = (market.priceHistory ?? [])
    .sort((a, b) => new Date(a.ts) - new Date(b.ts))
    .map((tick) => ({
      ts: tick.ts,
      yesPrice: Number(tick.yesPrice),
      noPrice: Number(tick.noPrice),
      volume24h: Number(tick.volume24h ?? 0),
      liquidity: Number(tick.liquidity ?? 0),
    }));

  if (ticks.length < MIN_TICKS) {
    return {
      ok: false,
      dataMode: 'FIXTURE_DATA',
      error: `INSUFFICIENT_DATA: market "${marketId}" has only ${ticks.length} ticks (min ${MIN_TICKS})`,
      ticks,
      resolution: market.resolution ?? null,
    };
  }

  return {
    ok: true,
    dataMode: 'FIXTURE_DATA',
    marketId: market.marketId,
    title: market.title,
    category: market.category,
    ticks,
    resolution: market.resolution ?? null,
    resolutionDate: market.resolutionDate ?? null,
  };
}

/**
 * List available fixture market IDs.
 */
export function listFixtureMarkets() {
  const fixtures = loadFixtures();
  return fixtures.markets.map((m) => ({
    marketId: m.marketId,
    title: m.title,
    category: m.category,
    tickCount: (m.priceHistory ?? []).length,
    resolution: m.resolution,
  }));
}
