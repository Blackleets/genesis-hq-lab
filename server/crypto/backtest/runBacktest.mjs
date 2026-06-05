#!/usr/bin/env node
// runBacktest.mjs — CLI: validate the crypto strategy on real historical data.
//
//   npm run backtest                  # last 30 days, all configured assets
//   npm run backtest -- --days=60
//   npm run backtest -- --pair=BTCUSDT --days=14
//
// Prints per-asset and aggregate metrics, plus a zero-cost baseline so the
// impact of fees + slippage (the realism fix) is visible.

import { getAssets } from '../priceFeeder.mjs';
import { getParams } from '../strategyParams.mjs';
import { fetchKlines } from './historicalData.mjs';
import { runBacktest } from './backtestEngine.mjs';
import { computeMetrics } from './metrics.mjs';

function arg(name, def) {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : def;
}

function fmtPct(x) { return `${(x * 100).toFixed(2)}%`; }
function fmtUsd(x) { return `$${x.toFixed(2)}`; }

function printMetrics(label, m) {
  console.log(
    `  ${label.padEnd(10)} trades=${String(m.trades).padStart(4)} ` +
    `win=${fmtPct(m.winRate).padStart(7)} ` +
    `net=${fmtUsd(m.netPnl).padStart(11)} ` +
    `roi=${fmtPct(m.roi).padStart(8)} ` +
    `PF=${(m.profitFactor ?? Infinity).toFixed(2).padStart(6)} ` +
    `maxDD=${fmtPct(m.maxDrawdown).padStart(7)} ` +
    `exp=${fmtUsd(m.expectancy).padStart(8)}`
  );
}

async function main() {
  const days = parseInt(arg('days', '30'), 10);
  const pairArg = arg('pair', null);
  const params = getParams();
  const assets = pairArg ? [{ symbol: pairArg, pair: pairArg }] : getAssets();

  console.log(`\n═══ Crypto backtest — ${days}d — params: target ${fmtPct(params.targetPct)} / stop ${fmtPct(params.stopPct)} / timeout ${params.timeoutHours}h ═══\n`);

  const allTrades = [];
  const allTradesNoCost = [];

  for (const { symbol, pair } of assets) {
    try {
      process.stdout.write(`Fetching ${pair} (${days}d)… `);
      const klines = await fetchKlines(pair, { days, interval: '1m' });
      console.log(`${klines.length} candles`);

      const { trades, metrics } = runBacktest(klines, params, {});
      const baseline = runBacktest(klines, params, { feePct: 0 }); // zero-cost reference

      console.log(`${symbol}:`);
      printMetrics('net', metrics);
      printMetrics('zero-cost', baseline.metrics);

      allTrades.push(...trades);
      allTradesNoCost.push(...baseline.trades);
    } catch (err) {
      console.warn(`  ${symbol}: ERROR ${err.message}`);
    }
  }

  console.log(`\n─── AGGREGATE (${assets.length} assets) ───`);
  printMetrics('net', computeMetrics(allTrades, {}));
  printMetrics('zero-cost', computeMetrics(allTradesNoCost, {}));

  const net = computeMetrics(allTrades, {}).netPnl;
  const gross = computeMetrics(allTradesNoCost, {}).netPnl;
  console.log(`\nCost drag (fees+slippage): ${fmtUsd(gross - net)} — net ${net >= 0 ? 'PROFITABLE' : 'UNPROFITABLE'} at current params.`);
  if (net < 0) console.log('→ Run the optimizer to search for params with positive out-of-sample expectancy: npm run optimizer -- --once');
  console.log('');
}

main().catch(err => { console.error(err); process.exit(1); });
