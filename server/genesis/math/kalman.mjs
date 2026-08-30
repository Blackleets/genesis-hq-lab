// server/genesis/math/kalman.mjs
// Scalar Kalman filter for a noisy mid (or microprice). Pure. No I/O.
// State: random-walk fair value x_t = x_{t-1} + w, z_t = x_t + v.
// Used as the reservation-price center for GLFT quotes.

export function createKalman({ q = 1e-6, r = 1e-4, x0 = null, p0 = 1 } = {}) {
  let x = Number.isFinite(x0) ? x0 : null;
  let p = Number.isFinite(p0) && p0 > 0 ? p0 : 1;
  const Q = Number.isFinite(q) && q > 0 ? q : 1e-6;
  const R = Number.isFinite(r) && r > 0 ? r : 1e-4;
  return {
    update(z) {
      const meas = +z;
      if (!Number.isFinite(meas)) return x;
      if (x === null) {
        x = meas;
        p = R;
        return x;
      }
      const pPred = p + Q;
      const k = pPred / (pPred + R);
      x = x + k * (meas - x);
      p = (1 - k) * pPred;
      return x;
    },
    get state() { return { x, p }; },
  };
}

/** Fair value = Kalman(mid) + alpha * imbalance. Imbalance in [-1, 1]. */
export function fairValue(kalman, mid, imbalance = 0, alpha = 0) {
  const fv = kalman.update(mid);
  const imb = Number.isFinite(imbalance) ? Math.max(-1, Math.min(1, imbalance)) : 0;
  const a = Number.isFinite(alpha) ? alpha : 0;
  if (!Number.isFinite(fv)) return mid;
  return fv + a * imb * mid;
}
