import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { executePaperOrder, getPaperOrders, getPaperStats } from '../predictionMarkets/execution/paperExecutor.mjs';
import { resetDailyLoss } from '../predictionMarkets/execution/polymarketSafety.mjs';

// Reset env and loss tracker before each test
function cleanEnv() {
  resetDailyLoss();
  delete process.env.MAX_PREDICTION_POSITION_SIZE;
  delete process.env.MAX_PREDICTION_DAILY_LOSS;
  process.env.MAX_PREDICTION_POSITION_SIZE = '100'; // permissive for paper tests
  process.env.MAX_PREDICTION_DAILY_LOSS = '10000';
}

describe('executePaperOrder', () => {
  beforeEach(cleanEnv);

  test('successfully creates a paper order', () => {
    const result = executePaperOrder({
      marketId: 'pm-fixture-001',
      outcome: 'YES',
      amount: 5,
      source: 'polymarket',
    });
    assert.equal(result.ok, true);
    assert.equal(result.mode, 'paper');
    assert.ok(result.orderId?.startsWith('paper-'), 'orderId has paper- prefix');
    assert.equal(result.status, 'filled');
    assert.ok(result.fees > 0, 'fees charged');
    assert.ok(result.disclaimer?.includes('simulated'), 'disclaimer present');
    assert.ok(result.auditLog?.realMoneyMoved === false, 'no real money moved');
  });

  test('rejects order with no marketId', () => {
    const result = executePaperOrder({ marketId: '', outcome: 'YES', amount: 5 });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'MISSING_MARKET_ID');
  });

  test('rejects order with invalid outcome', () => {
    const result = executePaperOrder({ marketId: 'pm-1', outcome: 'BOTH', amount: 5 });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'INVALID_OUTCOME');
  });

  test('rejects order exceeding position limit', () => {
    process.env.MAX_PREDICTION_POSITION_SIZE = '10';
    const result = executePaperOrder({ marketId: 'pm-1', outcome: 'YES', amount: 500 });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'POSITION_SIZE_EXCEEDED');
  });

  test('getPaperOrders returns recent orders', () => {
    executePaperOrder({ marketId: 'pm-a', outcome: 'YES', amount: 3 });
    executePaperOrder({ marketId: 'pm-b', outcome: 'NO', amount: 2 });
    const orders = getPaperOrders({ limit: 5 });
    assert.ok(orders.length >= 2);
  });

  test('getPaperStats tracks totals', () => {
    const stats = getPaperStats();
    assert.equal(stats.mode, 'paper');
    assert.ok(typeof stats.totalOrders === 'number');
    assert.ok(typeof stats.totalNotional === 'number');
    assert.ok(stats.disclaimer?.length > 0);
  });
});
