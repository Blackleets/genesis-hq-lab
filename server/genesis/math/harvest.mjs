// server/genesis/math/harvest.mjs
// Expected maker harvest AFTER fees and adverse selection. PAPER. Pure.
//
//   H = spreadBps * twoSidedProb - 2*makerFeeBps - asBps - invBps
//
// Quote iff H >= minEdge and VPIN < halt. VPIN in (0.5, halt) widens the
// AS tax (you demand more spread for the same flow). H≤0 ⇒ do not quote.
// This cannot mint a 6-gate GO. It can only refuse a name.

export const VPIN_WIDEN = 0.5;
export const VPIN_HALT = 0.7;
export const DEFAULT_TWO_SIDED = 0.35; // conservative: most quotes die one-sided
export const DEFAULT_MIN_EDGE_BPS = 0.5;

/**
 * @param {object} p
 * @returns {{harvestBps:number, quote:boolean, reason:string, feeBps:number, asBps:number, widen:number}}
 */
export function harvestScore({
  spreadBps,
  makerFeePct = 0.0002,
  asBps = 0,
  invBps = 0,
  twoSidedProb = DEFAULT_TWO_SIDED,
  vpin = 0,
  vpinHalt = VPIN_HALT,
  vpinWiden = VPIN_WIDEN,
  minEdgeBps = DEFAULT_MIN_EDGE_BPS,
} = {}) {
  const vp = Math.max(0, Math.min(1, +vpin || 0));
  const halt = Number.isFinite(+vpinHalt) ? +vpinHalt : VPIN_HALT;
  if (vp >= halt) {
    return {
      harvestBps: Number.NEGATIVE_INFINITY,
      quote: false,
      reason: 'VPIN_HALT',
      feeBps: 2 * Math.max(0, +makerFeePct || 0) * 10000,
      asBps: Math.max(0, +asBps || 0),
      widen: 1,
    };
  }
  const feeBps = 2 * Math.max(0, +makerFeePct || 0) * 10000;
  const widen = vp > (Number.isFinite(+vpinWiden) ? +vpinWiden : VPIN_WIDEN) ? 1.5 : 1;
  const as = Math.max(0, +asBps || 0) * widen;
  const spread = Number.isFinite(+spreadBps) ? +spreadBps : 0;
  const p2 = Math.max(0, Math.min(1, +twoSidedProb || 0));
  const inv = Math.max(0, +invBps || 0);
  const h = spread * p2 - feeBps - as - inv;
  const minE = Number.isFinite(+minEdgeBps) ? +minEdgeBps : DEFAULT_MIN_EDGE_BPS;
  const finite = Number.isFinite(h);
  const quote = finite && h >= minE;
  return {
    harvestBps: finite ? h : Number.NEGATIVE_INFINITY,
    quote,
    reason: quote ? 'HARVEST' : 'H_LE_EDGE',
    feeBps,
    asBps: as,
    widen,
  };
}

/** Sort candidates that passed quote=true by harvest, descending. */
export function rankHarvest(rows) {
  const list = Array.isArray(rows) ? rows.slice() : [];
  list.sort((a, b) => (b.harvestBps ?? -Infinity) - (a.harvestBps ?? -Infinity));
  return list;
}
