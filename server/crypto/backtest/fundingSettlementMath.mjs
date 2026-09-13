// Pure funding-settlement math shared by PAPER funding research.
// Positive perpetual funding means LONGS pay SHORTS.
// Negative perpetual funding means SHORTS pay LONGS.
// No intra-period accrual is represented here: PnL is recognized only when a
// real funding settlement is observed by the caller.

export const FUNDING_RECEIVE_THRESHOLD = 0.0001;

export function sideForFunding(rate, threshold = FUNDING_RECEIVE_THRESHOLD) {
  const fundingRate = Number(rate);
  if (!Number.isFinite(fundingRate)) return null;
  if (fundingRate > threshold) return 'SHORT_PERP_LONG_SPOT';
  if (fundingRate < -threshold) return 'LONG_PERP_SHORT_SPOT';
  return null;
}

export function fundingSettlementPnl({ rate, notional, side } = {}) {
  const fundingRate = Number(rate);
  const capital = Number(notional);
  if (!Number.isFinite(fundingRate) || !Number.isFinite(capital) || capital < 0) return null;
  if (side === 'SHORT_PERP_LONG_SPOT') return fundingRate * capital;
  if (side === 'LONG_PERP_SHORT_SPOT') return -fundingRate * capital;
  return null;
}
