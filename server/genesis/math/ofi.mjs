// server/genesis/math/ofi.mjs
// Microstructure signals. Pure. L2 when available; OHLCV proxy otherwise.
// Stoikov (2018) microprice: (ask*bidSz + bid*askSz) / (bidSz+askSz)
// OFI imbalance: (bidSz - askSz) / (bidSz + askSz)

export function microprice({ bid, ask, bidSz, askSz }) {
  const b = +bid, a = +ask, bs = +bidSz, as = +askSz;
  if (![b, a, bs, as].every(Number.isFinite) || b <= 0 || a <= 0) return null;
  const den = bs + as;
  if (!(den > 0)) return (b + a) / 2;
  return (a * bs + b * as) / den;
}

export function bookImbalance({ bidSz, askSz }) {
  const bs = +bidSz, as = +askSz;
  if (!Number.isFinite(bs) || !Number.isFinite(as)) return 0;
  const den = bs + as;
  if (!(den > 0)) return 0;
  return (bs - as) / den;
}

/**
 * Causal OHLCV pressure proxy (no L2): close vs bar extremes.
 * Positive = buying pressure. Uses candle i only (no future).
 */
export function barPressure(open, high, low, close) {
  const o = +open, h = +high, l = +low, c = +close;
  if (![o, h, l, c].every(Number.isFinite)) return 0;
  const range = h - l;
  if (!(range > 0)) return 0;
  return ((c - l) - (h - c)) / range;
}

export function ewma(prev, value, alpha = 0.2) {
  if (!Number.isFinite(value)) return prev;
  if (!Number.isFinite(prev)) return value;
  const a = Number.isFinite(alpha) && alpha > 0 && alpha <= 1 ? alpha : 0.2;
  return a * value + (1 - a) * prev;
}
