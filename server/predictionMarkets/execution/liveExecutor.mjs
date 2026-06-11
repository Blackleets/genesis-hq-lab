// liveExecutor.mjs — live order execution for Polymarket CLOB API.
// Triple-gated: (1) safety limits, (2) env live-permission, (3) paper pre-flight.
// Real CLOB submission is only attempted after all three gates pass.
// ENABLE_LIVE_PREDICTION_TRADING=true + MANUAL_CONFIRMATION_TOKEN are required.

import { checkLivePermission } from './polymarketSafety.mjs';
import { validateOrder } from './orderValidator.mjs';
import { executePaperOrder } from './paperExecutor.mjs';
import { buildSignedOrder, serializeOrder } from './clobSigner.mjs';
import { submitOrder, getClobCredentials } from './clobApiClient.mjs';
import { logEvent, SEVERITY } from '../../observability/eventTimeline.mjs';

/**
 * Attempt live order execution via Polymarket CLOB API.
 *
 * Flow:
 *  Gate 1 — safety limits (position size, daily loss cap, valid params)
 *  Gate 2 — live permission (ENABLE_LIVE_PREDICTION_TRADING + confirmation token)
 *  Gate 3 — paper pre-flight (simulate the same order in paper mode first)
 *  Gate 4 — credentials present (POLYMARKET_PRIVATE_KEY + POLYMARKET_API_KEY)
 *  Execution — EIP-712 sign → dry-run validate → submit (if not dryRun)
 *
 * @param {object} rawOrder
 * @param {string} rawOrder.marketId     - Polymarket market ID
 * @param {string} rawOrder.outcome      - 'YES' or 'NO'
 * @param {number} rawOrder.amount       - USD size
 * @param {string} rawOrder.tokenId      - ERC-1155 outcome token ID (required for signing)
 * @param {number} rawOrder.price        - probability price in (0,1)
 * @param {string} [confirmationToken]   - must match MANUAL_CONFIRMATION_TOKEN
 * @param {boolean} [dryRun=true]        - default true; must explicitly pass false for real submit
 * @returns {Promise<object>}
 */
