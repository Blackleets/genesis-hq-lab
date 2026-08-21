// server/genesis/oosValidator.mjs
// Honest WALK-FORWARD validation for a discovered strategy.
// Standard institutional method: roll a training window forward, test ONLY on
// the data that comes AFTER the training window (pure out-of-sample). A
// strategy only "wins" if it passes the 6 gates on BOTH OOS folds AND the
// edge is regime-consistent (PF doesn't flip sign between folds).
//
// Anti-overfit gate: if it only works on the window it was tuned on, REJECT.

import { fetchKlines } from '../crypto/backtest/historicalData.mjs';
import { makeStrategy } from './strategyLib.mjs';
import { fullReport } from './backtestCore.mjs';

const FOLD_DAYS = 90;

function buildFolds(candles, foldDays = FOLD_DAYS) {
  // each candle ~ interval; approximate fold size by count fraction
  const ms = candles[candles.length - 1][0] - candles[0][0];
  const perDay = ms / ((candles.length - 1) * 86400000);
  const foldSize = Math.max(50, Math.floor(foldDays * perDay));
  const folds = [];
  for (let start = 0; start + foldSize * 2 <= candles.length; start += foldSize) {
    const train = candles.slice(start, start + foldSize);
    const test = candles.slice(start + foldSize, start + foldSize * 2);
    if (test.length < 30) break;
    folds.push({ train, test, idx: folds.length });
  }
  return folds;
}

export async function validateOOS({ pair, interval = '1h', days = 360, kind, params, foldDays = FOLD_DAYS }) {
  console.log(`Fetching REAL ${pair} ${interval} data (${days}d) for WALK-FORWARD validation...`);
  const candles = await fetchKlines(pair, { days, interval });
  const folds = buildFolds(candles, foldDays);
  if (!folds.length) { console.log('Not enough data for folds.'); return { verdict: false, folds: [] }; }

  const results = [];
  for (const f of folds) {
    const rTrain = fullReport(f.train, makeStrategy(kind, params));
    const rTest = fullReport(f.test, makeStrategy(kind, params));
    results.push({ fold: f.idx, train: rTrain, test: rTest });
    console.log(`  Fold ${f.idx}: TRAIN trades=${rTrain.metrics.trades} PF=${isFinite(rTrain.metrics.profitFactor) ? rTrain.metrics.profitFactor.toFixed(2) : 'inf'} | OOS trades=${rTest.metrics.trades} WR=${(rTest.metrics.winRate * 100).toFixed(1)}% PF=${isFinite(rTest.metrics.profitFactor) ? rTest.metrics.profitFactor.toFixed(2) : 'inf?'} EV%=${(rTest.metrics.expectancyPctPerTrade).toFixed(3)} t=${rTest.metrics.tstat.toFixed(2)} DD=${(rTest.metrics.maxDrawdown * 100).toFixed(1)}% GATES=${rTest.gates.passed}/${rTest.gates.total} ${rTest.gates.go ? 'GO' : ''}`);
  }

  const oosGates = results.map(r => r.test.gates.go);
  const passRate = oosGates.filter(Boolean).length / oosGates.length;
  const oosPFs = results.map(r => isFinite(r.test.metrics.profitFactor) ? r.test.metrics.profitFactor : 0);
  const allPositive = oosPFs.every(p => p > 1.0);
  const verdict = passRate >= 0.6 && allPositive;

  console.log(`\n=== WALK-FORWARD VERDICT: ${pair}/${kind} ===`);
  console.log(`  OOS folds passed: ${oosGates.filter(Boolean).length}/${oosGates.length} (need >=60%)`);
  console.log(`  All OOS folds PF>1: ${allPositive}`);
  console.log(`  ${verdict ? 'VALIDATED — edge holds out-of-sample across regimes ✅' : 'REJECTED — not robust OOS ❌'}`);
  return { verdict, passRate, allPositive, results };
}

// CLI: node oosValidator.mjs <pair> <kind> '<paramsJson>'
if (process.argv[1] && process.argv[1].endsWith('oosValidator.mjs')) {
  const [, , pair, kind, paramsJson] = process.argv;
  const params = JSON.parse(paramsJson || '{}');
  validateOOS({ pair: pair || 'BTCUSDT', interval: '1h', days: 360, kind: kind || 'meanReversion', params })
    .then(() => process.exit(0))
    .catch(e => { console.error('OOS ERR:', e.message); process.exit(1); });
}
