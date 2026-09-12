// retry.mjs — Exponential backoff retry logic for network operations
// Used by Kalshi API calls, WebSocket connections, and other unreliable operations

export const DEFAULT_CONFIG = {
  initialDelayMs: 100,
  maxDelayMs: 10000,
  backoffMultiplier: 2.0,
  maxRetries: 3,
  jitterPct: 0.1, // add 10% random jitter to avoid thundering herd
};

/**
 * Retry a function with exponential backoff
 * @param {Function} fn — async function to retry
 * @param {Object} config — { initialDelayMs, maxDelayMs, backoffMultiplier, maxRetries, jitterPct }
 * @param {string} label — for logging
 * @returns {*} result of fn() if successful
 * @throws {Error} after maxRetries exhausted
 */
export async function withRetry(fn, config = {}, label = 'operation') {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  let lastError;
  let delayMs = cfg.initialDelayMs;

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    try {
      const result = await fn(attempt);
      if (attempt > 0) {
        console.log(`[retry] ✓ ${label} succeeded on attempt ${attempt + 1}`);
      }
      return result;
    } catch (err) {
      lastError = err;
      if (attempt === cfg.maxRetries) {
        console.error(
          `[retry] ✗ ${label} failed after ${cfg.maxRetries + 1} attempts: ${err.message}`
        );
        throw err;
      }

      // Add jitter
      const jitter = 1 + (Math.random() - 0.5) * cfg.jitterPct;
      const actualDelay = Math.min(delayMs * jitter, cfg.maxDelayMs);

      console.warn(
        `[retry] attempt ${attempt + 1} failed: ${err.message}. Retrying in ${actualDelay.toFixed(0)}ms...`
      );

      await sleep(actualDelay);
      delayMs = Math.min(delayMs * cfg.backoffMultiplier, cfg.maxDelayMs);
    }
  }

  throw lastError;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry a fetch operation
 * @param {string} url
 * @param {Object} options — fetch options
 * @param {Object} retryConfig — retry configuration (optional)
 */
export async function fetchWithRetry(url, options = {}, retryConfig = {}) {
  return withRetry(
    async () => {
      const res = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(options.timeout ?? 10000),
      });
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errorText.slice(0, 100)}`);
      }
      return res;
    },
    retryConfig,
    `fetch ${url.split('?')[0]}`
  );
}

/**
 * Classify an error as retryable or permanent
 */
export function isRetryableError(error) {
  const msg = error?.message?.toLowerCase() ?? '';

  // Network errors (retryable)
  if (
    msg.includes('econnrefused') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('timeout') ||
    msg.includes('network') ||
    msg.includes('enotfound')
  ) {
    return true;
  }

  // HTTP errors (retryable on 5xx, 408, 429, 503)
  if (msg.includes('http 5') || msg.includes('http 408') || msg.includes('http 429') || msg.includes('http 503')) {
    return true;
  }

  return false;
}

/**
 * Circuit breaker pattern — prevent cascading failures
 * Usage:
 *   const breaker = new CircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 60000 });
 *   await breaker.execute(() => riskyOperation());
 */
export class CircuitBreaker {
  constructor(config = {}) {
    this.failureThreshold = config.failureThreshold ?? 5;
    this.resetTimeoutMs = config.resetTimeoutMs ?? 60000;
    this.name = config.name ?? 'breaker';

    this.state = 'closed'; // closed | open | half-open
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureAt = null;
    this.lastResetAt = null;
  }

  async execute(fn, label = 'operation') {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureAt > this.resetTimeoutMs) {
        this.state = 'half-open';
        this.successCount = 0;
        console.log(`[circuit:${this.name}] transitioning to HALF-OPEN`);
      } else {
        throw new Error(`Circuit breaker OPEN (${this.name}) — ${label} blocked. Retry in ${this.resetTimeoutMs}ms`);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  onSuccess() {
    this.failureCount = 0;
    if (this.state === 'half-open') {
      this.state = 'closed';
      this.lastResetAt = Date.now();
      console.log(`[circuit:${this.name}] transitioning to CLOSED`);
    }
  }

  onFailure() {
    this.failureCount++;
    this.lastFailureAt = Date.now();
    if (this.failureCount >= this.failureThreshold && this.state !== 'open') {
      this.state = 'open';
      console.error(`[circuit:${this.name}] OPENED after ${this.failureCount} failures`);
    }
  }

  getStatus() {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      lastFailureAt: this.lastFailureAt ? new Date(this.lastFailureAt).toISOString() : null,
    };
  }
}
