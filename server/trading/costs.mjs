// costs.mjs — Polymarket realistic cost model for paper trading.
// Every function is pure (no I/O, no DB) so it's trivially testable.
// Apply to every paper fill so PnL reflects what real execution would capture.
//
// Sources:
//   Fee:      Polymarket Terms of Service — 2% of winnings
//   Slippage: empirical observation of Polymarket CLOB fills at various sizes

const POLYMARKET_FEE_RATE = 0.02; // 2% of gross winnings

/**
 * Estimate price slippage as a fraction (0..1) based on order size vs daily volume.
 * @param {number} orderSizeUsd  — dollars being placed
 * @param {number} volume24hUsd  — market's 24h volume in dollars
 * @returns {number} slippage fraction, e.g. 0.01 = 1%
 */
export function computeSlippage(orderSizeUsd, volume24hUsd) {
  if (orderSizeUsd <= 0) return 0;      // zero-capital order has zero market impact
  if (volume24hUsd <= 0) return 0.02;  // no volume data → assume worst case
  const sizeRatio = orderSizeUsd / volume24hUsd;
  if (sizeRatio < 0.005) return 0.005;  // tiny order: ~0.5%
  if (sizeRatio < 0.02)  return 0.01;   // medium order: ~1%
  return 0.02;                           // large order: ~2%
}

/**
 * Apply slippage to an entry price (buying makes fills worse — price goes up).
 * @param {number} quotedPrice  — price shown in the order book
 * @param {number} slippage     — fraction from computeSlippage()
 * @returns {number} effective fill price
 */
export function applySlippageToPrice(quotedPrice, slippage) {
  return Math.min(0.99, quotedPrice * (1 + slippage));
}

/**
 * Polymarket fee = 2% of gross winnings. Zero on losses.
 * @param {number} entryPrice  — effective fill price (after slippage)
 * @param {number} shares
 * @param {boolean} won        — true if the outcome we bet on resolved correctly
 * @returns {number} fee in dollars
 */
export function computePolymarketFee(entryPrice, shares, won) {
  if (!won) return 0;
  const grossWinnings = (1 - entryPrice) * shares;
  return grossWinnings * POLYMARKET_FEE_RATE;
}

/**
 * Net PnL for a resolved paper trade (gross payout minus Polymarket fee).
 * @param {{ capitalUsed: number, shares: number, entryPrice: number, won: boolean }} trade
 * @returns {number} net PnL in dollars (negative = loss)
 */
export function netPnl({ capitalUsed, shares, entryPrice, won }) {
  if (!won) return -capitalUsed;
  const grossWinnings = (1 - entryPrice) * shares;
  const fee = grossWinnings * POLYMARKET_FEE_RATE; // avoid double-compute via computePolymarketFee
  return grossWinnings - fee;
}

/**
 * Compute effective fill price and effective capital for a new paper order.
 * Used by execution.mjs to record realistic fills.
 * @param {{ entryPrice: number, shares: number, capitalUsed: number, volume24h?: number }} proposal
 * @returns {{ effectivePrice: number, effectiveShares: number, effectiveCapital: number, slippage: number, costNote: string }}
 */
export function computePaperFillCosts(proposal) {
  const volume24h = proposal.volume24h ?? 5000;
  const slippage = computeSlippage(proposal.capitalUsed, volume24h);
  const effectivePrice = applySlippageToPrice(proposal.entryPrice, slippage);
  // Shares re-derived from effective price (same capital, worse price → fewer shares)
  const effectiveShares = Math.floor(proposal.capitalUsed / effectivePrice);
  const effectiveCapital = effectiveShares * effectivePrice;
  return {
    effectivePrice,
    effectiveShares,
    effectiveCapital: Math.round(effectiveCapital * 100) / 100,
    slippage,
    costNote: `slippage ${(slippage * 100).toFixed(1)}% → fill @ ${effectivePrice.toFixed(4)} (quoted ${proposal.entryPrice.toFixed(4)})`,
  };
}
