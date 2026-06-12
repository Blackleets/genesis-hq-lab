// orderValidator.mjs — validates orders before paper or live execution.
// Always runs safety checks. Never allows malformed orders through.

import { checkSafetyLimits } from './polymarketSafety.mjs';
import { logEvent, SEVERITY } from '../../observability/eventTimeline.mjs';

/**
 * Validate an order request.
 *
 * @param {object} order
 * @param {string} order.marketId
 * @param {string} order.outcome - 'YES' or 'NO'
 * @param {number} order.amount  - USD
 * @param {'polymarket'|'kalshi'} [order.source]
 * @returns {{ ok: boolean, reason?: string, detail?: string, sanitized?: object }}
 */
export function validateOrder(order) {
  if (!order || typeof order !== 'object') {
    logEvent('PREDICTION', SEVERITY.WARNING, 'orderValidator', 'PREDICTION_ORDER_REJECTED', { reason: 'INVALID_REQUEST' });
    return { ok: false, reason: 'INVALID_REQUEST', detail: 'Order body is missing or not an object' };
  }

  // Safety limits check
  const safetyCheck = checkSafetyLimits(order);
  if (!safetyCheck.ok) {
    logEvent('PREDICTION', SEVERITY.WARNING, 'orderValidator', 'PREDICTION_ORDER_REJECTED', {
      reason: safetyCheck.reason,
      marketId: order.marketId,
      amount: order.amount,
    });
    return { ok: false, reason: safetyCheck.reason, detail: safetyCheck.detail, config: safetyCheck.config };
  }

  const source = order.source ?? 'polymarket';
  if (!['polymarket', 'kalshi'].includes(source)) {
    logEvent('PREDICTION', SEVERITY.WARNING, 'orderValidator', 'PREDICTION_ORDER_REJECTED', { reason: 'INVALID_SOURCE' });
    return { ok: false, reason: 'INVALID_SOURCE', detail: `source must be "polymarket" or "kalshi"` };
  }

  const sanitized = {
    marketId:  String(order.marketId).trim(),
    outcome:   order.outcome.toUpperCase(),
    amount:    Number(order.amount),
    source,
    strategy:  order.strategy ?? null,
    note:      order.note ?? null,
  };

  logEvent('PREDICTION', SEVERITY.INFO, 'orderValidator', 'PREDICTION_ORDER_VALIDATED', {
    marketId: sanitized.marketId,
    outcome: sanitized.outcome,
    amount: sanitized.amount,
    source: sanitized.source,
  });

  return { ok: true, sanitized };
}
