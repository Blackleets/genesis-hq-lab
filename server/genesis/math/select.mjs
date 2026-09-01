// Glosten–Milgrom prior: a wide quoted spread is information, not harvest.
// Maker round-trip at OKX SWAP listed maker 2bps: 2*2 = 4bps.
// H_pre = spread * 0.35 - 4. Needs spread ≳ 13bps to clear +0.5 min edge.
// Names with spread ≳ 13bps are the toxic tail. Intersection with
// a non-toxic band (2–12bps) is often empty — then the desk quotes 0.
// This is not a fitted edge. It is the fee algebra.

export const TWO_SIDED = 0.35;
export const MAKER_ROUND_BPS = 4; // 2 * 0.0002 * 1e4
export const MIN_EDGE_BPS = 0.5;
export const BAND_LO = 2;
export const BAND_HI = 12; // beyond: toxicity prior dominates
export const SPREAD_TOX = 8;

export function preH(spreadBps) {
  const s = Number.isFinite(+spreadBps) ? +spreadBps : 0;
  return s * TWO_SIDED - MAKER_ROUND_BPS;
}

export function inMakerBand(spreadBps) {
  const s = +spreadBps;
  return Number.isFinite(s) && s >= BAND_LO && s <= BAND_HI;
}

/** Higher is better. Negative H still ranks inside the band (honest: will H_LE_EDGE). */
export function selectScore({ spread, notional }) {
  if (!(+notional >= 1e6)) return Number.NEGATIVE_INFINITY;
  if (!inMakerBand(spread)) return Number.NEGATIVE_INFINITY;
  const h = preH(spread);
  const logN = Math.log(1 + notional / 1e6);
  const tox = 1 + (spread / SPREAD_TOX) ** 2;
  return (h * logN) / tox;
}

export function intersection(rows) {
  const liq = (rows || []).filter((s) => +s.notional >= 1e6);
  let hGe = 0;
  let band = 0;
  let both = 0;
  for (const s of liq) {
    const h = preH(s.spread);
    const b = inMakerBand(s.spread);
    if (h >= MIN_EDGE_BPS) hGe += 1;
    if (b) band += 1;
    if (h >= MIN_EDGE_BPS && b) both += 1;
  }
  return { liquid: liq.length, hGe, band, both };
}
