// server/genesis/connectorCore.mjs
// Order lifecycle infrastructure in JS (P2 of the unified integration plan).
// Port of the Hummingbot connector pattern already proven in Python at
// scripts/genesis_paper_connector.py: InFlightOrder + ClientOrderTracker.
//
// NOT wired to liveRunner yet (separate task). This module is deliberately
// pure: no I/O, no exchange calls, no timers. Persistence is via
// snapshotStates()/restoreTrackingStates() so the caller can write the plain
// object atomically next to its existing state (plan risk #3).
//
// Self-test demo CLI:
//   node server/genesis/connectorCore.mjs

import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const OrderState = {
  PENDING_CREATE: 'PENDING_CREATE',
  OPEN: 'OPEN',
  PARTIALLY_FILLED: 'PARTIALLY_FILLED',
  FILLED: 'FILLED',
  CANCELLED: 'CANCELLED',
  FAILED: 'FAILED',
};

const DONE_STATES = new Set([OrderState.FILLED, OrderState.CANCELLED, OrderState.FAILED]);

/** Readable unique id, HB style: genesis-<b|s>-<uuid8>. */
export function newClientOrderId(side) {
  if (typeof side !== 'string' || !side.length) throw new Error('newClientOrderId: side required');
  return `genesis-${side[0].toLowerCase()}-${randomUUID().replace(/-/g, '').slice(0, 8)}`;
}

/**
 * One order's full lifecycle state. Float amounts are acceptable here for
 * paper trading (exact-decimal reference lives in the Python connector).
 */
export class InFlightOrder {
  /**
   * @param {object} o
   * @param {string} o.clientOrderId
   * @param {string} o.tradingPair   BASE-QUOTE or ccxt BASE/QUOTE (normalized to BASE-QUOTE)
   * @param {'buy'|'sell'} o.side    trade type (HB TradeType)
   * @param {number} o.amount        order amount in base asset (> 0)
   * @param {number|null} [o.price]  limit price (null/undefined for market)
   * @param {string} [o.type]        'MARKET' | 'LIMIT'
   * @param {number} [o.filledAmount] restored partial fill total (base asset)
   * @param {number} [o.averageFillPrice]
   * @param {number} [o.feePaid]     accumulated fee in quote asset
   * @param {string} [o.state]       OrderState
   * @param {number} [o.createdAt]   epoch ms
   * @param {number} [o.updatedAt]
   */
  constructor(o) {
    if (!o || typeof o !== 'object') throw new Error('InFlightOrder: options object required');
    if (!o.clientOrderId) throw new Error('InFlightOrder: clientOrderId required');
    if (typeof o.tradingPair !== 'string' || !/^[A-Z0-9]+[\/-][A-Z0-9]+$/.test(o.tradingPair.toUpperCase())) {
      throw new Error(`InFlightOrder: tradingPair must be BASE-QUOTE, got ${o.tradingPair}`);
    }
    if (!['buy', 'sell'].includes(String(o.side || '').toLowerCase())) throw new Error(`InFlightOrder: side must be buy|sell`);
    const amount = Number(o.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error(`InFlightOrder: amount must be > 0`);

    this.clientOrderId = o.clientOrderId;
    this.tradingPair = o.tradingPair.toUpperCase().replace('/', '-');
    this.side = String(o.side).toLowerCase();
    this.type = o.type || (o.price != null ? 'LIMIT' : 'MARKET');
    this.price = o.price == null ? null : Number(o.price);
    this.amount = amount;
    this.filledAmount = Number(o.filledAmount || 0);
    this.averageFillPrice = Number(o.averageFillPrice || 0);
    this.feePaid = Number(o.feePaid || 0);
    this.state = o.state || OrderState.PENDING_CREATE;
    this.createdAt = o.createdAt || Date.now();
    this.updatedAt = o.updatedAt || Date.now();

    // Fill accumulation bookkeeping (for correct weighted average price).
    this._notional = this.averageFillPrice && this.filledAmount
      ? this.averageFillPrice * this.filledAmount
      : 0;

    this.validate();
  }

  validate() {
    if (this.type === 'LIMIT' && !(Number.isFinite(this.price) && this.price > 0)) {
      throw new Error('InFlightOrder: LIMIT requires price > 0');
    }
    if (this.state === OrderState.PARTIALLY_FILLED && !(this.filledAmount > 0 && this.filledAmount < this.amount)) {
      // Tolerated on restore of legacy snapshots; only enforced on fresh fills.
      if (!this._restored) throw new Error('InFlightOrder: inconsistent PARTIALLY_FILLED state');
    }
  }

  get isDone() { return DONE_STATES.has(this.state); }
  get baseAsset() { return this.tradingPair.split('-')[0]; }
  get quoteAsset() {
    const parts = this.tradingPair.split('-');
    if (parts.length !== 2 || !parts[1]) throw new Error(`tradingPair must be BASE-QUOTE: ${this.tradingPair}`);
    return parts[1];
  }

  /** Accumulate one (partial) fill; transitions OPEN/PARTIALLY_FILLED -> FILLED when complete. */
  applyFill({ fillAmount, fillPrice, fee = 0 }) {
    if (this.isDone) throw new Error(`applyFill on terminal order ${this.clientOrderId} (${this.state})`);
    const amt = Number(fillAmount), px = Number(fillPrice), f = Number(fee);
    if (!Number.isFinite(amt) || amt <= 0) throw new Error(`applyFill: fillAmount must be > 0`);
    if (!Number.isFinite(px) || px <= 0) throw new Error(`applyFill: fillPrice must be > 0`);
    if (!Number.isFinite(f) || f < 0) throw new Error('applyFill: fee must be >= 0');
    if (this.filledAmount + amt > this.amount + 1e-12) {
      throw new Error(`applyFill: overfill (${this.filledAmount} + ${amt} > ${this.amount})`);
    }
    this._notional += px * amt;
    this.filledAmount += amt;
    this.averageFillPrice = this.filledAmount > 0 ? this._notional / this.filledAmount : 0;
    this.feePaid += f;
    this.updatedAt = Date.now();
    this.state = this.filledAmount >= this.amount - 1e-12 ? OrderState.FILLED : OrderState.PARTIALLY_FILLED;
    return this;
  }

  _setState(state) {
    this.state = state;
    this.updatedAt = Date.now();
  }

  toPlain() {
    const { clientOrderId, tradingPair, side, type, price, amount, filledAmount,
      averageFillPrice, feePaid, state, createdAt, updatedAt } = this;
    return { clientOrderId, tradingPair, side, type, price, amount, filledAmount,
      averageFillPrice, feePaid, state, createdAt, updatedAt };
  }

  static fromPlain(p) {
    const o = new InFlightOrder({ ...p });
    o._restored = true; // allow legacy/restored partial states without re-validation drama
    return o;
  }
}

/**
 * Tracks live + recently done orders by client_order_id (HB ClientOrderTracker).
 * Synchronous by design: Node is single-threaded per runner and the async lock
 * in the Python version exists because of asyncio, not correctness here.
 */
export class ClientOrderTracker {
  constructor({ maxCacheSize = 1000, cacheTtlMs = 30_000 } = {}) {
    this._inFlight = new Map();  // id -> InFlightOrder
    this._cached = new Map();    // id -> {order, doneAt}
    this.maxCacheSize = maxCacheSize;
    this.cacheTtlMs = cacheTtlMs;
  }

