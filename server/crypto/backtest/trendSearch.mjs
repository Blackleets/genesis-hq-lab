// trendSearch.mjs — does a REAL edge exist on higher timeframes?
//
// edgeSearch.mjs proved 1m scalping has no edge: on 1-minute bars the noise
// swamps the signal and the ~0.2% round-trip cost turns coin-flips into
// guaranteed losers. This script tests the one family with a documented edge in
// crypto: TREND-FOLLOWING on higher timeframes (1h / 4h), where moves persist
// long enough to pay for the cost — "cut losses short, let winners run".
//
// It injects a custom signalFn into the SAME backtest engine (real fees +
// slippage, candle-by-candle) and validates OUT-OF-SAMPLE (train 70 / test 30).
// Read-only research — never touches the live trading path.
//
// Run: node server/crypto/backtest/trendSearch.mjs

import { fetchKlines } from './historicalData.mjs';
import { runBacktest } from './backtestEngine.mjs';
import { computeMetrics } from './metrics.mjs';

const PAIRS = (process.env.TREND_PAIRS ?? 'BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT').split(',');
const MIN_TRADES = 20; // per split — below this a result is not trustworthy

// ── Signals (TF-agnostic: ema9/ema21/rsi14 are computed on the candles fed in) ──

// Trend-following: ride the established trend, avoid chasing extremes.
function trendSignal(ctx, params) {
  const { ema9, ema21, rsi14 } = ctx;
  const m = params.trendMargin ?? 0.0;
  if (ema9 > ema21 * (1 + m) && rsi14 < (params.rsiMax ?? 78)) return { action: 'TRADE', side: 'LONG' };
  if (ema9 < ema21 * (1 - m) && rsi14 > (params.rsiMin ?? 22)) return { action: 'TRADE', side: 'SHORT' };
  return { action: 'WAIT', side: null };
}

// Mean-reversion at statistical extremes (the OTHER documented HTF edge).
function revertSignal(ctx, params) {
  const { rsi14 } = ctx;
  if (rsi14 < (params.rsiBuy ?? 30)) return { action: 'TRADE', side: 'LONG' };
  if (rsi14 > (params.rsiSell ?? 70)) return { action: 'TRADE', side: 'SHORT' };
  return { action: 'WAIT', side: null };
}

// (interval, days, timeoutHours, family, [targetPct, stopPct], label)
function buildConfigs() {
  const out = [];
  const TF = [
    { interval: '1h', days: 180, timeoutHours: 24 },
    { interval: '4h', days: 540, timeoutHours: 96 },
  ];
  // Trend geometries: asymmetric R:R — let winners run.
  const trendGeo = [[0.03, 0.015], [0.04, 0.02], [0.06, 0.02], [0.06, 0.03], [0.08, 0.03], [0.10, 0.04]];
  // Mean-reversion geometries: symmetric-ish, quicker.
  const revertGeo = [[0.02, 0.02], [0.03, 0.02], [0.03, 0.03], [0.04, 0.03]];

  for (const tf of TF) {
    for (const [targetPct, stopPct] of trendGeo) {
      out.push({ ...tf, family: 'trend', signalFn: trendSignal, targetPct, stopPct,
        label: `trend  ${tf.interval}  TP${(targetPct*100).toFixed(1)}%/SL${(stopPct*100).toFixed(1)}%` });
    }
    for (const [targetPct, stopPct] of revertGeo) {
      out.push({ ...tf, family: 'revert', signalFn: revertSignal, targetPct, stopPct,
        label: `revert ${tf.interval}  TP${(targetPct*100).toFixed(1)}%/SL${(stopPct*100).toFixed(1)}%` });
    }
  }
  return out;
}

