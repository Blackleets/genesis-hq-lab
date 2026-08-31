// server/genesis/metaStrategyEvolve.mjs
// /prompt-evolution-loops applied at AGENT level: a meta-agent that GENERATES
// strategy candidate configs, a deterministic CRITIC scores them on real data,
// and a MUTATOR hybridizes elites. This is the "most powerful genesis" brain.
//
// It is orchestrator-only: it does NOT need an LLM to run (deterministic
// critic = real backtest). An optional LLM hook can replace generateStrategy()
// to produce novel configs from natural language missions.

import { makeStrategy } from './strategyLib.mjs';
import { fullReport } from './backtestCore.mjs';
import { STRATEGY_FACTORIES } from './strategyLib.mjs';

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// --- GENERATOR: produce a candidate from a mission + seed ---
export function generateStrategy(mission, rngState = Math.random) {
  const kinds = Object.keys(STRATEGY_FACTORIES);
  const kind = kinds[Math.floor(rngState() * kinds.length)];
  const r = (lo, hi) => lo + rngState() * (hi - lo);
  const base = {
    meanReversion: { rsiPeriod: 14, rsiLow: Math.round(r(25, 38)), rsiHigh: Math.round(r(62, 75)), bbPeriod: 20, bbMult: 2, slMult: +clamp(r(1.0, 3.0), 1.0, 3.0).toFixed(2), tpMult: +clamp(r(1.5, 3.0), 1.5, 3.0).toFixed(2), atrMinPct: +r(0.002, 0.01).toFixed(4), adxMax: Math.round(r(15, 35)) },
    breakout: { donchianPeriod: Math.round(r(8, 40)), slMult: +clamp(r(1.0, 3.0), 1.0, 3.0).toFixed(2), tpMult: +clamp(r(1.5, 3.0), 1.5, 3.0).toFixed(2), atrMinPct: +r(0.002, 0.01).toFixed(4) },
    momentum: { fast: 9, slow: 21, slMult: +clamp(r(1.0, 3.0), 1.0, 3.0).toFixed(2), tpMult: +clamp(r(1.5, 3.0), 1.5, 3.0).toFixed(2), atrMinPct: +r(0.002, 0.01).toFixed(4) },
  };
  return { kind, params: base[kind] };
}

// --- CRITIC: deterministic, real backtest, multi-dimension score ---
export function critic(candles, candidate) {
  const fn = makeStrategy(candidate.kind, candidate.params);
  const { metrics, gates } = fullReport(candles, fn);
  // dimensions: profitability, consistency, risk, sample, significance
  const dims = {
    profitability: clamp(metrics.profitFactor > 0 ? metrics.profitFactor : 0, 0, 3) / 3,
    consistency: metrics.winRate,
    risk: 1 - clamp(metrics.maxDrawdown / 0.25, 0, 1),
    sample: clamp(metrics.trades / 50, 0, 1),
    significance: clamp(metrics.tstat / 2, 0, 1),
  };
  const fitness = dims.profitability * 40 + dims.consistency * 20 + dims.risk * 20 + dims.sample * 10 + dims.significance * 10;
  return { dims, fitness: +fitness.toFixed(3), metrics, gates, go: gates.go };
}

// --- MUTATOR: hybridize two elites or perturb one ---
export function mutate(candidate, rngState = Math.random, mutationRate = 0.4) {
  const p = JSON.parse(JSON.stringify(candidate.params));
  const keys = Object.keys(p);
  for (const k of keys) {
    if (typeof p[k] !== 'number') continue;
    if (rngState() < mutationRate) {
      const step = (rngState() - 0.5) * (k === 'donchianPeriod' || k === 'rsiPeriod' || k === 'fast' || k === 'slow' || k === 'bbPeriod' ? 4 : 0.2);
      if (k === 'donchianPeriod' || k === 'rsiPeriod' || k === 'fast' || k === 'slow' || k === 'bbPeriod') p[k] = Math.round(p[k] + step);
      else p[k] = +clamp(p[k] + step, 0.001, 5).toFixed(k === 'atrMinPct' ? 4 : 2);
    }
  }
  return { kind: candidate.kind, params: p };
}

export function hybridize(a, b, rngState = Math.random) {
  if (a.kind === b.kind) {
    const p = { ...a.params };
    for (const k of Object.keys(p)) if (typeof p[k] === 'number' && rngState() < 0.5) p[k] = b.params[k];
    return { kind: a.kind, params: p };
  }
  return rngState() < 0.5 ? a : b;
}

export async function runMetaEvolution({ candles, generations = 8, populationSize = 16, eliteCount = 5, maxRounds = 12, onRound = null, opts = {} }) {
  const seeded = Array.from({ length: populationSize }, () => generateStrategy('seed'));
  let population = seeded.map(c => ({ ...c, ...critic(candles, c) }));
  const history = [];
  let best = population.reduce((b, c) => (c.fitness > b.fitness ? c : b));

  for (let gen = 0; gen < generations; gen++) {
    population.sort((a, b) => b.fitness - a.fitness);
    const elites = population.slice(0, eliteCount);
    if (elites[0].fitness > best.fitness) best = elites[0];

    const next = [];
    for (const e of elites) next.push(e);
    while (next.length < populationSize) {
      const parent = elites[Math.floor(Math.random() * elites.length)];
      const partner = elites[Math.floor(Math.random() * elites.length)];
      if (Math.random() < 0.3) next.push(hybridize({ kind: parent.kind, params: parent.params }, { kind: partner.kind, params: partner.params }));
      else next.push(mutate({ kind: parent.kind, params: parent.params }));
    }
    next.forEach(c => { const r = critic(candles, c); c.fitness = r.fitness; c.metrics = r.metrics; c.gates = r.gates; c.go = r.go; c.dims = r.dims; });
    population = next;

    const roundInfo = { gen, bestFitness: +best.fitness.toFixed(2), bestGo: best.go, bestPF: isFinite(best.metrics.profitFactor) ? +best.metrics.profitFactor.toFixed(2) : null, bestWR: +(best.metrics.winRate * 100).toFixed(1) };
    history.push(roundInfo);
    if (onRound) onRound(roundInfo);
    if (best.go) break;
  }

  population.sort((a, b) => b.fitness - a.fitness);
  return {
    mission: 'Evolve a real-data strategy that passes all 6 Genesis gates',
    history,
    best: { kind: best.kind, params: best.params, fitness: +best.fitness.toFixed(2), go: best.go, metrics: { trades: best.metrics.trades, winRate: +(best.metrics.winRate * 100).toFixed(1), profitFactor: isFinite(best.metrics.profitFactor) ? +best.metrics.profitFactor.toFixed(2) : null, expectancyPct: +best.metrics.expectancyPctPerTrade.toFixed(3), tstat: +best.metrics.tstat.toFixed(2), maxDrawdownPct: +(best.metrics.maxDrawdown * 100).toFixed(1) }, gates: best.gates.gates },
    population: population.slice(0, 5).map(c => ({ kind: c.kind, params: c.params, fitness: c.fitness, go: c.go, pf: isFinite(c.metrics.profitFactor) ? +c.metrics.profitFactor.toFixed(2) : null, wr: +(c.metrics.winRate * 100).toFixed(1) })),
  };
}
