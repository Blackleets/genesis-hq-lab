// breakoutWalkForward.mjs — does the multi-pair breakout SHORT edge hold across TIME,
// or is it just fitting the recent (bearish) test slice?
//
// strategyLab found `breakout-multi-4h-p55-tp60-sl30` (BTC+ETH+SOL) positive on both
// train+test with PF>1.1 and 100+ trades — but 100% of its test PnL came from SHORT.
// A single train/test split can't tell whether short-breakout is a real edge or a
// regime artifact. This harness answers that:
//
//   1. Run the backtest ONCE over the full history per pair (every trade keeps its full
//      preceding context / warmup — no per-window warmup loss, no look-ahead).
//   2. Pool all trades, bucket them by openTime into K consecutive equal-time windows.
//   3. Per window, split SHORT-only vs LONG-only and compute metrics.
//
// A real short edge is positive (EV>0, PF>1) in MOST windows, not just the last one.
// Read-only research — never touches the live trading path.
//
// Run: node server/crypto/backtest/breakoutWalkForward.mjs

import { fetchKlines } from './historicalData.mjs';
import { runBacktest } from './backtestEngine.mjs';
import { computeMetrics } from './metrics.mjs';
import { breakoutSignal } from './strategyLab.mjs';

const PAIRS = (process.env.WF_PAIRS ?? 'BTCUSDT,ETHUSDT,SOLUSDT').split(',');
const WINDOWS = parseInt(process.env.WF_WINDOWS ?? '6', 10);
const MIN_WINDOW_TRADES = parseInt(process.env.WF_MIN_TRADES ?? '8', 10); // per side, per window, to be trustworthy

// The winning candidate from strategyLab.
const CONFIG = Object.freeze({
  interval: '4h',
  days: parseInt(process.env.WF_DAYS ?? '730', 10),
  breakoutPeriod: parseInt(process.env.WF_PERIOD ?? '55', 10),
  targetPct: parseFloat(process.env.WF_TP ?? '0.06'),
  stopPct: parseFloat(process.env.WF_SL ?? '0.03'),
  timeoutHours: parseInt(process.env.WF_TIMEOUT_H ?? '240', 10),
  warmup: 120,
});

/**
 * Bucket trades into `windows` consecutive equal-time windows spanning
 * [min(openTime), max(openTime)]. Pure — exported for unit testing.
 * @returns {Array<{ index, fromTs, toTs, trades }>}
 */
export function bucketTradesByWindow(trades, windows) {
  const buckets = Array.from({ length: windows }, (_, index) => ({ index, fromTs: 0, toTs: 0, trades: [] }));
  if (trades.length === 0 || windows <= 0) return buckets;

  const times = trades.map((t) => t.openTime);
  const min = Math.min(...times);
  const max = Math.max(...times);
  const span = Math.max(1, max - min);
  const step = span / windows;

  for (let i = 0; i < windows; i++) {
    buckets[i].fromTs = Math.round(min + step * i);
    buckets[i].toTs = Math.round(min + step * (i + 1));
  }
  for (const t of trades) {
    // Clamp the final edge into the last window.
    const idx = Math.min(windows - 1, Math.floor((t.openTime - min) / step));
    buckets[idx].trades.push(t);
  }
  return buckets;
}

function sideMetrics(trades, side) {
  return computeMetrics(trades.filter((t) => t.side === side));
}

