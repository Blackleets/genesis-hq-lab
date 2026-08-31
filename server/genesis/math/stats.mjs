// server/genesis/math/stats.mjs
// Non-normal diagnostics for trade PnL. Pure. No I/O.
// Jarque-Bera is DIAGNOSTIC only — never a promotion gate.
// Extra NO-GOs live in extraNoGos.mjs.

function finite(xs) {
  return (xs || []).map(Number).filter(Number.isFinite);
}

export function mean(xs) {
  const a = finite(xs);
  if (!a.length) return 0;
  return a.reduce((s, x) => s + x, 0) / a.length;
}

export function variance(xs, ddof = 0) {
  const a = finite(xs);
  if (a.length < 2) return 0;
  const m = mean(a);
  const d = a.reduce((s, x) => s + (x - m) ** 2, 0);
  return d / Math.max(1, a.length - ddof);
}

export function stdev(xs, ddof = 0) {
  return Math.sqrt(Math.max(0, variance(xs, ddof)));
}

export function median(xs) {
  const a = finite(xs).sort((x, y) => x - y);
  if (!a.length) return 0;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

export function quantile(xs, q) {
  const a = finite(xs).sort((x, y) => x - y);
  if (!a.length) return 0;
  const p = Math.max(0, Math.min(1, +q || 0));
  const idx = (a.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return a[lo];
  return a[lo] * (hi - idx) + a[hi] * (idx - lo);
}

/** Average of losses at or below the q-quantile (left tail). Positive number = loss magnitude. */
export function cvar(xs, q = 0.05) {
  const a = finite(xs);
  if (!a.length) return 0;
  const cut = quantile(a, q);
  const tail = a.filter(x => x <= cut);
  if (!tail.length) return Math.max(0, -cut);
  const m = mean(tail);
  return m < 0 ? -m : 0;
}

export function skewness(xs) {
  const a = finite(xs);
  if (a.length < 3) return 0;
  const m = mean(a);
  const s = stdev(a);
  if (!(s > 0)) return 0;
  return a.reduce((t, x) => t + ((x - m) / s) ** 3, 0) / a.length;
}

export function excessKurtosis(xs) {
  const a = finite(xs);
  if (a.length < 4) return 0;
  const m = mean(a);
  const s = stdev(a);
  if (!(s > 0)) return 0;
  return a.reduce((t, x) => t + ((x - m) / s) ** 4, 0) / a.length - 3;
}

/** Diagnostic only. Never used as a GO/NO-GO. */
export function jarqueBera(xs) {
  const a = finite(xs);
  const n = a.length;
  if (n < 8) return { jb: 0, n, diagnostic: true };
  const sk = skewness(a);
  const ku = excessKurtosis(a);
  const jb = (n / 6) * (sk * sk + (ku * ku) / 4);
  return { jb, skewness: sk, excessKurtosis: ku, n, diagnostic: true };
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Percentile bootstrap CI of the mean. Deterministic seed. */
export function bootstrapMeanCI(xs, { iters = 1000, alpha = 0.05, seed = 1 } = {}) {
  const a = finite(xs);
  const n = a.length;
  if (n < 5) return { lo: 0, hi: 0, mean: 0, n };
  const rng = mulberry32(seed);
  const means = new Array(iters);
  for (let i = 0; i < iters; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += a[(rng() * n) | 0];
    means[i] = s / n;
  }
  means.sort((x, y) => x - y);
  const loI = Math.floor((alpha / 2) * iters);
  const hiI = Math.min(iters - 1, Math.ceil((1 - alpha / 2) * iters) - 1);
  return { lo: means[loI], hi: means[hiI], mean: mean(a), n };
}

/**
 * Wilcoxon signed-rank vs 0 (two-sided normal approx with zeros dropped).
 * Returns {stat, z, pApprox, median}. pApprox is diagnostic; gate on median.
 */
export function wilcoxonSignedRank(xs) {
  const a = finite(xs).filter(x => x !== 0);
  const n = a.length;
  const med = median(xs);
  if (n < 10) return { stat: 0, z: 0, pApprox: 1, median: med, n };
  const ranked = a
    .map((v, i) => ({ abs: Math.abs(v), sign: Math.sign(v), i }))
    .sort((x, y) => x.abs - y.abs);
  let W = 0;
  for (let i = 0; i < ranked.length; i++) {
    const rank = i + 1;
    if (ranked[i].sign > 0) W += rank;
  }
  const meanW = n * (n + 1) / 4;
  const sdW = Math.sqrt(n * (n + 1) * (2 * n + 1) / 24);
  const z = sdW > 0 ? (W - meanW) / sdW : 0;
  const pApprox = 2 * (1 - 0.5 * (1 + Math.tanh(Math.abs(z) / Math.SQRT2))); // coarse
  return { stat: W, z, pApprox: Math.max(0, Math.min(1, pApprox)), median: med, n };
}