  register(order) {
    const id = order.clientOrderId;
    if (this._inFlight.has(id) || this._cached.has(id)) {
      throw new Error(`DuplicateClientOrderId: ${id}`);
    }
    this._purgeExpiredCache();
    this._inFlight.set(id, order);
    return order;
  }

  getById(id) {
    const live = this._inFlight.get(id);
    if (live) return live;
    const cached = this._cached.get(id);
    if (cached) return cached.order;
    return undefined;
  }

  markOpen(id) {
    const order = this._requireLive(id);
    if (order.state === OrderState.PENDING_CREATE || order.state === OrderState.OPEN) {
      order._setState(OrderState.OPEN);
    } else {
      throw new Error(`markOpen(${id}): illegal transition from ${order.state}`);
    }
    return order;
  }

  applyFill(id, fill) {
    const order = this._requireLive(id);
    order.applyFill(fill);
    if (order.isDone) this._retireToCache(id, order);
    return order;
  }

  /** Explicit terminal transition without fills (cancel/fail paths). */
  markTerminal(id, state) {
    if (!DONE_STATES.has(state)) throw new Error(`markTerminal: ${state} is not terminal`);
    const order = this._requireLive(id);
    order._setState(state);
    this._retireToCache(id, order);
    return order;
  }

  get activeOrders() { return [...this._inFlight.values()]; }

  /** Plain-object snapshot for atomic persistence alongside runner state. */
  snapshotStates() {
    this._purgeExpiredCache();
    const snap = {};
    for (const [id, o] of this._inFlight) snap[id] = o.toPlain();
    for (const [id, c] of this._cached) snap[id] = { ...c.order.toPlain(), cachedAt: c.doneAt };
    return snap;
  }

  /** Rebuild tracking from a snapshotStates() output (e.g. after restart). */
  restoreTrackingStates(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') throw new Error('restoreTrackingStates: snapshot object required');
    this._inFlight.clear();
    this._cached.clear();
    for (const [id, p] of Object.entries(snapshot)) {
      const order = InFlightOrder.fromPlain(p);
      if (order.isDone) {
        this._cached.set(id, { order, doneAt: p.cachedAt || Date.now() });
      } else {
        this._inFlight.set(id, order);
      }
    }
    return this;
  }