export async function executeLiveOrder(rawOrder, confirmationToken, { dryRun = true } = {}) {
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

  // Gate 3: paper pre-flight — validate order fills successfully in paper mode first
  const paperResult = executePaperOrder({
    marketId: rawOrder.marketId,
    outcome:  rawOrder.outcome,
    amount:   rawOrder.amount,
    source:   rawOrder.source ?? 'polymarket',
  });
  if (!paperResult.ok) {
    logEvent('PREDICTION', SEVERITY.HIGH, 'liveExecutor', 'PREDICTION_LIVE_ORDER_BLOCKED', {
      reason: 'PAPER_PREFLIGHT_FAILED',
      paperError: paperResult.error,
      gate: 'paper_preflight',
    });
    return {
      ok: false,
      blocked: true,
      reason: 'PAPER_PREFLIGHT_FAILED',
      detail: `Paper pre-flight rejected the order: ${paperResult.error}`,
      gate: 'paper_preflight',
    };
  }

  // Gate 4: credentials
  const creds = getClobCredentials();
  if (!creds.privateKey) {
    logEvent('PREDICTION', SEVERITY.HIGH, 'liveExecutor', 'PREDICTION_LIVE_ORDER_BLOCKED', {
      reason: 'BLOCKED_BY_SECRET_OR_API',
      missing: 'POLYMARKET_PRIVATE_KEY',
      gate: 'credentials',
    });
    return {
      ok: false,
      blocked: true,
      reason: 'BLOCKED_BY_SECRET_OR_API',
      detail: 'POLYMARKET_PRIVATE_KEY is not set.',
      gate: 'credentials',
    };
  }

  // Validate CLOB-specific fields required for signing
  if (!rawOrder.tokenId) {
    logEvent('PREDICTION', SEVERITY.WARNING, 'liveExecutor', 'PREDICTION_LIVE_ORDER_BLOCKED', {
      reason: 'MISSING_TOKEN_ID',
      gate: 'signing_params',
    });
    return { ok: false, blocked: true, reason: 'MISSING_TOKEN_ID', detail: 'tokenId (ERC-1155 outcome token) is required for CLOB order signing.', gate: 'signing_params' };
  }

  const price = Number(rawOrder.price);
  if (!price || price <= 0 || price >= 1) {
    logEvent('PREDICTION', SEVERITY.WARNING, 'liveExecutor', 'PREDICTION_LIVE_ORDER_BLOCKED', {
      reason: 'INVALID_PRICE',
      price,
      gate: 'signing_params',
    });
    return { ok: false, blocked: true, reason: 'INVALID_PRICE', detail: 'price must be a probability in (0, 1).', gate: 'signing_params' };
  }

  // Signing
  let orderStruct, signature, signerAddress;
  try {
    ({ orderStruct, signature, signerAddress } = await buildSignedOrder(
      {
        tokenId:    rawOrder.tokenId,
        side:       rawOrder.outcome === 'YES' ? 'BUY' : 'SELL',
        price,
        sizeUsd:    rawOrder.amount,
        feeRateBps: rawOrder.feeRateBps ?? 0,
        expiration: rawOrder.expiration ?? 0,
      },
      creds.privateKey,
    ));
  } catch (err) {
    logEvent('PREDICTION', SEVERITY.HIGH, 'liveExecutor', 'PREDICTION_LIVE_ORDER_SIGN_FAILED', {
      error: err.message,
    });
    return { ok: false, reason: 'SIGNING_FAILED', detail: err.message };
  }

  const serialized = serializeOrder(orderStruct, signature, signerAddress);

  logEvent('PREDICTION', SEVERITY.INFO, 'liveExecutor', 'PREDICTION_LIVE_ORDER_SIGNED', {
    marketId:     rawOrder.marketId,
    outcome:      rawOrder.outcome,
    amount:       rawOrder.amount,
    signerAddress,
    dryRun,
    paperPreFlight: paperResult.orderId,
  });

  // Submit (or dry-run)
  let submitResult;
  try {
    submitResult = await submitOrder(serialized, signerAddress, {
      dryRun,
      orderType: rawOrder.orderType ?? 'GTC',
    });
  } catch (err) {
    logEvent('PREDICTION', SEVERITY.HIGH, 'liveExecutor', 'PREDICTION_LIVE_ORDER_SUBMIT_FAILED', {
      error: err.message,
      dryRun,
    });
    return { ok: false, reason: 'SUBMIT_FAILED', detail: err.message };
  }

  const auditLog = {
    realMoneyMoved: !dryRun && submitResult.ok,
    dryRun,
    signerAddress,
    marketId:       rawOrder.marketId,
    outcome:        rawOrder.outcome,
    amount:         rawOrder.amount,
    paperPreFlight: paperResult.orderId,
    ts:             new Date().toISOString(),
  };

  if (!submitResult.ok) {
    logEvent('PREDICTION', SEVERITY.HIGH, 'liveExecutor', 'PREDICTION_LIVE_ORDER_REJECTED_BY_CLOB', {
      httpStatus: submitResult.httpStatus,
      error:      submitResult.error,
      dryRun,
    });
    return { ok: false, reason: 'CLOB_REJECTED', detail: submitResult.error, raw: submitResult, auditLog };
  }

  logEvent('PREDICTION', SEVERITY.INFO, 'liveExecutor', 'PREDICTION_LIVE_ORDER_ACCEPTED', {
    orderId:  submitResult.orderId,
    dryRun,
    marketId: rawOrder.marketId,
    amount:   rawOrder.amount,
  });

  return {
    ok:             true,
    dryRun,
    mode:           dryRun ? 'dry_run' : 'live',
    orderId:        submitResult.orderId,
    status:         submitResult.status ?? (dryRun ? 'dry_run_ok' : 'submitted'),
    signerAddress,
    paperPreFlight: paperResult.orderId,
    auditLog,
    disclaimer:     dryRun
      ? 'DRY_RUN: order was signed and validated but NOT submitted to Polymarket.'
      : 'LIVE ORDER: real funds were committed. Check your Polymarket portfolio.',
  };
}
