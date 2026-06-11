// backtestEngine.mjs — core prediction market backtest runner.
// Runs a named strategy against a market's tick history and computes metrics.
//
// Sources:
//   'polymarket' — real resolved markets from Gamma API + CLOB price history.
//                  Falls back to fixtures if Gamma API is unreachable.
//   'fixture'    — bundled synthetic data; always available.
//
// dataMode in result:
//   REAL_DATA     — ticks from CLOB price history (real price series)
//   DEGRADED_MODE — ticks from Gamma metadata only (sparse, estimated prices)
//   FIXTURE_DATA  — synthetic fixture data
//   INSUFFICIENT_DATA — not enough trades to compute metrics

import { replayMarket, listFixtureMarkets, loadFixtures } from './replay.mjs';
import { loadHistoricalMarkets } from './historicalProvider.mjs';
import { runStrategy, getStrategyNames } from './strategyRunner.mjs';
import { computeMetrics } from './metrics.mjs';
import { logEvent, SEVERITY } from '../../observability/eventTimeline.mjs';

const DEFAULT_POSITION_SIZE  = 10;    // USD per trade
const DEFAULT_FEE_PCT        = 0.002; // 0.2% per side
const DEFAULT_SLIPPAGE_PCT   = 0.005; // 0.5% slippage estimate

// ── Market gathering ──────────────────────────────────────────────────────────

/**
 * Gather markets to backtest from the requested source.
 * On 'polymarket', falls back to 'fixture' if the API is unavailable.
 *
 * @returns {{ markets, dataMode, fallback }}
 */
async function gatherMarkets({ source, marketId }) {
  if (source === 'polymarket') {
    const historical = await loadHistoricalMarkets({ limit: 50, enrichLimit: 10 });

    if (historical.ok && historical.markets.length > 0) {
      const pool = marketId
        ? historical.markets.filter((m) => m.marketId === marketId)
        : historical.markets;

      if (pool.length === 0 && marketId) {
        return {
          markets:  [],
          dataMode: 'INSUFFICIENT_DATA',
          error:    `Market "${marketId}" not found in Polymarket historical data`,
          fallback: false,
        };
      }

      return {
        markets:       pool,
        dataMode:      historical.dataMode,
        realDataCount: historical.realDataCount,
        degradedCount: historical.degradedCount,
        fallback:      false,
      };
    }

    // API unavailable — fall back to fixtures
    logEvent('PREDICTION', SEVERITY.WARNING, 'backtestEngine',
      'PREDICTION_BACKTEST_FALLBACK_TO_FIXTURES', {
        reason: historical.error ?? 'No historical markets available from Gamma API',
      });
    // falls through to fixture logic below
  }

  // Fixture path (default + polymarket-API-down fallback)
  if (marketId) {
    const replay = replayMarket(marketId);
    if (!replay.ok) return { markets: [], dataMode: 'FIXTURE_DATA', error: replay.error, fallback: true };
    return { markets: [replay], dataMode: 'FIXTURE_DATA', fallback: source === 'polymarket' };
  }

  const fixtures     = loadFixtures();
  const fixtureMarkets = fixtures.markets
    .map((m) => replayMarket(m.marketId))
    .filter((r) => r.ok);
  return { markets: fixtureMarkets, dataMode: 'FIXTURE_DATA', fallback: source === 'polymarket' };
}

// ── Main backtest runner ──────────────────────────────────────────────────────

/**
 * Run a full backtest.
 *
 * @param {object} opts
 * @param {string} opts.strategy       - strategy name from strategyRunner
 * @param {string} [opts.source]       - 'polymarket' (real/degraded data) or 'fixture' (synthetic)
 * @param {string} [opts.marketId]     - specific market; omit to run all
 * @param {number} [opts.positionSize]
 * @param {number} [opts.feePct]
 * @param {number} [opts.slippagePct]
 * @returns {Promise<object>}
 */
