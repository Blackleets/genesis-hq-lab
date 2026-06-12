// paperExecutor.mjs — simulated paper trade execution.
// No real money is ever moved. All orders are stored in memory only.
// Audit log is maintained for every order regardless of outcome.

import { randomBytes } from 'node:crypto';
import { validateOrder } from './orderValidator.mjs';
import { recordLoss } from './polymarketSafety.mjs';
import { logEvent, SEVERITY } from '../../observability/eventTimeline.mjs';

// ── In-memory paper order store (ephemeral — intentional) ─────────────────────
const _paperOrders = [];

/**
 * Execute a paper trade (simulated, no real execution).
 *
 * @param {object} rawOrder
 * @returns {{ ok: boolean, mode: 'paper', orderId?: string, error?: string }}
 */
export function executePaperOrder(rawOrder) {
  const validation = validateOrder(rawOrder);
  if (!validation.ok) {
    return { ok: false, mode: 'paper', error: validation.reason, detail: validation.detail };
  }

  const { sanitized } = validation;
  const orderId = `paper-${randomBytes(6).toString('hex')}`;
  const createdAt = new Date().toISOString();

  // Simulate fill at market price (no real price feed in paper mode)
  const simulatedFillPrice = sanitized.outcome === 'YES' ? 0.50 : 0.50; // neutral default
  const fees = sanitized.amount * 0.002; // 0.2% simulated fee

  const paperOrder = {
    orderId,
    mode: 'paper',
    status: 'filled',
    marketId: sanitized.marketId,
    outcome: sanitized.outcome,
    amount: sanitized.amount,
    source: sanitized.source,
    strategy: sanitized.strategy,
    fillPrice: simulatedFillPrice,
    fees,
    netAmount: sanitized.amount - fees,
    note: sanitized.note,
    createdAt,
    auditLog: {
      validated: true,
      safetyChecked: true,
      executionMode: 'paper',
      realMoneyMoved: false,
      createdAt,
    },
  };

  _paperOrders.push(paperOrder);

  // Track as potential loss for daily limit purposes (conservative)
  recordLoss(sanitized.amount);

  logEvent(
    'PREDICTION', SEVERITY.INFO, 'paperExecutor',
    'PREDICTION_PAPER_ORDER_CREATED',
    {
      orderId,
      marketId: sanitized.marketId,
      outcome: sanitized.outcome,
      amount: sanitized.amount,
      source: sanitized.source,
    }
  );

  return {
    ok: true,
    mode: 'paper',
    orderId,
    status: 'filled',
    fillPrice: simulatedFillPrice,
    fees,
    createdAt,
    disclaimer: 'This is a simulated paper order. No real money was moved.',
    auditLog: paperOrder.auditLog,
  };
}

/** Get all paper orders (most recent first). */
export function getPaperOrders({ limit = 50 } = {}) {
  return _paperOrders.slice(-limit).reverse();
}

/** Get a single paper order by ID. */
export function getPaperOrder(orderId) {
  return _paperOrders.find((o) => o.orderId === orderId) ?? null;
}

/** Summary stats for paper trading session. */
export function getPaperStats() {
  const total = _paperOrders.length;
  const totalNotional = _paperOrders.reduce((a, o) => a + o.amount, 0);
  const totalFees = _paperOrders.reduce((a, o) => a + o.fees, 0);
  return {
    mode: 'paper',
    totalOrders: total,
    totalNotional: Math.round(totalNotional * 100) / 100,
    totalFees: Math.round(totalFees * 100) / 100,
    disclaimer: 'Paper trading only — no real capital at risk',
  };
}
