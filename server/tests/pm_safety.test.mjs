import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { checkSafetyLimits, checkLivePermission, resetDailyLoss, recordLoss, getDailyLoss } from '../predictionMarkets/execution/polymarketSafety.mjs';

describe('checkSafetyLimits', () => {
  beforeEach(() => {
    resetDailyLoss();
    delete process.env.MAX_PREDICTION_POSITION_SIZE;
    delete process.env.MAX_PREDICTION_DAILY_LOSS;
  });

  test('accepts valid order within defaults', () => {
    const result = checkSafetyLimits({ marketId: 'mkt-1', outcome: 'YES', amount: 5 });
    assert.equal(result.ok, true);
  });

  test('rejects amount exceeding MAX_PREDICTION_POSITION_SIZE', () => {
    process.env.MAX_PREDICTION_POSITION_SIZE = '10';
    const result = checkSafetyLimits({ marketId: 'mkt-1', outcome: 'YES', amount: 99 });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'POSITION_SIZE_EXCEEDED');
  });

  test('rejects zero or negative amount', () => {
    const r1 = checkSafetyLimits({ marketId: 'm', outcome: 'YES', amount: 0 });
    assert.equal(r1.ok, false);
    assert.equal(r1.reason, 'INVALID_AMOUNT');

    const r2 = checkSafetyLimits({ marketId: 'm', outcome: 'NO', amount: -5 });
    assert.equal(r2.ok, false);
  });

  test('rejects invalid outcome', () => {
    const result = checkSafetyLimits({ marketId: 'mkt-1', outcome: 'MAYBE', amount: 5 });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'INVALID_OUTCOME');
  });

  test('rejects order when daily loss cap is hit', () => {
    process.env.MAX_PREDICTION_DAILY_LOSS = '25';
    recordLoss(25);
    const result = checkSafetyLimits({ marketId: 'mkt-1', outcome: 'YES', amount: 5 });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'DAILY_LOSS_CAP_HIT');
  });

  test('getDailyLoss tracks accumulated losses', () => {
    resetDailyLoss();
    recordLoss(10);
    recordLoss(5);
    assert.equal(getDailyLoss(), 15);
  });

  test('rejects order missing marketId', () => {
    const result = checkSafetyLimits({ marketId: '', outcome: 'YES', amount: 5 });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'MISSING_MARKET_ID');
  });
});

describe('checkLivePermission', () => {
  beforeEach(() => {
    delete process.env.ENABLE_LIVE_PREDICTION_TRADING;
    delete process.env.MANUAL_CONFIRMATION_TOKEN;
  });

  test('blocks when ENABLE_LIVE_PREDICTION_TRADING is not set', () => {
    const result = checkLivePermission('any-token');
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'LIVE_TRADING_DISABLED');
  });

  test('blocks when ENABLE_LIVE_PREDICTION_TRADING is false', () => {
    process.env.ENABLE_LIVE_PREDICTION_TRADING = 'false';
    const result = checkLivePermission('any-token');
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'LIVE_TRADING_DISABLED');
  });

  test('blocks when MANUAL_CONFIRMATION_TOKEN is missing', () => {
    process.env.ENABLE_LIVE_PREDICTION_TRADING = 'true';
    const result = checkLivePermission('any-token');
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'MISSING_CONFIRMATION_TOKEN');
  });

  test('blocks when token does not match', () => {
    process.env.ENABLE_LIVE_PREDICTION_TRADING = 'true';
    process.env.MANUAL_CONFIRMATION_TOKEN = 'correct-token';
    const result = checkLivePermission('wrong-token');
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'INVALID_CONFIRMATION_TOKEN');
  });

  test('allows when all conditions met', () => {
    process.env.ENABLE_LIVE_PREDICTION_TRADING = 'true';
    process.env.MANUAL_CONFIRMATION_TOKEN = 'correct-token';
    const result = checkLivePermission('correct-token');
    assert.equal(result.ok, true);
  });
});
