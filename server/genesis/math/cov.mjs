// server/genesis/math/cov.mjs
// Ledoit–Wolf constant-correlation shrinkage + eigenvalue-floored inverse.
// Multi-asset Kelly needs a well-conditioned Σ. Pure. No I/O.

function colMeans(rows) {
  const n = rows.length;
  const d = rows[0].length;
  const mu = new Array(d).fill(0);
  for (const r of rows) for (let j = 0; j < d; j++) mu[j] += r[j];
  for (let j = 0; j < d; j++) mu[j] /= n;
  return mu;
}

export function sampleCov(rows) {
  const n = rows.length;
  if (!n) return [];
  const d = rows[0].length;
  const mu = colMeans(rows);
  const S = Array.from({ length: d }, () => new Array(d).fill(0));
  for (const r of rows) {
    for (let i = 0; i < d; i++) {
      const di = r[i] - mu[i];
      for (let j = 0; j < d; j++) S[i][j] += di * (r[j] - mu[j]);
    }
  }
  const denom = Math.max(1, n - 1);
  for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) S[i][j] /= denom;
  return S;
}

function constantCorrTarget(S) {
  const d = S.length;
  const var_ = S.map((row, i) => Math.max(1e-18, row[i]));
  const sd = var_.map(Math.sqrt);
  let rhoSum = 0, nOff = 0;
  for (let i = 0; i < d; i++) {
    for (let j = i + 1; j < d; j++) {
      rhoSum += S[i][j] / (sd[i] * sd[j]);
      nOff++;
    }
  }
  const rho = nOff ? rhoSum / nOff : 0;
  const F = Array.from({ length: d }, () => new Array(d).fill(0));
  for (let i = 0; i < d; i++) {
    F[i][i] = var_[i];
    for (let j = i + 1; j < d; j++) {
      const v = rho * sd[i] * sd[j];
      F[i][j] = v;
      F[j][i] = v;
    }
  }
  return F;
}

/**
 * Ledoit–Wolf intensity toward constant-correlation target.
 * If intensity omitted, use a conservative 0.4 (research starting point 0.3–0.7).
 */
export function ledoitWolf(rows, intensity) {
  const S = sampleCov(rows);
  if (!S.length) return S;
  const F = constantCorrTarget(S);
  const d = S.length;
  let delta = intensity;
  if (!Number.isFinite(delta)) {
    // Cheap intensity: more shrink when N/T is high (d/n).
    const n = rows.length;
    delta = Math.max(0.2, Math.min(0.8, d / Math.max(1, n)));
  }
  delta = Math.max(0, Math.min(1, delta));
  const out = Array.from({ length: d }, () => new Array(d).fill(0));
  for (let i = 0; i < d; i++) {
    for (let j = 0; j < d; j++) out[i][j] = (1 - delta) * S[i][j] + delta * F[i][j];
  }
  return out;
}

function identity(d) {
  const I = Array.from({ length: d }, () => new Array(d).fill(0));
  for (let i = 0; i < d; i++) I[i][i] = 1;
  return I;
}

/** Invert via Gauss-Jordan with eigenvalue-style diagonal floor. */
export function inverseCapped(M, floor = 1e-8) {
  const d = M.length;
  const A = M.map((row, i) => row.map((v, j) => (i === j ? Math.max(v, floor) : v)));
  const I = identity(d);
  for (let col = 0; col < d; col++) {
    let piv = col;
    for (let r = col + 1; r < d; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < floor) {
      A[piv][col] = floor;
    }
    if (piv !== col) {
      [A[col], A[piv]] = [A[piv], A[col]];
      [I[col], I[piv]] = [I[piv], I[col]];
    }
    const div = A[col][col];
    for (let j = 0; j < d; j++) { A[col][j] /= div; I[col][j] /= div; }
    for (let r = 0; r < d; r++) {
      if (r === col) continue;
      const f = A[r][col];
      for (let j = 0; j < d; j++) { A[r][j] -= f * A[col][j]; I[r][j] -= f * I[col][j]; }
    }
  }
  return I;
}
