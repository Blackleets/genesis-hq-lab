// edgeSearch.mjs — systematic edge discovery.
//
// The live scalp config (TP 0.4% / SL 0.2%, momentum) loses across every regime
// (WR ~20%, PF ~0.47). This sweeps strategy × TP/SL geometry over REAL historical
// klines and validates OUT-OF-SAMPLE (train 70% / test 30%) so we don't pick an
// overfit config. A config only counts as "edge" if it's positive on the test split.
// Read-only — never touches the live trading path. Run: node server/crypto/backtest/edgeSearch.mjs

import { fetchKlines } from './historicalData.mjs';
import { runBacktest } from './backtestEngine.mjs';
import { computeMetrics } from './metrics.mjs';
import { DEFAULTS } from '../strategyParams.mjs';

const PAIRS = (process.env.EDGE_PAIRS ?? 'BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT').split(',');
const DAYS  = parseInt(process.env.EDGE_DAYS ?? '30', 10);
const MIN_TRADES = 25;   // per split — below this a result is not trustworthy

// (targetPct, stopPct) geometries to test — fractions.
const GEOMETRIES = [
  [0.004, 0.002],  // current live scalp (the loser) — baseline
  [0.006, 0.003],
  [0.008, 0.004],
  [0.010, 0.005],
  [0.006, 0.006],  // 1:1
  [0.010, 0.010],
  [0.012, 0.006],
  [0.015, 0.0075], // swing-ish
  [0.020, 0.010],
  [0.008, 0.012],  // asymmetric: let winners run, tighter target? (inverse R:R)
];

function buildConfigs() {
  const configs = [];
  for (const strategy of ['momentum', 'meanreversion']) {
    for (const [targetPct, stopPct] of GEOMETRIES) {
      configs.push({
        ...DEFAULTS, strategy, targetPct, stopPct, timeoutHours: 4,
        label: `${strategy.padEnd(13)} TP${(targetPct * 100).toFixed(2)}%/SL${(stopPct * 100).toFixed(2)}%`,
      });
    }
  }
  return configs;
}

function backtestSlice(klinesByPair, params, fromFrac, toFrac) {
  const all = [];
  for (const pair of Object.keys(klinesByPair)) {
    const k = klinesByPair[pair];
    const a = Math.floor(k.length * fromFrac);
    const b = Math.floor(k.length * toFrac);
    const { trades } = runBacktest(k.slice(a, b), params, { warmup: 320 });
    all.push(...trades);
  }
  return computeMetrics(all);
}

export async function runEdgeSearch({ pairs = PAIRS, days = DAYS } = {}) {
  // Fetch (cached) real klines for every pair once.
  const klinesByPair = {};
  for (const pair of pairs) {
    klinesByPair[pair] = await fetchKlines(pair, { days, interval: '1m' });
  }

  const configs = buildConfigs();
  const results = [];
  for (const cfg of configs) {
    const train = backtestSlice(klinesByPair, cfg, 0.0, 0.7);   // in-sample
    const test  = backtestSlice(klinesByPair, cfg, 0.7, 1.0);   // out-of-sample
    results.push({ label: cfg.label, strategy: cfg.strategy, targetPct: cfg.targetPct, stopPct: cfg.stopPct, train, test });
  }

  // A robust edge: positive expectancy AND PF>1 on BOTH splits, enough trades on each.
  const robust = results.filter(r =>
    r.train.trades >= MIN_TRADES && r.test.trades >= MIN_TRADES &&
    r.train.expectancy > 0 && r.test.expectancy > 0 &&
    (r.train.profitFactor ?? 0) > 1 && (r.test.profitFactor ?? 0) > 1
  ).sort((a, b) => b.test.expectancy - a.test.expectancy);

  // Best by out-of-sample expectancy regardless of robustness (for context).
  const byTest = [...results]
    .filter(r => r.test.trades >= MIN_TRADES)
    .sort((a, b) => b.test.expectancy - a.test.expectancy);

  return { days, pairs, configs: results, robust, byTest, winner: robust[0] ?? null };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (process.argv[1]?.endsWith('edgeSearch.mjs')) {
  console.log(`[edgeSearch] fetching ${DAYS}d of 1m klines for ${PAIRS.join(', ')}…`);
  const res = await runEdgeSearch();
  const pf = (x) => x == null ? '—' : x.toFixed(2);
  const row = (label, m) => `${label}  n=${String(m.trades).padStart(4)}  WR=${(m.winRate * 100).toFixed(0).padStart(3)}%  EV=$${m.expectancy.toFixed(3).padStart(7)}  PF=${pf(m.profitFactor).padStart(5)}  DD=${(m.maxDrawdown * 100).toFixed(1)}%`;

  console.log(`\n════════ EDGE SEARCH — ${res.days}d, ${res.pairs.length} pairs, train70/test30 ════════`);
  console.log('\n— Ranked by OUT-OF-SAMPLE expectancy —');
  for (const r of res.byTest.slice(0, 12)) {
    console.log(`\n${r.label}`);
    console.log('  ' + row('TRAIN', r.train));
    console.log('  ' + row('TEST ', r.test));
  }
  console.log('\n════════ ROBUST EDGE (positive on BOTH splits) ════════');
  if (res.robust.length === 0) {
    console.log('  NONE. No strategy/geometry has a positive out-of-sample edge over this window.');
  } else {
    for (const r of res.robust) {
      console.log(`  ✅ ${r.label} | test EV=$${r.test.expectancy.toFixed(3)} WR=${(r.test.winRate*100).toFixed(0)}% PF=${pf(r.test.profitFactor)} | train EV=$${r.train.expectancy.toFixed(3)}`);
    }
    console.log(`\n  WINNER → ${res.winner.label}  (strategy=${res.winner.strategy}, TP=${(res.winner.targetPct*100).toFixed(2)}%, SL=${(res.winner.stopPct*100).toFixed(2)}%)`);
  }
  console.log('═══════════════════════════════════════════════════════\n');
  process.exit(0);
}
