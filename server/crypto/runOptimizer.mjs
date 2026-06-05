#!/usr/bin/env node
// runOptimizer.mjs — the 24/7 "training" process. Continuously searches the
// parameter space via walk-forward backtests and adopts a new config ONLY when
// it beats the current one out-of-sample with positive expectancy (anti-overfit).
//
//   npm run optimizer -- --once         # single pass
//   npm run optimizer                   # continuous (every OPTIMIZER_INTERVAL_MIN)
//   npm run optimizer -- --days=60 --once

import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAssets } from './priceFeeder.mjs';
import { getParams, saveParams, DEFAULTS } from './strategyParams.mjs';
import { fetchKlines } from './backtest/historicalData.mjs';
import { runBacktest } from './backtest/backtestEngine.mjs';
import { computeMetrics } from './backtest/metrics.mjs';
import { coordinateDescent, shouldAdopt } from './optimizer.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const RUNS_LOG = join(__dir, '..', '..', 'data', 'strategy', 'optimizer_runs.json');
const HEARTBEAT = join(__dir, '..', '..', 'data', 'strategy', 'optimizer_heartbeat.json');

const ONCE = process.argv.includes('--once');
const arg = (n, d) => { const h = process.argv.find(a => a.startsWith(`--${n}=`)); return h ? h.split('=')[1] : d; };
const DAYS = parseInt(process.env.OPTIMIZER_DAYS ?? arg('days', '45'), 10);
const INTERVAL_MIN = parseInt(process.env.OPTIMIZER_INTERVAL_MIN ?? arg('interval', '45'), 10);
const MIN_TRADES = parseInt(process.env.OPTIMIZER_MIN_TRADES ?? '30', 10);
const IS_FRACTION = 0.7;

// Parameter search space (coordinate descent explores around the current config).
const SPACE = {
  targetPct:    [0.006, 0.008, 0.01, 0.0125, 0.015, 0.0175, 0.02, 0.025, 0.03],
  stopPct:      [0.003, 0.004, 0.005, 0.0065, 0.0075, 0.01, 0.0125, 0.015],
  momentumPct:  [0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 0.75],
  emaMarginPct: [0.0003, 0.0005, 0.001, 0.002, 0.003],
  rsiLongMin:   [40, 45, 50],
  rsiLongMax:   [60, 64, 68, 72],
  rsiShortMin:  [28, 32, 36, 40],
  rsiShortMax:  [52, 55, 60],
  timeoutHours: [1, 2, 3, 4, 6, 8],
  useHtfFilter: [0, 1],
  htfMinutes:   [5, 15, 30],
};

function split(klines) {
  const cut = Math.floor(klines.length * IS_FRACTION);
  return { is: klines.slice(0, cut), oos: klines.slice(cut) };
}

/** Build an evaluate(params)→metrics that aggregates trades across all assets' windows. */
function makeEvaluate(windows) {
  return (params) => {
    const all = [];
    for (const w of windows) {
      const { trades } = runBacktest(w.klines, params, {});
      all.push(...trades);
    }
    return computeMetrics(all, {});
  };
}

function logRun(entry) {
  let log = [];
  try { log = JSON.parse(readFileSync(RUNS_LOG, 'utf8')); } catch { /* first run */ }
  log.push(entry);
  if (log.length > 100) log = log.slice(-100);
  mkdirSync(dirname(RUNS_LOG), { recursive: true });
  writeFileSync(RUNS_LOG, JSON.stringify(log, null, 2));
}

async function runOnce() {
  const started = new Date().toISOString();
  console.log(`\n[optimizer] ${started} — walk-forward over ${DAYS}d (IS ${IS_FRACTION * 100}% / OOS ${(1 - IS_FRACTION) * 100}%)`);

  const assets = getAssets();
  const isWin = [], oosWin = [];
  for (const { symbol, pair } of assets) {
    try {
      const klines = await fetchKlines(pair, { days: DAYS, interval: '1m' });
      const { is, oos } = split(klines);
      isWin.push({ pair, klines: is });
      oosWin.push({ pair, klines: oos });
      console.log(`[optimizer]   ${symbol}: ${klines.length} candles (IS ${is.length} / OOS ${oos.length})`);
    } catch (err) {
      console.warn(`[optimizer]   ${symbol}: fetch error ${err.message}`);
    }
  }
  if (isWin.length === 0) { console.warn('[optimizer] No data — skipping.'); return; }

  const isEval = makeEvaluate(isWin);
  const oosEval = makeEvaluate(oosWin);
  const current = getParams();

  const best = coordinateDescent({ base: current, space: SPACE, evaluate: isEval, rounds: 3, minTrades: MIN_TRADES });
  if (!best.params) { console.warn('[optimizer] No in-sample candidate met min trades — skipping.'); return; }

  const decision = shouldAdopt({ current, candidate: best.params, evaluate: oosEval, minTrades: MIN_TRADES });

  const isM = best.metrics;
  const oosM = decision.candMetrics;
  console.log(`[optimizer] Best IS: net ${money(isM.netPnl)} exp ${money(isM.expectancy)} trades ${isM.trades} winRate ${(isM.winRate * 100).toFixed(1)}%`);
  console.log(`[optimizer] OOS check: cand exp ${money(oosM?.expectancy ?? 0)} (${oosM?.trades ?? 0} trades) vs current exp ${money(decision.curMetrics?.expectancy ?? 0)}`);
  console.log(`[optimizer] Decision: ${decision.adopt ? 'ADOPT ✅' : 'KEEP CURRENT ❌'} — ${decision.reason}`);

  if (decision.adopt) {
    saveParams(best.params, { source: 'optimizer', at: started, isScore: best.score, oosScore: decision.candScore });
    console.log(`[optimizer] Saved new params: ${JSON.stringify(best.params)}`);
  }

  logRun({
    at: started, adopted: decision.adopt, reason: decision.reason,
    candidate: best.params, isMetrics: isM, oosMetrics: oosM,
    currentBefore: current,
  });

  writeHeartbeat({
    lastRunAt: started,
    completedAt: new Date().toISOString(),
    adopted: decision.adopt,
    days: DAYS,
    assets: isWin.length,
    bestOosExpectancy: oosM?.expectancy ?? null,
  });
}

function writeHeartbeat(entry) {
  try {
    mkdirSync(dirname(HEARTBEAT), { recursive: true });
    writeFileSync(HEARTBEAT, JSON.stringify(entry, null, 2));
  } catch { /* never block the optimizer */ }
}

function money(x) { return `$${Number(x ?? 0).toFixed(3)}`; }

async function loop() {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║   GÉNESIS HQ — CRYPTO OPTIMIZER (24/7 training)       ║');
  console.log(`║   ${ONCE ? 'SINGLE PASS' : `CONTINUOUS every ${INTERVAL_MIN} min`}`.padEnd(56) + '║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`[optimizer] defaults: ${JSON.stringify(DEFAULTS)}`);

  await runOnce();
  if (ONCE) return;

  setInterval(() => { runOnce().catch(e => console.error('[optimizer] pass error:', e.message)); }, INTERVAL_MIN * 60 * 1000);
  console.log(`\n[optimizer] Running. Next pass in ${INTERVAL_MIN} min. Ctrl+C to stop.\n`);
}

loop().catch(err => { console.error(err); process.exit(1); });
