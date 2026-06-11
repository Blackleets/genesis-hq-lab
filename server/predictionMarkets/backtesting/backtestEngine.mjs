// backtestEngine.mjs — core prediction market backtest runner.
// Runs a named strategy against a market's replay ticks and computes metrics.
// Data mode is always clearly marked (FIXTURE_DATA / REAL_DATA / INSUFFICIENT_DATA).
//
// DISCLAIMER: Backtest results do not guarantee future performance.
// All results from fixture data are synthetic and for research only.

import { replayMarket, listFixtureMarkets, loadFixtures } from './replay.mjs';
import { runStrategy, getStrategyNames } from './strategyRunner.mjs';
import { computeMetrics } from './metrics.mjs';
import { logEvent, SEVERITY } from '../../observability/eventTimeline.mjs';

const DEFAULT_POSITION_SIZE = 10;  // USD per trade
const DEFAULT_FEE_PCT = 0.002;     // 0.2% per side
const DEFAULT_SLIPPAGE_PCT = 0.005; // 0.5% slippage estimate

/**
 * Run a full backtest.
 *
 * @param {object} opts
 * @param {string} opts.strategy - strategy name from strategyRunner
 * @param {string} [opts.source='fixture'] - 'fixture' only for now
 * @param {string} [opts.marketId] - specific market, or runs all if omitted
 * @param {number} [opts.positionSize]
 * @param {number} [opts.feePct]
 * @param {number} [opts.slippagePct]
 * @returns {object}
 */
export async function runBacktest({
  strategy,
  source = 'fixture',
  marketId,
  positionSize = DEFAULT_POSITION_SIZE,
  feePct = DEFAULT_FEE_PCT,
  slippagePct = DEFAULT_SLIPPAGE_PCT,
} = {}) {
  const startedAt = new Date().toISOString();

  logEvent(
    'PREDICTION', SEVERITY.INFO, 'backtestEngine',
    'PREDICTION_BACKTEST_STARTED',
    { strategy, source, marketId }
  );

  // Validate strategy
  const availableStrategies = getStrategyNames();
  if (!strategy) {
    return {
      ok: false,
      error: 'strategy_required',
      availableStrategies,
    };
  }
  if (!availableStrategies.includes(strategy)) {
    return {
      ok: false,
      error: `unknown_strategy: "${strategy}"`,
      availableStrategies,
    };
  }

  // Validate source (only fixture supported now)
  if (source !== 'fixture') {
    return {
      ok: false,
      error: 'INSUFFICIENT_DATA',
      message: `Source "${source}" is not supported. Only "fixture" data is available. Real historical data requires a data provider integration.`,
      dataMode: 'INSUFFICIENT_DATA',
    };
  }

  // Gather markets to backtest
  let marketsToTest;
  if (marketId) {
    const replay = replayMarket(marketId);
    if (!replay.ok) {
      return { ok: false, error: replay.error, dataMode: 'FIXTURE_DATA' };
    }
    marketsToTest = [replay];
  } else {
    const fixtures = loadFixtures();
    marketsToTest = fixtures.markets
      .map((m) => replayMarket(m.marketId))
      .filter((r) => r.ok);
  }

  if (marketsToTest.length === 0) {
    return { ok: false, error: 'INSUFFICIENT_DATA', message: 'No markets available for backtesting', dataMode: 'FIXTURE_DATA' };
  }

  // Run strategy + simulate trades per market
  const allTrades = [];
  const perMarketResults = [];

  for (const marketReplay of marketsToTest) {
    const signals = runStrategy(strategy, marketReplay.ticks);
    const resolution = marketReplay.resolution; // 'YES' or 'NO'

    // Simulate: enter on signal, exit at resolution
    const trades = [];
    for (const signal of signals) {
      if (!signal.side) continue;

      // Simulate outcome: if resolution matches signal.side → win
      const won = resolution === signal.side;
      const exitPrice = won ? 1.0 : 0.0;
      const fees = positionSize * feePct * 2;
      const slippage = positionSize * slippagePct;

      trades.push({
        marketId: marketReplay.marketId,
        side: signal.side,
        entryPrice: signal.entryPrice,
        exitPrice,
        size: positionSize,
        feePaid: fees,
        slippage,
        won,
        reason: signal.reason,
      });
    }

    if (trades.length > 0) {
      allTrades.push(...trades);
      const marketMetrics = computeMetrics(trades, { feePct, slippagePct });
      perMarketResults.push({
        marketId: marketReplay.marketId,
        title: marketReplay.title,
        category: marketReplay.category,
        resolution,
        tradeCount: trades.length,
        metrics: marketMetrics.ok ? marketMetrics.metrics : null,
        insufficientData: !marketMetrics.ok,
      });
    }
  }

  // Aggregate metrics across all markets
  const aggregate = computeMetrics(allTrades, { feePct, slippagePct });
  const completedAt = new Date().toISOString();

  logEvent(
    'PREDICTION', SEVERITY.INFO, 'backtestEngine',
    'PREDICTION_BACKTEST_COMPLETED',
    { strategy, source, totalTrades: allTrades.length, ok: aggregate.ok }
  );

  return {
    ok: true,
    dataMode: 'FIXTURE_DATA',
    disclaimer: 'Results are from synthetic fixture data only. This does NOT represent real market performance or guaranteed future returns. Fees and slippage are estimates.',
    strategy,
    source,
    startedAt,
    completedAt,
    config: { positionSize, feePct, slippagePct },
    summary: aggregate.ok ? aggregate.metrics : { error: aggregate.error },
    perMarketResults,
    totalMarketsBacktested: marketsToTest.length,
    totalTradesSimulated: allTrades.length,
  };
}

/**
 * List available backtest options.
 */
export function getBacktestOptions() {
  return {
    availableStrategies: getStrategyNames(),
    availableSources: ['fixture'],
    availableFixtureMarkets: listFixtureMarkets(),
    note: 'Real historical data source is not yet configured (INSUFFICIENT_DATA).',
  };
}
