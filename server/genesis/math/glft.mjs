// server/genesis/math/glft.mjs
// Infinite-horizon Guéant–Lehalle–Fernandez-Tapia quotes (perps have no T).
// Closed-form approx (HFTBacktest / GLFT 2012), σ as RELATIVE vol per bar:
//   c1 = (1/γ) ln(1 + γ/k)
//   c2 = sqrt( (γ / (2 A k)) (1+γ/k)^{k/γ + 1} )
//   halfRel = (c1 + 0.5 c2) σ · regimeMult
//   δ_b = halfRel + q σ c2
//   δ_a = halfRel − q σ c2
// Inventory q in [-1, 1]. Spread floored by 2*makerFee + minEdge.
// At |q| ≥ Q quote one side only. PAPER. Maker-only.

const EPS = 1e-12;

export function glftCoeffs({ gamma = 0.1, k = 1.5, A = 1.0 } = {}) {
  const g = Math.max(EPS, +gamma || 0.1);
  const kappa = Math.max(EPS, +k || 1.5);
  const intensity = Math.max(EPS, +A || 1);
  const c1 = (1 / g) * Math.log(1 + g / kappa);
  const inner = (g / (2 * intensity * kappa)) * Math.pow(1 + g / kappa, kappa / g + 1);
  const c2 = Math.sqrt(Math.max(0, inner));
  return { c1, c2, gamma: g, k: kappa, A: intensity };
}

/**
 * @param {object} p
 * @param {number} p.fair   reservation center (Kalman / microprice)
 * @param {number} p.sigma  relative vol per bar (e.g. EWMA |log return|)
 * @param {number} p.q      inventory in [-1, 1], + = long
 * @param {number} [p.makerFee=0.0002]
 * @param {number} [p.minEdgeBps=1]
 * @param {number} [p.regimeMult=1] HIGH_VOL widens
 * @param {number} [p.qMax=1] |q|>=qMax → one-sided
 */
export function glftQuotes({
  fair,
  sigma,
  q = 0,
  makerFee = 0.0002,
  minEdgeBps = 1,
  regimeMult = 1,
  qMax = 1,
  gamma = 0.1,
  k = 1.5,
  A = 1.0,
} = {}) {
  const s = +fair;
  if (!Number.isFinite(s) || s <= 0) return null;
  const sig = Math.max(0, Number.isFinite(+sigma) ? +sigma : 0);
  const inv = Math.max(-1, Math.min(1, Number.isFinite(+q) ? +q : 0));
  const { c1, c2 } = glftCoeffs({ gamma, k, A });
  const rm = Math.max(1, +regimeMult || 1);
  const halfRel = (c1 * sig + 0.5 * sig * c2) * rm;
  const skewRel = sig * c2 * inv;
  let deltaBid = halfRel + skewRel;
  let deltaAsk = halfRel - skewRel;
  const feeFloorRel = 2 * Math.max(0, +makerFee || 0);
  const edgeFloorRel = Math.max(0, +minEdgeBps || 0) / 10000;
  const floorRel = feeFloorRel + edgeFloorRel;
  const bidOff = Math.max(deltaBid, floorRel / 2);
  const askOff = Math.max(deltaAsk, floorRel / 2);
  let bid = s * (1 - bidOff);
  let ask = s * (1 + askOff);
  if (!(ask > bid)) {
    bid = s * (1 - floorRel / 2);
    ask = s * (1 + floorRel / 2);
  }
  const limit = Math.max(EPS, +qMax || 1);
  let postBid = true;
  let postAsk = true;
  if (inv >= limit) postBid = false;
  if (inv <= -limit) postAsk = false;
  return {
    fair: s,
    bid,
    ask,
    spread: ask - bid,
    spreadBps: ((ask - bid) / s) * 10000,
    postBid,
    postAsk,
    q: inv,
    halfSpreadRel: halfRel,
    skewRel,
  };
}

/** Dual EWMA vol. HIGH_VOL if short/long > 1.5 (Aliipou mm-live). */
export function volRegime(sigmaShort, sigmaLong, ratio = 1.5) {
  const ss = Math.max(EPS, +sigmaShort || EPS);
  const sl = Math.max(EPS, +sigmaLong || EPS);
  const r = ss / sl;
  return { ratio: r, highVol: r > ratio, regimeMult: r > ratio ? Math.min(3, r) : 1 };
}
