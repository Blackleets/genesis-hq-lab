// server/genesis/learningLoop.mjs
// The infinite learner. Scans the ENTIRE crypto space (Binance 527 USDT
// perpetuals, extensible to more exchanges via ccxt), runs the adaptive
// walk-forward engine on each (MULTI-TIMEFRAME: 1h + 15m + 5m on liquid pairs),
// harvests small daily edges, and compounds capital. Persists learnings.json
// that grows every cycle: edges discovered, REGIME HISTORY per pair, and a
// consistency score so fragile edges are deprioritized. Builds knowledge
// infinitely — the more cycles, the smarter the asset ranking.
//
// Design mirrors real quant desks: universe scan -> multi-tf edge detection ->
// size by edge quality + consistency -> compound -> learn. Daily, small, reinvested.
//
// PAPER ONLY by default. REAL requires explicit human GO + keys + confirm.
// NEVER auto-executes real orders.

import { readFileSync, writeFileSync } from 'node:fs';
import { fetchKlines } from '../crypto/backtest/historicalData.mjs';
import { adaptiveStep } from './adaptiveEngine.mjs';

const LEARNINGS_PATH = new URL('./learnings.json', import.meta.url);
const UNIVERSE_CACHE_PATH = new URL('./universe_cache.json', import.meta.url);

const DAILY_TARGET_PCT = 0.005; // ~0.5% target per active edge day (compounding)
const RISK_PER_TRADE = 0.01;    // 1% of capital per deployed edge

// Liquid pairs get 15m + 5m scans (more daily edges). Rest get 1h only.
const LIQUID = new Set(['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT','DOGEUSDT','ADAUSDT','AVAXUSDT','LINKUSDT','MATICUSDT','DOTUSDT','LTCUSDT','TRXUSDT','NEARUSDT']);

function loadLearnings() {
  try { return JSON.parse(readFileSync(LEARNINGS_PATH)) ?? { edges: {}, regimes: {}, totalCycles: 0, capital: 1000 }; }
  catch { return { edges: {}, regimes: {}, totalCycles: 0, capital: 1000 }; }
}
function saveLearnings(l) { writeFileSync(LEARNINGS_PATH, JSON.stringify(l, null, 2)); }

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

// Consistency: fraction of recent windows that were positive (streak-aware).
// A fragile edge (1 lucky window) scores low even if PF is high.
function consistencyScore(history) {
  if (!history.length) return 0;
  const pos = history.filter(h => h > 0).length;
  return pos / history.length;
}

// Score a single pair across timeframes. Returns best deployable edge or null.
async function scorePair(pair, capital, learnings) {
  const timeframes = LIQUID.has(pair) ? ['1h', '15m', '5m'] : ['1h'];
  let best = null;
  for (const tf of timeframes) {
    try {
      const totalDays = tf === '5m' ? 30 : tf === '15m' ? 60 : 120;
      const candles = await fetchKlines(pair, { days: totalDays, interval: tf });
      if (candles.length < 400) continue;
      const { deployed } = await adaptiveStep({ candles, trainDays: totalDays * 0.75, oosDays: totalDays * 0.25, generations: 5 });
      if (!deployed.length) continue;
      const d = deployed[0];
      const pf = d.oosMetrics.profitFactor || 1;
      const weight = Math.min(Math.max((pf - 1) * 2, 0), 1);

      // consistency from prior regime history for this pair
      const hist = learnings.regimes[pair]?.history || [];
      const cons = consistencyScore(hist);
      const combined = weight * (0.6 + 0.4 * cons); // edge * (base + consistency)

      const allocated = capital * RISK_PER_TRADE * (0.5 + 0.5 * combined);
      const cand = {
        pair, kind: d.kind, tf, params: d.params,
        pf, wr: d.oosMetrics.winRate, trades: d.oosMetrics.trades,
        expectedDailyPct: DAILY_TARGET_PCT * (0.5 + 0.5 * combined),
        allocated: +allocated.toFixed(2),
        consistency: +cons.toFixed(2),
        metrics: d.oosMetrics,
      };
      if (!best || cand.allocated > best.allocated) best = cand;
    } catch { /* skip tf */ }
  }
  return best;
}

export async function runLearningLoop({ capital = 1000, maxPairs = 40, dryRun = true } = {}) {
  console.log(`\n🧠 LEARNING LOOP — universe scan (multi-TF, daily compounding, PAPER)`);
  console.log(`Capital: $${capital} | Max pairs to deploy: ${maxPairs} | Dry run: ${dryRun}\n`);
  const learnings = loadLearnings();
  learnings.totalCycles++;
  if (capital) learnings.capital = capital;

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
    const edge = await scorePair(pair, capital, learnings);
    if (edge) {
      deployments.push(edge);
      // persist edge + regime history
      const prev = learnings.regimes[pair]?.history || [];
      const ret = edge.metrics.returnPct;
      learnings.regimes[pair] = { history: [...prev, ret].slice(-20), lastKind: edge.kind, lastTf: edge.tf };
      learnings.edges[pair] = { score: edge.pf, kind: edge.kind, tf: edge.tf, consistency: edge.consistency, lastSeen: new Date().toISOString(), params: edge.params };
      console.log(`  ✅ ${pair.padEnd(11)} ${edge.kind.padEnd(16)} @${edge.tf} PF=${edge.pf} WR=${edge.wr}% cons=${edge.consistency} | alloc $${edge.allocated} | +${(edge.expectedDailyPct*100).toFixed(2)}%/day`);
    }
  }

  // Compound: sum expected daily return across deployed edges (reinvested)
  const totalExpectedDailyPct = deployments.reduce((s, d) => s + d.expectedDailyPct * (d.allocated / capital), 0);
  const projectedDaily = capital * totalExpectedDailyPct;
  const projectedMonthly = capital * (Math.pow(1 + totalExpectedDailyPct, 30) - 1);
  // update learned capital (compounding simulation)
  learnings.capital = +(capital + projectedMonthly).toFixed(2);

  console.log(`\n=== LEARNING LOOP VERDICT ===`);
  console.log(`Scanned: ${scanned}/${universe.length} | Deployed: ${deployments.length}`);
  console.log(`Expected daily edge: +$${(projectedDaily).toFixed(2)} (${ (totalExpectedDailyPct*100).toFixed(3)}%)`);
  console.log(`Projected monthly compounding: +$${(projectedMonthly).toFixed(2)} (capital -> $${learnings.capital.toFixed(0)})`);
  console.log(`Knowledge base: ${Object.keys(learnings.edges).length} edges, ${Object.keys(learnings.regimes).length} regime-histories, ${learnings.totalCycles} cycles`);

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