function backtestSlice(klinesByPair, cfg, fromFrac, toFrac) {
  const all = [];
  for (const pair of Object.keys(klinesByPair)) {
    const k = klinesByPair[pair];
    const a = Math.floor(k.length * fromFrac);
    const b = Math.floor(k.length * toFrac);
    const params = { targetPct: cfg.targetPct, stopPct: cfg.stopPct, timeoutHours: cfg.timeoutHours };
    const { trades } = runBacktest(k.slice(a, b), params, { signalFn: cfg.signalFn, warmup: 50 });
    all.push(...trades);
  }
  return computeMetrics(all);
}

export async function runTrendSearch({ pairs = PAIRS } = {}) {
  const configs = buildConfigs();

  // Fetch each (interval, days) once, keyed by interval.
  const byInterval = {};
  for (const cfg of configs) {
    const key = `${cfg.interval}:${cfg.days}`;
    if (byInterval[key]) continue;
    const klinesByPair = {};
    for (const pair of pairs) klinesByPair[pair] = await fetchKlines(pair, { days: cfg.days, interval: cfg.interval });
    byInterval[key] = klinesByPair;
  }

  const results = [];
  for (const cfg of configs) {
    const klinesByPair = byInterval[`${cfg.interval}:${cfg.days}`];
    const train = backtestSlice(klinesByPair, cfg, 0.0, 0.7);
    const test  = backtestSlice(klinesByPair, cfg, 0.7, 1.0);
    results.push({ label: cfg.label, family: cfg.family, interval: cfg.interval,
      targetPct: cfg.targetPct, stopPct: cfg.stopPct, train, test });
  }

  const robust = results.filter(r =>
    r.train.trades >= MIN_TRADES && r.test.trades >= MIN_TRADES &&
    r.train.expectancy > 0 && r.test.expectancy > 0 &&
    (r.train.profitFactor ?? 0) > 1 && (r.test.profitFactor ?? 0) > 1
  ).sort((a, b) => b.test.expectancy - a.test.expectancy);

  const byTest = [...results]
    .filter(r => r.test.trades >= MIN_TRADES)
    .sort((a, b) => b.test.expectancy - a.test.expectancy);

  return { pairs, configs: results, robust, byTest, winner: robust[0] ?? null };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (process.argv[1]?.endsWith('trendSearch.mjs')) {
  console.log(`[trendSearch] testing trend + mean-reversion on 1h/4h for ${PAIRS.join(', ')}…`);
  const res = await runTrendSearch();
  const pf = (x) => x == null ? '—' : x.toFixed(2);
  const row = (label, m) => `${label}  n=${String(m.trades).padStart(4)}  WR=${(m.winRate*100).toFixed(0).padStart(3)}%  EV=$${m.expectancy.toFixed(3).padStart(7)}  PF=${pf(m.profitFactor).padStart(5)}  ROI=${(m.roi*100).toFixed(1)}%`;

  console.log('\n════════ HIGHER-TIMEFRAME EDGE SEARCH — train70/test30 ════════');
  console.log('\n— Ranked by OUT-OF-SAMPLE expectancy —');
  for (const r of res.byTest.slice(0, 14)) {
    console.log(`\n${r.label}`);
    console.log('  ' + row('TRAIN', r.train));
    console.log('  ' + row('TEST ', r.test));
  }
  console.log('\n════════ ROBUST EDGE (positive on BOTH splits) ════════');
  if (res.robust.length === 0) {
    console.log('  NONE. No higher-TF config has a positive out-of-sample edge over this window.');
  } else {
    for (const r of res.robust) {
      console.log(`  ✅ ${r.label} | test EV=$${r.test.expectancy.toFixed(3)} WR=${(r.test.winRate*100).toFixed(0)}% PF=${pf(r.test.profitFactor)} | train EV=$${r.train.expectancy.toFixed(3)}`);
    }
    console.log(`\n  WINNER → ${res.winner.label}  (test EV=$${res.winner.test.expectancy.toFixed(3)}/trade, PF=${pf(res.winner.test.profitFactor)})`);
  }
  console.log('═══════════════════════════════════════════════════════\n');
  process.exit(0);
}
