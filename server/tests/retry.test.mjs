// retry.test.mjs — Exponential backoff and circuit breaker tests

import { strict as assert } from 'assert';
import { test } from 'node:test';
import { withRetry, CircuitBreaker, isRetryableError } from '../utils/retry.mjs';

test('retry: withRetry succeeds on first try', async () => {
  let attempts = 0;
  const result = await withRetry(async () => {
    attempts++;
    return 'success';
  });
  assert.equal(result, 'success');
  assert.equal(attempts, 1);
});

test('retry: withRetry retries on failure then succeeds', async () => {
  let attempts = 0;
  const result = await withRetry(async () => {
    attempts++;
    if (attempts < 3) throw new Error('fail');
    return 'success';
  }, {
    initialDelayMs: 10,
    maxRetries: 3,
  });
  assert.equal(result, 'success');
  assert.equal(attempts, 3);
});

test('retry: withRetry exhausts retries and throws', async () => {
  let attempts = 0;
  try {
    await withRetry(async () => {
      attempts++;
      throw new Error('always fail');
    }, {
      initialDelayMs: 5,
      maxRetries: 2,
    });
    assert.fail('should have thrown');
  } catch (err) {
    assert.ok(err.message.includes('always fail'));
    assert.equal(attempts, 3); // initial + 2 retries
  }
});

test('retry: isRetryableError detects network errors', () => {
  assert.ok(isRetryableError(new Error('ECONNREFUSED')));
  assert.ok(isRetryableError(new Error('ETIMEDOUT')));
  assert.ok(isRetryableError(new Error('Network error')));
  assert.ok(!isRetryableError(new Error('Invalid request')));
  assert.ok(!isRetryableError(new Error('HTTP 400')));
});

test('retry: isRetryableError detects retryable HTTP errors', () => {
  assert.ok(isRetryableError(new Error('HTTP 503')));
  assert.ok(isRetryableError(new Error('HTTP 408')));
  assert.ok(isRetryableError(new Error('HTTP 429')));
  assert.ok(!isRetryableError(new Error('HTTP 404')));
  assert.ok(!isRetryableError(new Error('HTTP 401')));
});

test('circuit: breaker blocks after threshold', async () => {
  const breaker = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 50 });
  let attempts = 0;

  // Two failures → open circuit
  try {
    await breaker.execute(() => {
      attempts++;
      throw new Error('fail');
    });
  } catch (e) {
    assert.ok(e.message.includes('fail'));
  }

  try {
    await breaker.execute(() => {
      attempts++;
      throw new Error('fail');
    });
  } catch (e) {
    assert.ok(e.message.includes('fail'));
  }

  assert.equal(breaker.state, 'open');

  // Third attempt is blocked
  try {
    await breaker.execute(() => {
      attempts++;
      throw new Error('should not reach here');
    });
    assert.fail('circuit breaker should block');
  } catch (err) {
    assert.ok(err.message.includes('Circuit breaker OPEN'));
  }

  assert.equal(attempts, 2); // no third attempt
});

test('circuit: breaker resets after timeout', async () => {
  const breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 30 });

  // One failure → open circuit
  try {
    await breaker.execute(() => {
      throw new Error('fail');
    });
  } catch (e) {
    // expected
  }

  assert.equal(breaker.state, 'open');

  // Wait for reset timeout
  await new Promise(r => setTimeout(r, 40));

  // Circuit should be in HALF-OPEN state; success closes it
  const result = await breaker.execute(() => 'recovered');
  assert.equal(result, 'recovered');
  assert.equal(breaker.state, 'closed');
});

test('circuit: breaker status reports state', () => {
  const breaker = new CircuitBreaker({ name: 'test-breaker' });
  const status = breaker.getStatus();
  assert.equal(status.name, 'test-breaker');
  assert.equal(status.state, 'closed');
  assert.equal(status.failureCount, 0);
});