export async function runBreakoutWalkForward({ pairs = PAIRS, windows = WINDOWS, config = CONFIG } = {}) {
  const params = { targetPct: config.targetPct, stopPct: config.stopPct, timeoutHours: config.timeoutHours };
  const signalParams = { breakoutPeriod: config.breakoutPeriod };

  // 1. One full-history backtest per pair → pooled trades (each keeps full warmup context).
  const allTrades = [];
  for (const pair of pairs) {
    const klines = await fetchKlines(pair, { days: config.days, interval: config.interval });
    const { trades } = runBacktest(klines, { ...params, ...signalParams }, {
      signalFn: (ctx) => breakoutSignal(ctx, signalParams),
      warmup: config.warmup,
    });
    for (const t of trades) allTrades.push({ ...t, pair });
  }

  // 2. Bucket by time, 3. per-side metrics per window.
  const buckets = bucketTradesByWindow(allTrades, windows);
  const windowReports = buckets.map((b) => ({
    index: b.index,
    from: new Date(b.fromTs).toISOString().slice(0, 10),
    to: new Date(b.toTs).toISOString().slice(0, 10),
    short: sideMetrics(b.trades, 'SHORT'),
    long: sideMetrics(b.trades, 'LONG'),
    combined: computeMetrics(b.trades),
  }));

  // Verdict: short edge robust if EV>0 AND PF>1 in a strong majority of windows that
  // actually have enough short trades to judge.
  const judged = windowReports.filter((w) => w.short.trades >= MIN_WINDOW_TRADES);
  const shortPositive = judged.filter((w) => w.short.expectancy > 0 && (w.short.profitFactor ?? 0) > 1);
  const longJudged = windowReports.filter((w) => w.long.trades >= MIN_WINDOW_TRADES);
  const longPositive = longJudged.filter((w) => w.long.expectancy > 0 && (w.long.profitFactor ?? 0) > 1);

  const robustShort = judged.length >= Math.ceil(windows * 0.6) &&
    shortPositive.length >= Math.ceil(judged.length * 0.7);

  return {
    config, pairs, windows,
    totalTrades: allTrades.length,
    shortAll: sideMetrics(allTrades, 'SHORT'),
    longAll: sideMetrics(allTrades, 'LONG'),
    windowReports,
    summary: {
      shortJudgedWindows: judged.length,
      shortPositiveWindows: shortPositive.length,
      longJudgedWindows: longJudged.length,
      longPositiveWindows: longPositive.length,
      robustShort,
    },
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (process.argv[1]?.endsWith('breakoutWalkForward.mjs')) {
  console.log(`[breakoutWF] ${CONFIG.interval} p${CONFIG.breakoutPeriod} TP${CONFIG.targetPct*100}%/SL${CONFIG.stopPct*100}% over ${CONFIG.days}d, ${WINDOWS} windows, pairs=${PAIRS.join(',')}`);
  const res = await runBreakoutWalkForward();
  const pf = (x) => x == null ? '—' : x.toFixed(2);
  const line = (m) => `n=${String(m.trades).padStart(3)}  WR=${(m.winRate*100).toFixed(0).padStart(3)}%  EV=$${m.expectancy.toFixed(3).padStart(7)}  PF=${pf(m.profitFactor).padStart(5)}`;

  console.log(`\n════════ BREAKOUT WALK-FORWARD — ${res.totalTrades} trades pooled ════════`);
  console.log(`\nALL-HISTORY  SHORT: ${line(res.shortAll)}`);
  console.log(`ALL-HISTORY  LONG : ${line(res.longAll)}`);
  console.log('\n— Per consecutive time window —');
  for (const w of res.windowReports) {
    const flagS = w.short.trades >= 8 ? (w.short.expectancy > 0 && (w.short.profitFactor ?? 0) > 1 ? ' ✅' : ' ❌') : ' ··';
    console.log(`\nW${w.index} ${w.from}→${w.to}`);
    console.log(`  SHORT ${line(w.short)}${flagS}`);
    console.log(`  LONG  ${line(w.long)}`);
  }
  console.log('\n════════ VERDICT ════════');
  console.log(`  SHORT positive (EV>0 & PF>1) in ${res.summary.shortPositiveWindows}/${res.summary.shortJudgedWindows} judged windows`);
  console.log(`  LONG  positive in ${res.summary.longPositiveWindows}/${res.summary.longJudgedWindows} judged windows`);
  console.log(`  ROBUST SHORT EDGE: ${res.summary.robustShort ? 'YES — holds across time' : 'NO — not consistent across windows'}`);
  console.log('═══════════════════════════════════════════════════════\n');
  process.exit(0);
}
