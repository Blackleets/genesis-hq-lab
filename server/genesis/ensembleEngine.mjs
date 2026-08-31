// server/genesis/ensembleEngine.mjs
// Level-up: ENSEMBLE + REGIME-SWITCHING.
//
// Two improvements over the single-family adaptive engine:
//  1. ENSEMBLE: instead of deploying one family, combine signals from ALL 5
//     families via weighted vote (weight = recent OOS edge quality). More
//     robust than any single family (less overfit, smoother equity).
//  2. REGIME-SWITCHING: detect the GLOBAL market regime (BTC trend strength
//     via ADX + returns) and bias the ensemble toward trend-following
//     (breakout/momentum) in trending regimes, mean-reversion (MR/volumeProfile)
//     in ranging regimes. The learner picks the family MIX by regime.
//
// Plus CROSS-SECTIONAL: report what fraction of the universe is currently in a
// favorable regime — that fraction drives overall exposure (beta scaling).
//
// PAPER ONLY. REAL requires human GO + keys + confirm.

import { fetchKlines } from '../crypto/backtest/historicalData.mjs';
import { makeStrategy } from './strategyLib.mjs';
import { fullReport, adx } from './backtestCore.mjs';
import { runEvolution } from './evolutionLoops.mjs';
import { adaptiveStep } from './adaptiveEngine.mjs';

// Detect global regime from BTC: ADX>25 + directional return => trending.
async function detectRegime() {
  const btc = await fetchKlines('BTCUSDT', { days: 30, interval: '1h' });
  const close = btc.map(c => +c[4]);
  const adxArr = adx(btc, 14);
  const lastAdx = adxArr[adxArr.length - 1] || 20;
  const ret30 = (close[close.length - 1] - close[0]) / close[0];
  let regime = 'ranging';
  if (lastAdx > 25 && Math.abs(ret30) > 0.05) regime = ret30 > 0 ? 'uptrend' : 'downtrend';
  else if (lastAdx > 25) regime = 'trending';
  // family bias by regime
  const bias = regime === 'uptrend' || regime === 'downtrend' || regime === 'trending'
    ? { breakout: 1.4, momentum: 1.4, meanReversion: 0.7, volumeProfile: 0.9, orderbookImbalance: 1.0 }
    : { breakout: 0.8, momentum: 0.8, meanReversion: 1.4, volumeProfile: 1.4, orderbookImbalance: 1.0 };
  return { regime, lastAdx: +lastAdx.toFixed(1), ret30: +(ret30 * 100).toFixed(1), bias };
}

// Build ensemble weights for one pair from adaptive step across families.
async function ensembleWeights(pair, capital) {
  const candles = await fetchKlines(pair, { days: 120, interval: '1h' });
  if (candles.length < 400) return null;
  const { deployed } = await adaptiveStep({ candles, trainDays: 90, oosDays: 30, generations: 5 });
  if (!deployed.length) return null;
  // weight each deployed family by its OOS PF, apply regime bias
  const { regime } = await detectRegime();
  const bias = regime.bias;
  let wsum = 0; const w = {};
  for (const d of deployed) {
    const pf = d.oosMetrics.profitFactor || 1;
    const wt = Math.max(0, (pf - 1)) * (bias[d.kind] || 1);
    w[d.kind] = { weight: wt, params: d.params, pf, wr: d.oosMetrics.winRate };
    wsum += wt;
  }
  if (wsum === 0) return null;
  for (const k in w) w[k].weight = +(w[k].weight / wsum).toFixed(3);
  return { pair, regime: regime.regime, weights: w };
}

export async function runEnsembleScan({ pairs = null, capital = 1000, maxPairs = 20 } = {}) {
  console.log(`\n🎯 ENSEMBLE + REGIME SCAN (PAPER)`);
  const regime = await detectRegime();
  console.log(`Global regime: ${regime.regime} (BTC ADX=${regime.lastAdx}, 30d=${regime.ret30}%)`);
  console.log(`Family bias: ${JSON.stringify(regime.bias)}\n`);
  if (!pairs) {
    const { getUniverse } = await import('./learningLoop.mjs');
    pairs = (await getUniverse()).slice(0, 60);
  }
  const results = [];
  let favorable = 0;
  for (const pair of pairs.slice(0, maxPairs)) {
    const e = await ensembleWeights(pair, capital);
    if (e) { results.push(e); favorable++; }
  }
  console.log(`\n=== ENSEMBLE VERDICT ===`);
  console.log(`Pairs scanned: ${Math.min(pairs.length, maxPairs)} | with ensemble edge: ${favorable}`);
  console.log(`Cross-sectional favorable fraction: ${(favorable / Math.min(pairs.length, maxPairs) * 100).toFixed(0)}%`);
  console.log(`Regime: ${regime.regime} -> ${regime.regime.includes('trend') ? 'favoring breakout/momentum' : 'favoring mean-reversion/volumeProfile'}`);
  if (results.length) {
    for (const r of results.slice(0, 5)) {
      const fams = Object.entries(r.weights).map(([k, v]) => `${k}:${v.weight}`).join(' ');
      console.log(`  ✅ ${r.pair.padEnd(11)} [${r.regime}] ${fams}`);
    }
  } else console.log(`  ⏸ No pair has a weighted ensemble edge right now — engine waits.`);
  return { regime, results, favorableFraction: favorable / Math.min(pairs.length, maxPairs) };
}

if (process.argv[1] && process.argv[1].endsWith('ensembleEngine.mjs')) {
  runEnsembleScan({}).then(() => process.exit(0)).catch(e => { console.error('ERR', e.message); process.exit(1); });
}
