// positionMonitorCore.mjs — Pure exit condition logic.
// NO database dependency — safe to import in tests and from any context.

/**
 * Determine whether a single open position should be closed.
 * Pure function: no side effects, no I/O, no DB access.
 *
 * @param trade        — DB row: { outcome, opened_at, stop_price, target_price, days_to_close }
 * @param currentPrice — live price for the asset pair
 * @param riskBand     — global risk band string ('NORMAL'|'HIGH_RISK'|'CRITICAL')
 * @returns {{ shouldExit: boolean, reason: string|null, exitType: string|null }}
 */
export function checkExitConditions(trade, currentPrice, riskBand) {
  const isLong = trade.outcome === 'LONG';
  const ageMs  = Date.now() - new Date(trade.opened_at).getTime();
  const ageH   = ageMs / (1000 * 60 * 60);

  // 1. Risk close: CRITICAL system risk → force exit everything
  if (riskBand === 'CRITICAL') {
    return { shouldExit: true, reason: 'risk_close', exitType: 'risk' };
  }

  // 2. Stop loss
  if (trade.stop_price != null) {
    const slHit = isLong
      ? currentPrice <= trade.stop_price
      : currentPrice >= trade.stop_price;
    if (slHit) return { shouldExit: true, reason: 'stop_loss', exitType: 'sl' };
  }

  // 3. Take profit
  if (trade.target_price != null) {
    const tpHit = isLong
      ? currentPrice >= trade.target_price
      : currentPrice <= trade.target_price;
    if (tpHit) return { shouldExit: true, reason: 'take_profit', exitType: 'tp' };
  }

  // 4. Timeout
  if (trade.days_to_close != null) {
    const maxHours = trade.days_to_close * 24;
    if (ageH >= maxHours) return { shouldExit: true, reason: 'timeout', exitType: 'timeout' };
  }

  return { shouldExit: false, reason: null, exitType: null };
}
