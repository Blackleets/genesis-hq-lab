// server/genesis/rateLimiter.mjs
// Shared API-rate budget for every Genesis module that touches Binance
// (Hummingbot "API Throttler" pattern, ported from scripts/genesis_paper_connector.py).
//
// Sliding window per limit_id with WEIGHTS: each request spends its endpoint
// group's weight, not one slot. A safety margin keeps us under the published
// limit so bursts never trip an IP ban.
//
// The singleton returned by getSharedThrottler() is the point of this module:
// backtest warmup, liveRunner, ccxtFeed, ... all draw from ONE budget.

export class RateLimit {
  /**
   * @param {string} limitId   endpoint-group key, e.g. 'ohlcv' | 'default'
   * @param {number} limit     max weight units per interval
   * @param {number} intervalSec window length in seconds
   * @param {number} weight    default weight charged per acquire() on this id
   */
  constructor(limitId, limit, intervalSec, weight = 1) {
    if (!limitId || typeof limitId !== 'string') throw new Error(`RateLimit: invalid limitId ${limitId}`);
    if (!Number.isFinite(limit) || limit < 1) throw new Error(`RateLimit[${limitId}]: limit must be >= 1`);
    if (!Number.isFinite(intervalSec) || intervalSec <= 0) throw new Error(`RateLimit[${limitId}]: intervalSec must be > 0`);
    if (!Number.isFinite(weight) || weight < 1) throw new Error(`RateLimit[${limitId}]: weight must be >= 1`);
    this.limitId = limitId;
    this.limit = limit;
    this.intervalMs = intervalSec * 1000;
    this.weight = weight;
    // Sliding window of {t, w} spend records (monotonic ms).
    this._spends = [];
  }

  /** Effective ceiling after applying the safety margin. */
  effectiveLimit(safetyMarginPct) {
    return Math.max(1, Math.floor(this.limit * (1 - safetyMarginPct)));
  }
}

export class AsyncThrottler {
  /**
   * @param {RateLimit[]} rateLimits
   * @param {number} safetyMarginPct fraction of headroom kept below the limit (0.05 = 5%)
   */
  constructor(rateLimits, safetyMarginPct = 0.05) {
    if (!Array.isArray(rateLimits) || rateLimits.length === 0) {
      throw new Error('AsyncThrottler: rateLimits[] required');
    }
    if (!Number.isFinite(safetyMarginPct) || safetyMarginPct < 0 || safetyMarginPct >= 1) {
      throw new Error('AsyncThrottler: safetyMarginPct must be in [0, 1)');
    }
    this._limits = new Map(rateLimits.map(rl => [rl.limitId, rl]));
    this._margin = safetyMarginPct;
    // Chain acquisitions so concurrent callers queue instead of racing the window.
    this._queue = Promise.resolve();
  }

  _prune(rl, now) {
    while (rl._spends.length && now - rl._spends[0].t >= rl.intervalMs) rl._spends.shift();
  }

  _usedWeight(rl) {
    return rl._spends.reduce((s, r) => s + r.w, 0);
  }

  /**
   * Reserve budget for one request. Resolves immediately when there is room,
   * otherwise waits (sliding window) until the spend record ages out.
   * @param {string} limitId
   * @param {number} weight actual request weight (defaults to the id's own weight)
   */
  async acquire(limitId, weight = null) {
    const rl = this._limits.get(limitId);
    if (!rl) {
      // Unknown ids are a programming error, not a silent unlimited lane.
      throw new Error(`AsyncThrottler.acquire: unknown limitId '${limitId}' (configured: ${[...this._limits.keys()].join(', ')})`);
    }
    const w = Number.isFinite(weight) ? Math.max(1, Math.floor(weight)) : rl.weight;
    const cap = rl.effectiveLimit(this._margin);
    if (w > cap) throw new Error(`AsyncThrottler[${limitId}]: single request weight ${w} exceeds effective limit ${cap}`);

    await this._queue;
    let release;
    this._queue = new Promise(res => { release = res; });

    try {
      for (;;) {
        const now = Date.now();
        this._prune(rl, now);
        const used = this._usedWeight(rl);
        if (used + w <= cap) {
          rl._spends.push({ t: now, w });
          return;
        }
        // Wait until the OLDEST record leaves the window (worst case frees most room).
        const waitMs = rl._spends.length ? rl._spends[0].t + rl.intervalMs - now + 1 : 1;
        await new Promise(res => setTimeout(res, waitMs));
      }
    } finally {
      release();
    }
  }

  /** Introspection for logs/tests: current usage snapshot per limit_id. */
  usage() {
    const now = Date.now();
    const out = {};
    for (const [id, rl] of this._limits) {
      this._prune(rl, now);
      out[id] = { used: this._usedWeight(rl), cap: rl.effectiveLimit(this._margin), windowMs: rl.intervalMs };
    }
    return out;
  }
}

// Shared budget for ALL modules touching Binance (plan risk #3: throttler must
// be a singleton from day one). Limits mirror Binance spot style:
//   ohlcv   -> 50 requests / min   (weight-2 kline calls)
//   default -> 1200 weight units / min
let _shared = null;
export function getSharedThrottler() {
  if (!_shared) {
    _shared = new AsyncThrottler([
      new RateLimit('ohlcv', 50, 60, 1),
      new RateLimit('default', 1200, 60, 1),
    ]);
  }
  return _shared;
}
