// optimizer.mjs — the "training" core. Pure search logic over strategy params.
// I/O (fetching klines, running backtests, saving params) lives in runOptimizer.mjs;
// here everything takes an injected `evaluate(params) → metrics` so it's testable.

/**
 * Score a metrics object. Higher is better. Rewards expectancy and trade count
 * (statistical significance), penalizes drawdown. Disqualifies thin samples.
 */
export function objective(m, { minTrades = 20, ddWeight = 100 } = {}) {
  if (!m || m.trades < minTrades) return -Infinity;
  const reward = m.expectancy * Math.sqrt(m.trades);
  const penalty = Math.max(0, m.maxDrawdown) * ddWeight;
  return reward - penalty;
}

/**
 * Coordinate candidate generation: the base config plus, for each dimension,
 * the base with that one dimension swapped to each space value.
 */
export function generateCandidates(base, space) {
  const out = [{ ...base }];
  const seen = new Set([JSON.stringify(base)]);
  for (const key of Object.keys(space)) {
    for (const value of space[key]) {
      const cand = { ...base, [key]: value };
      const sig = JSON.stringify(cand);
      if (!seen.has(sig)) { seen.add(sig); out.push(cand); }
    }
  }
  return out;
}

/** Evaluate every candidate and return the highest-scoring one (or null). */
export function optimize({ candidates, evaluate, minTrades = 20, ddWeight = 100 }) {
  let best = { params: null, score: -Infinity, metrics: null };
  for (const params of candidates) {
    const metrics = evaluate(params);
    const score = objective(metrics, { minTrades, ddWeight });
    if (score > best.score) best = { params, score, metrics };
  }
  return best;
}

/**
 * Greedy coordinate descent: repeatedly improve one dimension at a time.
 * Returns the best params found and its metrics.
 */
export function coordinateDescent({ base, space, evaluate, rounds = 2, minTrades = 20, ddWeight = 100 }) {
  let current = { ...base };
  let currentScore = objective(evaluate(current), { minTrades, ddWeight });
  let currentMetrics = evaluate(current);

  for (let r = 0; r < rounds; r++) {
    const candidates = generateCandidates(current, space);
    const best = optimize({ candidates, evaluate, minTrades, ddWeight });
    if (best.params && best.score > currentScore) {
      current = best.params;
      currentScore = best.score;
      currentMetrics = best.metrics;
    } else {
      break; // no improvement this round
    }
  }
  return { params: current, score: currentScore, metrics: currentMetrics };
}

/**
 * Walk-forward adoption guard. Compares candidate vs current on the SAME
 * (out-of-sample) evaluator. Adopts only when the candidate strictly beats
 * current AND has a positive, significant edge — the anti-overfit safety.
 */
export function shouldAdopt({ current, candidate, evaluate, minTrades = 20, ddWeight = 100 }) {
  const candMetrics = evaluate(candidate);
  const curMetrics  = evaluate(current);
  const candScore = objective(candMetrics, { minTrades, ddWeight });
  const curScore  = objective(curMetrics, { minTrades, ddWeight });

  const positive = candMetrics && candMetrics.expectancy > 0 && candMetrics.trades >= minTrades;
  const adopt = positive && candScore > curScore;

  return {
    adopt,
    candScore,
    curScore,
    candMetrics,
    curMetrics,
    reason: adopt
      ? 'candidate beats current out-of-sample with positive expectancy'
      : !positive
        ? 'candidate lacks positive significant out-of-sample edge'
        : 'candidate does not beat current out-of-sample',
  };
}
