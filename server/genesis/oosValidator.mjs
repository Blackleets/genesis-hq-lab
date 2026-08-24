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

// P4 warmup: the first W candles of every OOS segment carry indicators
// computed from the segment start (cold start) -> distorted metrics.
// W defaults to the longest lookback any strategy family can ask for,
// overridable via GENESIS_WARMUP_CANDLES (0 reproduces the old behavior).
function warmupCandles(params = {}) {
  const env = parseInt(process.env.GENESIS_WARMUP_CANDLES, 10);
  if (Number.isFinite(env) && env >= 0) return env;
  const lookbackKeys = ['donchianPeriod', 'slow', 'vwapLookback', 'volLookback', 'bbPeriod', 'rsiPeriod'];
  let w = 60; // covers fixed indicators (rsi14/atr14/adx14/bollinger warmup)
  for (const k of lookbackKeys) {
    const v = Number(params[k]);
    if (Number.isFinite(v) && v > w) w = Math.ceil(v);
  }
  return w;
}

const MIN_EVAL_CANDLES = 30;

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

  const warmup = warmupCandles(params);
  if (warmup > 0) console.log(`Warmup: discarding first ${warmup} candles of each OOS eval segment (train untouched).`);

  const results = [];
  for (const f of folds) {
    // P4: evaluate ONLY on the post-warmup tail of the OOS segment. The train
    // segment keeps its full length (warmup there is harmless and preserves
    // comparability with previous runs).
    const cut = Math.min(warmup, Math.max(0, f.test.length - MIN_EVAL_CANDLES));
    const evalSeg = f.test.slice(cut);
    if (evalSeg.length < MIN_EVAL_CANDLES) {
      console.log(`  Fold ${f.idx}: skipped — only ${evalSeg.length} eval candles left after ${cut}-candle warmup.`);
      continue;
    }
    const rTrain = fullReport(f.train, makeStrategy(kind, params));
    const rTest = fullReport(evalSeg, makeStrategy(kind, params));
    results.push({ fold: f.idx, train: rTrain, test: rTest, warmupCandles: cut });
    console.log(`  Fold ${f.idx}: TRAIN trades=${rTrain.metrics.trades} PF=${isFinite(rTrain.metrics.profitFactor) ? rTrain.metrics.profitFactor.toFixed(2) : 'inf'} | OOS trades=${rTest.metrics.trades} WR=${(rTest.metrics.winRate * 100).toFixed(1)}% PF=${isFinite(rTest.metrics.profitFactor) ? rTest.metrics.profitFactor.toFixed(2) : 'inf?'} EV%=${(rTest.metrics.expectancyPctPerTrade).toFixed(3)} t=${rTest.metrics.tstat.toFixed(2)} DD=${(rTest.metrics.maxDrawdown * 100).toFixed(1)}% GATES=${rTest.gates.passed}/${rTest.gates.total} ${rTest.gates.go ? 'GO' : ''}`);
  }

  if (!results.length) { console.log('All folds skipped by warmup — not enough eval candles.'); return { verdict: false, passRate: 0, allPositive: false, results: [] }; }

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
