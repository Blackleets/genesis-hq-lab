// server/genesis/evalCandidate.mjs
// One-shot evaluator for external optimizers (Optuna etc).
// Usage:
//   node evalCandidate.mjs <PAIR> <TF> <DAYS> <kind> '<paramsJson>'
// Prints a single JSON line: {fitness, go, gates, metrics:{...}, params}
// Candles are cached in data/candle_cache/ so repeated trials don't re-fetch.
//
// Fitness = same scoring as evolutionLoops (trades-weighted, penalizes tiny samples).

import { fetchKlines } from '../crypto/backtest/historicalData.mjs';
import { fullReport } from './backtestCore.mjs';
import { makeStrategy } from './strategyLib.mjs';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '../../data/candle_cache');

async function getCandles(pair, tf, days) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const key = `${pair}_${tf}_${days}d.json`;
  const file = path.join(CACHE_DIR, key);
  if (fs.existsSync(file)) {
    const age = Date.now() - fs.statSync(file).mtimeMs;
    if (age < 6 * 3600 * 1000) return JSON.parse(fs.readFileSync(file, 'utf8')); // 6h cache
  }
  const candles = await fetchKlines(pair, { days, interval: tf });
  fs.writeFileSync(file, JSON.stringify(candles));
  return candles;
}

function score(metrics) {
  // EXACT copy of evolutionLoops.score() — single source of truth for fitness.
  if (metrics.trades < 30) return metrics.trades * 0.01;
  let s = 0;
  if (metrics.profitFactor > 0 && isFinite(metrics.profitFactor)) s += Math.min(metrics.profitFactor, 5) * 10;
  if (metrics.winRate > 0) s += metrics.winRate * 20;
  s += metrics.tstat * 3;
  s += Math.min(metrics.expectancyPctPerTrade * 10, 10);
  s -= metrics.maxDrawdown * 60;
  s -= metrics.trades < 50 ? (50 - metrics.trades) * 0.5 : 0;
  return +s.toFixed(3);
}

async function main() {
  const rawArgs = process.argv.slice(2);
  // --protections flag (default OFF for backward compat): run the backtest
  // with simulated Freqtrade-style protections active during the simulation.
  const useProtections = rawArgs.includes('--protections');
  const DEFAULT_PROTECTIONS = { stoplossStreak: 3, cooldownCandles: 4, maxDrawdownPct: 0.15 };
  const [pair, tf, daysStr, kind, paramsJson] = rawArgs.filter(a => a !== '--protections');
  const days = parseInt(daysStr, 10);
  let params = {};
  try { params = JSON.parse(paramsJson || '{}'); } catch { console.error(JSON.stringify({ error: 'bad params json' })); process.exit(1); }
  try {
    const candles = await getCandles(pair, tf, days);
    const fn = makeStrategy(kind, params);
    const report = fullReport(candles, fn, useProtections ? { protections: DEFAULT_PROTECTIONS } : {});
    const out = {
      pair, tf, days, kind, params,
      protections: useProtections ? DEFAULT_PROTECTIONS : null,
      fitness: score(report.metrics),
      go: report.gates?.go ?? false,
      gates: report.gates ? `${report.gates.passed}/${report.gates.total}` : null,
      gateReason: report.gates?.reason ?? null,
      lookaheadViolations: Array.isArray(report.result?.lookaheadViolations) ? report.result.lookaheadViolations.length : 0,
      metrics: report.metrics,
    };
    console.log(JSON.stringify(out));
  } catch (e) {
    console.error(JSON.stringify({ error: e.message }));
    process.exit(1);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(JSON.stringify({ error: e.message })); process.exit(1); });