export async function runBacktest({
  strategy,
  source = 'fixture',
  marketId,
  positionSize = DEFAULT_POSITION_SIZE,
  feePct       = DEFAULT_FEE_PCT,
  slippagePct  = DEFAULT_SLIPPAGE_PCT,
} = {}) {
  const startedAt = new Date().toISOString();

  logEvent('PREDICTION', SEVERITY.INFO, 'backtestEngine', 'PREDICTION_BACKTEST_STARTED', {
    strategy, source, marketId,
  });

  // Validate strategy
  const availableStrategies = getStrategyNames();
  if (!strategy) {
    return { ok: false, error: 'strategy_required', availableStrategies };
  }
  if (!availableStrategies.includes(strategy)) {
    return { ok: false, error: `unknown_strategy: "${strategy}"`, availableStrategies };
  }

  // Validate source
  const validSources = ['fixture', 'polymarket'];
  if (!validSources.includes(source)) {
    return {
      ok:      false,
      error:   `unknown_source: "${source}"`,
      validSources,
      dataMode: 'INSUFFICIENT_DATA',
    };
  }

  // Gather markets
  const gathered = await gatherMarkets({ source, marketId });

  if (gathered.error && gathered.markets.length === 0) {
    return { ok: false, error: gathered.error, dataMode: gathered.dataMode };
  }
  if (gathered.markets.length === 0) {
    return { ok: false, error: 'INSUFFICIENT_DATA', message: 'No markets available for backtesting', dataMode: 'FIXTURE_DATA' };
  }

  // Run strategy + simulate trades per market
  const allTrades        = [];
  const perMarketResults = [];
  let marketDataMode     = gathered.dataMode;

  for (const mkt of gathered.markets) {
    const signals    = runStrategy(strategy, mkt.ticks);
    const resolution = mkt.resolution;

    const trades = [];
    for (const signal of signals) {
      if (!signal.side) continue;
      const won      = resolution === signal.side;
      const exitPrice = won ? 1.0 : 0.0;
      trades.push({
        marketId:   mkt.marketId,
        side:       signal.side,
        entryPrice: signal.entryPrice,
        exitPrice,
        size:       positionSize,
        feePaid:    positionSize * feePct * 2,
        slippage:   positionSize * slippagePct,
        won,
        reason:     signal.reason,
      });
    }

    if (trades.length > 0) {
      allTrades.push(...trades);
      const mktMetrics = computeMetrics(trades, { feePct, slippagePct });
      perMarketResults.push({
        marketId:        mkt.marketId,
        title:           mkt.title,
        category:        mkt.category,
        resolution,
        dataMode:        mkt.dataMode ?? gathered.dataMode,
        tradeCount:      trades.length,
        metrics:         mktMetrics.ok ? mktMetrics.metrics : null,
        insufficientData: !mktMetrics.ok,
      });
    }
  }

  // Aggregate metrics across all markets
  const aggregate  = computeMetrics(allTrades, { feePct, slippagePct });
  const completedAt = new Date().toISOString();

  logEvent('PREDICTION', SEVERITY.INFO, 'backtestEngine', 'PREDICTION_BACKTEST_COMPLETED', {
    strategy, source, totalTrades: allTrades.length, ok: aggregate.ok,
    dataMode: marketDataMode, fallback: gathered.fallback ?? false,
  });

  // Build disclaimer appropriate for data mode
  const disclaimer = buildDisclaimer(marketDataMode, gathered);

  return {
    ok:                   true,
    dataMode:             marketDataMode,
    disclaimer,
    strategy,
    source:               gathered.fallback ? 'fixture (fallback)' : source,
    fallbackUsed:         gathered.fallback ?? false,
    startedAt,
    completedAt,
    config:               { positionSize, feePct, slippagePct },
    summary:              aggregate.ok ? aggregate.metrics : { error: aggregate.error },
    perMarketResults,
    totalMarketsBacktested: gathered.markets.length,
    totalTradesSimulated: allTrades.length,
    ...(gathered.realDataCount != null && { realDataMarkets:   gathered.realDataCount }),
    ...(gathered.degradedCount != null && { degradedMarkets:   gathered.degradedCount }),
  };
}

function buildDisclaimer(dataMode, gathered) {
  if (dataMode === 'REAL_DATA') {
    const d = gathered.degradedCount ?? 0;
    const suffix = d > 0
      ? ` ${d} market(s) used sparse metadata (DEGRADED_MODE) due to missing CLOB history.`
      : '';
    return `Results from real Polymarket historical data (CLOB price history).${suffix} Past performance does not guarantee future results. Fees and slippage are estimates.`;
  }
  if (dataMode === 'DEGRADED_MODE') {
    return 'Results from real Polymarket market metadata with estimated price series (start: 0.50, end: resolution). Intermediate prices are not available — strategies with few ticks may generate limited signals. Past performance does not guarantee future results.';
  }
  const fallbackNote = gathered.fallback ? ' Gamma API was unavailable; fixture data used as fallback.' : '';
  return `Results from synthetic fixture data only.${fallbackNote} This does NOT represent real market performance. Fees and slippage are estimates.`;
}

// ── Options ───────────────────────────────────────────────────────────────────

/**
 * List available backtest options (strategies, sources, fixture markets).
 */
export function getBacktestOptions() {
  return {
    availableStrategies:   getStrategyNames(),
    availableSources:      ['fixture', 'polymarket'],
    availableFixtureMarkets: listFixtureMarkets(),
    sourceNotes: {
      fixture:    'Synthetic data; always available.',
      polymarket: 'Real resolved markets from Polymarket Gamma API + CLOB price history. Falls back to fixtures if unreachable.',
    },
  };
}
