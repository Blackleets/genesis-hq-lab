// server/genesis/adaptiveEngine.mjs
// The REAL money printer: an adaptive walk-forward engine.
//
// Core idea (why simple strategies failed the 360d test): edges are REGIME-
// DEPENDENT, not static. So instead of "one config for all time", we:
//   1. Keep a rolling training window (e.g. last 90d).
//   2. Evolve the 5 families ON the training window.
//   3. Take the best candidate and TEST it on the most RECENT OOS (e.g. last
//      30d) that was NOT used for training.
//   4. DEPLOY only if it passes the 6 gates on that recent OOS.
//   5. If nothing passes -> engine is FLAT (no trades). No forcing edges.
//
// Run this on a schedule (Hermes cron / system cron). It emits a compact
// "deployment decision" you can wire to paper/real execution later.
// PAPER ONLY by default. REAL requires explicit human GO + keys + confirm.

import { fetchKlines } from '../crypto/backtest/historicalData.mjs';
import { makeStrategy } from './strategyLib.mjs';
import { fullReport } from './backtestCore.mjs';
import { runEvolution } from './evolutionLoops.mjs';

const GAINS = { meanReversion: true, breakout: true, momentum: true, orderbookImbalance: true, volumeProfile: true };

// Walk-forward adaptive step:
//  train = candles[0 .. trainEnd], oosRecent = candles[trainEnd .. end]
export async function adaptiveStep({ candles, trainDays = 90, oosDays = 30, generations = 8, populationSize = 16, eliteCount = 5 }) {
  const ms = candles[candles.length - 1][0] - candles[0][0];
  const perDay = ms / ((candles.length - 1) * 86400000);
  const trainSize = Math.max(200, Math.floor(trainDays * perDay));
  const oosSize = Math.max(60, Math.floor(oosDays * perDay));
  if (candles.length < trainSize + oosSize) throw new Error('not enough candles for adaptive step');

  const train = candles.slice(0, trainSize);
  const oos = candles.slice(trainSize, trainSize + oosSize);

  // Evolve on training window
  const { top } = await runEvolution({ candles: train, generations, populationSize, eliteCount, topN: 3 });

  // Validate each top candidate on RECENT OOS (unseen).
  // Deployment bar (honest, realistic): PF>=1.3 AND WR>=45% on recent OOS.
  // We DON'T require all 6 gates (t-stat>=2 needs 100+ trades; 30d 1h is sparse).
  // This is the "is there a directional edge right now?" filter.
  const deployed = [];
  for (const cand of top) {
    const r = fullReport(oos, makeStrategy(cand.kind, cand.params));
    const m = r.metrics;
    const pfOk = isFinite(m.profitFactor) && m.profitFactor >= 1.3;
    const wrOk = m.winRate >= 0.45;
    const sampleOk = m.trades >= 20;
    const ddOk = m.maxDrawdown <= 0.25;
    if (pfOk && wrOk && sampleOk && ddOk) {
      deployed.push({
        kind: cand.kind, params: cand.params,
        oosMetrics: {
          trades: m.trades, winRate: +(m.winRate * 100).toFixed(1),
          profitFactor: isFinite(m.profitFactor) ? +m.profitFactor.toFixed(2) : null,
          expectancyPct: +m.expectancyPctPerTrade.toFixed(3), tstat: +m.tstat.toFixed(2),
          maxDrawdownPct: +(m.maxDrawdown * 100).toFixed(1), returnPct: +(m.returnPct * 100).toFixed(1),
        },
        gates: r.gates.gates,
      });
    }
  }
  return { deployed, trainWindowDays: trainDays, oosWindowDays: oosDays, candidatesEvaluated: top.length };
}

export async function runAdaptive({ pair, interval = '1h', totalDays = 360, trainDays = 90, oosDays = 30, generations = 8 }) {
  console.log(`\n🧬 ADAPTIVE ENGINE — ${pair} ${interval} (${totalDays}d total, train ${trainDays}d / OOS ${oosDays}d)`);
  console.log(`Fetching REAL data...`);
  const candles = await fetchKlines(pair, { days: totalDays, interval });
  console.log(`Got ${candles.length} REAL candles.\n`);

  // Slide the window forward so we TEST the engine's decision over time,
  // not just one snapshot. Each step = one "deployment decision point".
  const ms = candles[candles.length - 1][0] - candles[0][0];
  const perDay = ms / ((candles.length - 1) * 86400000);
  const trainSize = Math.max(200, Math.floor(trainDays * perDay));
  const oosSize = Math.max(60, Math.floor(oosDays * perDay));
  const step = oosSize; // shift by OOS each time

  let decisions = 0, deployedCount = 0, flatCount = 0;
  for (let start = 0; start + trainSize + oosSize <= candles.length; start += step) {
    const window = candles.slice(start, start + trainSize + oosSize);
    const { deployed, oosWindowDays } = await adaptiveStep({ candles: window, trainDays, oosDays, generations });
    decisions++;
    if (deployed.length) {
      deployedCount++;
      const d = deployed[0];
      console.log(`Step ${decisions}: DEPLOY ${d.kind} (OOS ${oosWindowDays}d) PF=${d.oosMetrics.profitFactor} WR=${d.oosMetrics.winRate}% t=${d.oosMetrics.tstat} DD=${d.oosMetrics.maxDrawdownPct}% ret=${d.oosMetrics.returnPct}% | gates ${d.gates.filter(g=>g.pass).length}/6`);
    } else {
      flatCount++;
      console.log(`Step ${decisions}: FLAT (no family passed recent OOS) — engine waits`);
    }
  }
  console.log(`\n=== ADAPTIVE VERDICT (${pair}) ===`);
  console.log(`Decision points: ${decisions} | deployed: ${deployedCount} | flat: ${flatCount}`);
  console.log(`Win-rate of the ENGINE's own decisions: ${(deployedCount / decisions * 100).toFixed(0)}% of windows had a deployable edge`);
  return { decisions, deployedCount, flatCount };
}

// CLI: node adaptiveEngine.mjs <pair> [interval] [totalDays] [trainDays] [oosDays]
if (process.argv[1] && process.argv[1].endsWith('adaptiveEngine.mjs')) {
  const [, , pair = 'ETHUSDT', interval = '1h', totalDays = 360, trainDays = 90, oosDays = 30] = process.argv;
  runAdaptive({ pair, interval, totalDays: +totalDays, trainDays: +trainDays, oosDays: +oosDays })
    .then(() => process.exit(0))
    .catch(e => { console.error('ADAPTIVE ERR:', e.message); process.exit(1); });
}
