// liveExecutor.mjs — live order execution stub.
// BLOCKED BY DEFAULT. Requires explicit env vars AND a per-order confirmation token.
// Real CLOB API integration is not implemented — this enforces the safety gate.
// Completing real execution requires: POLYMARKET_PRIVATE_KEY + CLOB API integration.

import { checkLivePermission } from './polymarketSafety.mjs';
import { validateOrder } from './orderValidator.mjs';
import { logEvent, SEVERITY } from '../../observability/eventTimeline.mjs';

/**
 * Attempt live order execution.
 * BLOCKED unless ENABLE_LIVE_PREDICTION_TRADING=true + MANUAL_CONFIRMATION_TOKEN.
 *
 * @param {object} rawOrder
 * @param {string} [confirmationToken]
 * @returns {{ ok: false, blocked: true, reason: string }}
 */
export function executeLiveOrder(rawOrder, confirmationToken) {
  // Gate 1: safety limits
  const validation = validateOrder(rawOrder);
  if (!validation.ok) {
    logEvent('PREDICTION', SEVERITY.WARNING, 'liveExecutor', 'PREDICTION_LIVE_ORDER_BLOCKED', {
      reason: validation.reason,
      gate: 'validation',
    });
    return { ok: false, blocked: true, reason: validation.reason, gate: 'validation' };
  }

  // Gate 2: live permission check
  const permission = checkLivePermission(confirmationToken);
  if (!permission.ok) {
    logEvent('PREDICTION', SEVERITY.HIGH, 'liveExecutor', 'PREDICTION_LIVE_ORDER_BLOCKED', {
      reason: permission.reason,
      detail: permission.detail,
      gate: 'live_permission',
    });
    return {
      ok: false,
      blocked: true,
      reason: permission.reason,
      detail: permission.detail,
      gate: 'live_permission',
      instructions: 'Set ENABLE_LIVE_PREDICTION_TRADING=true and MANUAL_CONFIRMATION_TOKEN in environment, then pass the token in x-confirmation-token header.',
    };
  }

  // Gate 3: CLOB integration not implemented
  // This will be reached only if someone bypasses both env gates manually in testing.
  logEvent('PREDICTION', SEVERITY.HIGH, 'liveExecutor', 'PREDICTION_LIVE_ORDER_BLOCKED', {
    reason: 'CLOB_NOT_IMPLEMENTED',
    gate: 'integration',
  });
  return {
    ok: false,
    blocked: true,
    reason: 'CLOB_NOT_IMPLEMENTED',
    detail: 'Real CLOB API integration is not yet implemented. POLYMARKET_PRIVATE_KEY is required and the signing/submission flow must be built.',
    gate: 'integration',
    blockedBy: 'BLOCKED_BY_SECRET_OR_API',
  };
}
