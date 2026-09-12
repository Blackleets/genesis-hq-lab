// reinvestmentEngine.test.mjs — Capital reinvestment automation tests

import { strict as assert } from 'assert';
import { test } from 'node:test';
import {
  REINVESTMENT,
  computeReinvestment,
  applyReinvestment,
  getBuckets,
  unlockFromBucket,
  getBudgetReview,
} from '../capital/reinvestmentEngine.mjs';

test('reinvestment: REINVESTMENT fractions sum to 1.0', () => {
  const sum = Object.values(REINVESTMENT).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1.0) < 0.001, `fractions should sum to 1.0, got ${sum}`);
  assert.equal(REINVESTMENT.reserve, 0.40);
  assert.equal(REINVESTMENT.agentUpgrade, 0.25);
  assert.equal(REINVESTMENT.experiments, 0.15);
  assert.equal(REINVESTMENT.expansion, 0.10);
  assert.equal(REINVESTMENT.liquidity, 0.10);
});

test('reinvestment: computeReinvestment for positive PnL', () => {
  const result = computeReinvestment(1000);
  assert.ok(result.isProfit);
  assert.equal(result.allocation.reserve, 400);
  assert.equal(result.allocation.agentUpgrade, 250);
  assert.equal(result.allocation.experiments, 150);
  assert.equal(result.allocation.expansion, 100);
  assert.equal(result.allocation.liquidity, 100);
});

test('reinvestment: computeReinvestment for zero/negative PnL', () => {
  const zero = computeReinvestment(0);
  assert.equal(zero.isProfit, false);
  assert.equal(zero.allocation.reserve, 0);

  const loss = computeReinvestment(-500);
  assert.equal(loss.isProfit, false);
  assert.equal(loss.allocation.reserve, 0);
});

test('reinvestment: applyReinvestment persists allocation', async () => {
  const before = getBuckets();
  console.log('[test] Buckets before:', before);

  // Apply $1000 profit
  const result = applyReinvestment(1000, 'test trade');
  assert.ok(result.applied);
  assert.equal(result.allocation.reserve, 400);
  assert.equal(result.allocation.agentUpgrade, 250);

  const after = getBuckets();
  console.log('[test] Buckets after:', after);

  // Verify buckets increased
  assert.ok(after.reserve > before.reserve, 'reserve should increase');
  assert.ok(after.liquidity > before.liquidity, 'liquidity should increase');
});

test('reinvestment: getBuckets returns current state', () => {
  const buckets = getBuckets();
  assert.ok(typeof buckets.total === 'number');
  assert.ok(typeof buckets.reserve === 'number');
  assert.ok(typeof buckets.agentUpgrade === 'number');
  assert.ok(typeof buckets.experiments === 'number');
  assert.ok(typeof buckets.expansion === 'number');
  assert.ok(typeof buckets.liquidity === 'number');
  console.log('[test] Current buckets:', buckets);
});

test('reinvestment: getBudgetReview provides recommendations', () => {
  const review = getBudgetReview();
  assert.ok(review.timestamp);
  assert.ok(typeof review.totalCapital === 'number');
  assert.ok(Array.isArray(review.recommendations));
  console.log('[test] Budget review:', review);
});

test('reinvestment: unlockFromBucket validates sufficient funds', async () => {
  const buckets = getBuckets();

  if (buckets.experiments > 500) {
    // Should succeed
    const result = unlockFromBucket('experiments', 500, 'test unlock');
    assert.ok(result.unlocked);
    assert.equal(result.amount, 500);
    console.log('[test] ✓ Unlocked $500 from experiments');
  } else {
    // Should fail due to insufficient funds
    try {
      unlockFromBucket('experiments', buckets.experiments + 1000, 'test');
      assert.fail('should have thrown insufficient funds error');
    } catch (err) {
      assert.ok(err.message.includes('insufficient funds'));
      console.log('[test] ✓ Correctly rejected unlock due to insufficient funds');
    }
  }
});

test('reinvestment: unlockFromBucket rejects invalid bucket', () => {
  try {
    unlockFromBucket('invalid_bucket', 100, 'test');
    assert.fail('should have thrown');
  } catch (err) {
    assert.ok(err.message.includes('unknown bucket'));
  }
});