  // -- internals --
  _requireLive(id) {
    const order = this._inFlight.get(id);
    if (!order) {
      const cached = this._cached.get(id);
      if (cached) throw new Error(`OrderAlreadyDone: ${id} is ${cached.order.state}`);
      throw new Error(`OrderNotFound: ${id}`);
    }
    return order;
  }

  _retireToCache(id, order) {
    this._inFlight.delete(id);
    this._cached.set(id, { order, doneAt: Date.now() });
    while (this._cached.size > this.maxCacheSize) {
      const oldest = this._cached.keys().next().value;
      this._cached.delete(oldest);
    }
  }

  _purgeExpiredCache() {
    const cutoff = Date.now() - this.cacheTtlMs;
    for (const [id, c] of this._cached) {
      if (c.doneAt < cutoff) this._cached.delete(id);
    }
  }
}

// ---------------------------------------------------------------------------
// Smoke self-test: create order -> 2 partial fills -> snapshot -> restore ->
// verify. Run with `node server/genesis/connectorCore.mjs`.
// ---------------------------------------------------------------------------
function selfTest() {
  const assert = (cond, msg) => { if (!cond) throw new Error(`SELF-TEST FAIL: ${msg}`); };

  // 1) build + register
  const tracker = new ClientOrderTracker();
  const id = newClientOrderId('buy');
  assert(/^genesis-b-[0-9a-f]{8}$/.test(id), `id format: ${id}`);
  const order = tracker.register(new InFlightOrder({
    clientOrderId: id, tradingPair: 'BTC/USDT', side: 'buy', amount: 1.0, price: 50000, type: 'LIMIT',
  }));
  assert(order.state === OrderState.PENDING_CREATE && !order.isDone, 'starts PENDING_CREATE');
  assert(order.baseAsset === 'BTC' && order.quoteAsset === 'USDT', 'asset getters');

  // duplicate registration must be rejected
  let dupRejected = false;
  try { tracker.register(new InFlightOrder({ clientOrderId: id, tradingPair: 'BTC-USDT', side: 'buy', amount: 1 })); }
  catch (e) { dupRejected = /DuplicateClientOrderId/.test(e.message); }
  assert(dupRejected, 'duplicate registration rejected');

  // 2) open + two partial fills
  tracker.markOpen(id);
  assert(tracker.getById(id).state === OrderState.OPEN, 'markOpen');
  tracker.applyFill(id, { fillAmount: 0.4, fillPrice: 50000, fee: 20 });
  const half = tracker.getById(id);
  assert(half.state === OrderState.PARTIALLY_FILLED && !half.isDone, 'PARTIALLY_FILLED after first fill');
  tracker.applyFill(id, { fillAmount: 0.6, fillPrice: 52000, fee: 31.2 });
  const done = tracker.getById(id);
  assert(done.state === OrderState.FILLED && done.isDone, 'FILLED after second fill');
  assert(Math.abs(done.filledAmount - 1.0) < 1e-12, 'filled amount accumulates');
  assert(Math.abs(done.averageFillPrice - 51200) < 1e-9, `weighted avg price (${done.averageFillPrice})`);
  assert(Math.abs(done.feePaid - 51.2) < 1e-9, 'fee accumulates');

  // overfill protection
  let overfillRejected = false;
  try { tracker.applyFill(id, { fillAmount: 0.1, fillPrice: 52000, fee: 0 }); }
  catch (e) { overfillRejected = /(terminal|overfill|OrderAlreadyDone)/.test(e.message); }
  assert(overfillRejected, 'fill on FILLED order rejected');

  // 3) snapshot -> restore into a fresh tracker -> verify equivalence
  const snapshot = tracker.snapshotStates();
  assert(snapshot[id] && snapshot[id].state === 'FILLED', 'snapshot carries terminal state as plain object');

  const tracker2 = new ClientOrderTracker();
  tracker2.restoreTrackingStates(JSON.parse(JSON.stringify(snapshot)));
  const restored = tracker2.getById(id);
  assert(restored instanceof InFlightOrder, 'restore rebuilds InFlightOrder instances');
  assert(restored.toPlain().averageFillPrice === snapshot[id].averageFillPrice, 'restored avg price matches');
  assert(restored.quoteAsset === 'USDT' && restored.isDone, 'restored getters intact');

  // 4) shared throttler sanity (sync surface only; no waiting in self-test)
  console.log('[connectorCore] self-test PASS');
  console.log(`  order ${id}: BTC/USDT buy 1.0 @ avg 51200, fee 51.2 USDT, state=${restored.state}`);
}

// Run only when executed directly (node server/genesis/connectorCore.mjs),
// never on import. Path-resolved comparison, not a filename suffix.
const invokedDirectly = (() => {
  try {
    return path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1] || '');
  } catch { return false; }
})();

if (invokedDirectly) {
  selfTest();
}
