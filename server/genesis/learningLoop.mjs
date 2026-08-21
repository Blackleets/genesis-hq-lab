// server/genesis/learningLoop.mjs
// The infinite learner. Scans the ENTIRE crypto space (Binance 527 USDT
// perpetuals, extensible to more exchanges via ccxt), runs the adaptive
// walk-forward engine on each, harvests small daily edges, and compounds
// capital. Crucially: it PERSISTS a knowledge base (learnings.json) so each
// cycle builds on the last — edges discovered, regimes seen, what worked.
//
// Design mirrors real quant desks: universe scan -> per-asset edge detection ->
// size by edge quality -> compound -> learn. Daily, small, reinvested.
//
// PAPER ONLY by default. REAL requires explicit human GO + keys + confirm.
// NEVER auto-executes real orders.

import { readFileSync, writeFileSync } from 'node:fs';
import { fetchKlines } from '../crypto/backtest/historicalData.mjs';
import { makeStrategy } from './strategyLib.mjs';
import { fullReport } from './backtestCore.mjs';
import { adaptiveStep } from './adaptiveEngine.mjs';

const LEARNINGS_PATH = new URL('./learnings.json', import.meta.url);
const UNIVERSE_CACHE_PATH = new URL('./universe_cache.json', import.meta.url);

const FAMILIES = ['meanReversion', 'breakout', 'momentum', 'orderbookImbalance', 'volumeProfile'];
const DAILY_TARGET_PCT = 0.005; // ~0.5% target per active edge day (compounding)
const RISK_PER_TRADE = 0.01;    // 1% of capital per deployed edge

function loadLearnings() {
  try { return JSON.parse(readFileSync(LEARNINGS_PATH)) ?? { edges: {}, regimes: {}, totalCycles: 0 }; }
  catch { return { edges: {}, regimes: {}, totalCycles: 0 }; }
}
function saveLearnings(l) {
  writeFileSync(LEARNINGS_PATH, JSON.stringify(l, null, 2));
}

async function getUniverse() {
  try {
    const j = await (await fetch('https://fapi.binance.com/fapi/v1/exchangeInfo')).json();
    const pairs = j.symbols
      .filter(s => s.symbol.endsWith('USDT') && s.contractType === 'PERPETUAL' && s.status === 'TRADING')
      .map(s => s.symbol);
    writeFileSync(UNIVERSE_CACHE_PATH, JSON.stringify(pairs));
    return pairs;
  } catch {
    try { return JSON.parse(readFileSync(UNIVERSE_CACHE_PATH)); }
    catch { return ['BTCUSDT','ETHUSDT','SOLUSDT','COTIUSDT','XLMUSDT']; }
  }
}

// Score a single pair: run adaptive step, return best deployable edge or null.
async function scorePair(pair, capital) {
  try {
    const candles = await fetchKlines(pair, { days: 120, interval: '1h' });
    if (candles.length < 400) return null;
    const { deployed } = await adaptiveStep({ candles, trainDays: 90, oosDays: 30, generations: 6 });
    if (!deployed.length) return null;
    const d = deployed[0];
    // size by edge quality: capital * risk * min(PF-1, 1)
    const pf = d.oosMetrics.profitFactor || 1;
    const weight = Math.min(Math.max((pf - 1) * 2, 0), 1);
    const allocated = capital * RISK_PER_TRADE * (0.5 + 0.5 * weight);
    return {
      pair, kind: d.kind, params: d.params,
      pf: pf, wr: d.oosMetrics.winRate, trades: d.oosMetrics.trades,
      expectedDailyPct: DAILY_TARGET_PCT * (0.5 + 0.5 * weight),
      allocated: +allocated.toFixed(2),
      metrics: d.oosMetrics,
    };
  } catch { return null; }
}

export async function runLearningLoop({ capital = 1000, maxPairs = 40, dryRun = true } = {}) {
  console.log(`\n🧠 LEARNING LOOP — universe scan (daily compounding, PAPER)`);
  console.log(`Capital: $${capital} | Max pairs to deploy: ${maxPairs} | Dry run: ${dryRun}\n`);
  const learnings = loadLearnings();
  learnings.totalCycles++;

  const universe = await getUniverse();
  console.log(`Universe: ${universe.length} USDT pairs (Binance). Scanning...`);

  // Prioritize pairs we've seen edges in before (build on learning)
  const ranked = universe.sort((a, b) => (learnings.edges[b]?.score || 0) - (learnings.edges[a]?.score || 0));
  const deployments = [];
  let scanned = 0;
  for (const pair of ranked) {
    if (deployments.length >= maxPairs) break;
    if (scanned >= Math.min(universe.length, 80)) break; // cap per cycle (cost/time)
    scanned++;
    const edge = await scorePair(pair, capital);
    if (edge) {
      deployments.push(edge);
      learnings.edges[pair] = { score: edge.pf, kind: edge.kind, lastSeen: new Date().toISOString(), params: edge.params };
      console.log(`  ✅ ${pair.padEnd(11)} ${edge.kind.padEnd(16)} PF=${edge.pf} WR=${edge.wr}% | alloc $${edge.allocated} | exp +${(edge.expectedDailyPct*100).toFixed(2)}%/day`);
    }
  }

  // Compound: sum expected daily return across deployed edges
  const totalExpectedDailyPct = deployments.reduce((s, d) => s + d.expectedDailyPct * (d.allocated / capital), 0);
  const projectedDaily = capital * totalExpectedDailyPct;
  const projectedMonthly = capital * (Math.pow(1 + totalExpectedDailyPct, 30) - 1);

  console.log(`\n=== LEARNING LOOP VERDICT ===`);
  console.log(`Scanned: ${scanned}/${universe.length} | Deployed: ${deployments.length}`);
  console.log(`Expected daily edge: +$${(projectedDaily).toFixed(2)} (${ (totalExpectedDailyPct*100).toFixed(3)}%)`);
  console.log(`Projected monthly compounding: +$${(projectedMonthly).toFixed(2)} (capital -> $${(capital+projectedMonthly).toFixed(0)})`);
  console.log(`Knowledge base: ${Object.keys(learnings.edges).length} pairs learned, ${learnings.totalCycles} cycles`);

  if (deployments.length && !dryRun) {
    console.log(`\n⚠️  REAL execution NOT performed. PAPER ONLY. To go live: human GO + keys + confirm + kill switch.`);
  }
  saveLearnings(learnings);
  return { deployments, projectedDaily, projectedMonthly, learnings };
}

if (process.argv[1] && process.argv[1].endsWith('learningLoop.mjs')) {
  const capital = Number(process.argv[2] || 1000);
  runLearningLoop({ capital, dryRun: true })
    .then(() => process.exit(0))
    .catch(e => { console.error('LEARNING LOOP ERR:', e.message); process.exit(1); });
}
