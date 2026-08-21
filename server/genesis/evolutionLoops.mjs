// server/genesis/evolutionLoops.mjs
// Applies /prompt-evolution-loops: a population-based strategy search.
// Mission -> population seeding -> evaluation -> mutation of elites -> loop.
// Determinism first: evaluation uses REAL backtests; no LLM required to run.
// Compatible with real agents (Hermes/Claude) as an optional evaluator later.

import { makeStrategy } from './strategyLib.mjs';
import { fullReport } from './backtestCore.mjs';

const STRATEGY_KINDS = ['meanReversion', 'breakout', 'momentum'];

function randParamSpace(kind) {
  if (kind === 'meanReversion') return {
    rsiPeriod: 14, rsiLow: 28 + Math.floor(Math.random() * 10), rsiHigh: 64 + Math.floor(Math.random() * 10),
    bbPeriod: 20, bbMult: 2, slMult: 1.2 + Math.round(Math.random() * 2) / 2, tpMult: 1.5 + Math.round(Math.random() * 2) / 2,
    atrMinPct: 0.002 + Math.round(Math.random() * 4) / 1000,
  };
  if (kind === 'breakout') return {
    donchianPeriod: 10 + Math.floor(Math.random() * 30), slMult: 1.2 + Math.round(Math.random() * 2) / 2,
    tpMult: 1.5 + Math.round(Math.random() * 2) / 2, atrMinPct: 0.002 + Math.round(Math.random() * 4) / 1000,
  };
  return { fast: 9, slow: 21, slMult: 1.2 + Math.round(Math.random() * 2) / 2, tpMult: 1.5 + Math.round(Math.random() * 2) / 2, atrMinPct: 0.002 + Math.round(Math.random() * 4) / 1000 };
}

function mutate(params) {
  const p = { ...params };
  const keys = Object.keys(p).filter(k => typeof p[k] === 'number');
  const k = keys[Math.floor(Math.random() * keys.length)];
  if (/Mult|atrMinPct|rsi|bb|donchian|fast|slow/.test(k)) {
    if (k === 'slMult' || k === 'tpMult') p[k] = Math.max(1.0, p[k] + (Math.random() < 0.5 ? -0.25 : 0.25));
    else if (k === 'atrMinPct') p[k] = Math.max(0.001, +(p[k] + (Math.random() < 0.5 ? -0.001 : 0.001)).toFixed(4));
    else if (/Period|fast|slow/.test(k)) p[k] = Math.max(5, p[k] + (Math.random() < 0.5 ? -2 : 2));
    else if (/rsiLow|rsiHigh|bbMult/.test(k)) p[k] = Math.max(10, p[k] + (Math.random() < 0.5 ? -2 : 2));
  }
  return p;
}

function score(metrics) {
  // Weighted, gate-aware fitness. Penalize drawdown hard.
  // Guard against tiny samples inflating PF/WR.
  if (metrics.trades < 30) return metrics.trades * 0.01; // near-zero until enough data
  let s = 0;
  if (metrics.profitFactor > 0 && isFinite(metrics.profitFactor)) s += Math.min(metrics.profitFactor, 5) * 10;
  if (metrics.winRate > 0) s += metrics.winRate * 20;
  s += metrics.tstat * 3;
  s += Math.min(metrics.expectancyPctPerTrade * 10, 10);
  s -= metrics.maxDrawdown * 60;
  s -= metrics.trades < 50 ? (50 - metrics.trades) * 0.5 : 0;
  return s;
}

export async function runEvolution({
  candles,
  generations = 8,
  populationSize = 18,
  eliteCount = 6,
  topN = 5,
  onGeneration = null,
  opts = {},
}) {
  // --- Mission schema ---
  const mission = {
    goal: 'Find a real-data strategy that passes all 6 Genesis gates',
    constraints: { costsIncluded: true, minTrades: 50, paperOnly: true },
    successCriteria: 'go === true (all 6 gates pass)',
  };

  // --- Seed population ---
  let population = [];
  for (let i = 0; i < populationSize; i++) {
    const kind = STRATEGY_KINDS[i % STRATEGY_KINDS.length];
    population.push({ kind, params: randParamSpace(kind) });
  }

  let history = [];
  let bestEver = null;

  for (let gen = 0; gen < generations; gen++) {
    // --- Evaluate generation (deterministic, real backtest) ---
    const evaluated = [];
    for (const ind of population) {
      const fn = makeStrategy(ind.kind, ind.params);
      const { metrics, gates } = fullReport(candles, fn, opts);
      const fitness = score(metrics);
      evaluated.push({ ...ind, metrics, gates, fitness });
    }
    evaluated.sort((a, b) => b.fitness - a.fitness);
    const elites = evaluated.slice(0, eliteCount);
    if (!bestEver || elites[0].fitness > bestEver.fitness) bestEver = elites[0];

    history.push({
      gen,
      bestFitness: +elites[0].fitness.toFixed(3),
      bestGo: elites[0].gates.go,
      bestMetrics: {
        pf: isFinite(elites[0].metrics.profitFactor) ? +elites[0].metrics.profitFactor.toFixed(2) : null,
        wr: +(elites[0].metrics.winRate * 100).toFixed(1),
        tstat: +elites[0].metrics.tstat.toFixed(2),
        dd: +(elites[0].metrics.maxDrawdown * 100).toFixed(1),
        trades: elites[0].metrics.trades,
      },
      passedGates: elites[0].gates.passed + '/' + elites[0].gates.total,
    });

    if (onGeneration) onGeneration(history[gen], elites[0]);

    // --- Loop controller: stop if GO achieved ---
    if (elites[0].gates.go) break;

    // --- Mutate elites + survivors to seed next generation ---
    const next = [];
    for (const e of elites) next.push({ kind: e.kind, params: { ...e.params } });
    while (next.length < populationSize) {
      const parent = elites[Math.floor(Math.random() * elites.length)];
      next.push({ kind: parent.kind, params: mutate(parent.params) });
    }
    population = next;
  }

  // --- Return top-N ranked candidates ready for human review ---
  const finalEvaluated = population.map(ind => {
    const fn = makeStrategy(ind.kind, ind.params);
    const { metrics, gates } = fullReport(candles, fn, opts);
    return { ...ind, metrics, gates, fitness: score(metrics) };
  }).sort((a, b) => b.fitness - a.fitness);

  const top = finalEvaluated.slice(0, topN).map(c => ({
    kind: c.kind, params: c.params,
    fitness: +c.fitness.toFixed(2),
    go: c.gates.go, passedGates: c.gates.passed + '/' + c.gates.total,
    metrics: {
      trades: c.metrics.trades, winRate: +(c.metrics.winRate * 100).toFixed(1),
      profitFactor: isFinite(c.metrics.profitFactor) ? +c.metrics.profitFactor.toFixed(2) : null,
      expectancyPct: +c.metrics.expectancyPctPerTrade.toFixed(3),
      tstat: +c.metrics.tstat.toFixed(2), maxDrawdownPct: +(c.metrics.maxDrawdown * 100).toFixed(1),
      returnPct: +(c.metrics.returnPct * 100).toFixed(1),
    },
    gates: c.gates.gates,
  }));

  return { mission, history, bestEver: bestEver ? { kind: bestEver.kind, params: bestEver.params, go: bestEver.gates.go, fitness: +bestEver.fitness.toFixed(2) } : null, top };
}
