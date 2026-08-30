// server/genesis/math/kelly.mjs
// Fractional Kelly with CVaR haircut. Ceiling, not a target.
// Full Kelly blows up under fat tails / estimation error.
// Desk default: 0.25–0.50 Kelly, then min(that, cvarBudget / cvar).
// If mean <= 0, size is 0. Cap at 25% of capital per name.

import { inverseCapped, ledoitWolf } from './cov.mjs';
import { cvar, mean, variance } from './stats.mjs';

export const KELLY_FRACTION_MIN = 0.25;
export const KELLY_FRACTION_MAX = 0.50;
export const NAME_CAP = 0.25;

export function singleAssetKelly(pnls, { fraction = 0.25, cvarBudget = 0.02 } = {}) {
  const mu = mean(pnls);
  if (!(mu > 0)) return { f: 0, fStar: 0, reason: 'NONPOSITIVE_MEAN' };
  const v = variance(pnls, 1);
  const fStar = v > 0 ? mu / v : 0;
  const frac = Math.max(KELLY_FRACTION_MIN, Math.min(KELLY_FRACTION_MAX, +fraction || 0.25));
  let f = fStar * frac;
  const tail = cvar(pnls, 0.05);
  if (tail > 0 && Number.isFinite(cvarBudget) && cvarBudget > 0) {
    f *= Math.min(1, cvarBudget / tail);
  }
  f = Math.max(0, Math.min(NAME_CAP, f));
  return { f, fStar, fraction: frac, cvar: tail };
}

/**
 * Multi-asset: f* = Σ^{-1} μ, then fractional + name cap.
 * `rows` = T x N matrix of per-period returns. Nonpositive μ → weight 0.
 */
export function multiAssetKelly(rows, { fraction = 0.25 } = {}) {
  if (!rows?.length || !rows[0]?.length) return { weights: [], fStar: [] };
  const n = rows.length;
  const d = rows[0].length;
  const mu = new Array(d).fill(0);
  for (const r of rows) for (let j = 0; j < d; j++) mu[j] += r[j];
  for (let j = 0; j < d; j++) mu[j] /= n;
  const Sigma = ledoitWolf(rows);
  const inv = inverseCapped(Sigma);
  const fStar = new Array(d).fill(0);
  for (let i = 0; i < d; i++) {
    let s = 0;
    for (let j = 0; j < d; j++) s += inv[i][j] * mu[j];
    fStar[i] = s;
  }
  const frac = Math.max(KELLY_FRACTION_MIN, Math.min(KELLY_FRACTION_MAX, +fraction || 0.25));
  const weights = fStar.map((w, i) => {
    if (!(mu[i] > 0) && w > 0) return 0;
    if (!(mu[i] < 0) && w < 0) return 0;
    return Math.max(-NAME_CAP, Math.min(NAME_CAP, w * frac));
  });
  return { weights, fStar, mu };
}
