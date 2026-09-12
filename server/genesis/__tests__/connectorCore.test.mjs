// server/genesis/__tests__/connectorCore.test.mjs
// Order-lifecycle core: duplicate registration guard, weighted-average partial
// fills, overfill rejection, snapshot/restore round-trip.

import { describe, it, expect } from 'vitest';
import {
  OrderState,
  InFlightOrder,
  ClientOrderTracker,
  newClientOrderId,
} from '../connectorCore.mjs';

function makeTracker() {
  return new ClientOrderTracker({ maxCacheSize: 100, cacheTtlMs: 30_000 });
}

describe('connectorCore / ClientOrderTracker', () => {
  it('rejects duplicate registration of the same clientOrderId', () => {
    const tracker = makeTracker();
    const id = newClientOrderId('buy');
    tracker.register(new InFlightOrder({
      clientOrderId: id, tradingPair: 'BTC/USDT', side: 'buy', amount: 1, price: 50_000,
    }));
    expect(() => tracker.register(new InFlightOrder({
      clientOrderId: id, tradingPair: 'BTC-USDT', side: 'buy', amount: 1,
    }))).toThrowError(/DuplicateClientOrderId/);
    // The original registration survives untouched.
    expect(tracker.getById(id).amount).toBe(1);
  });

  it('partial fills accumulate filledAmount and a weighted average fill price', () => {
    const tracker = makeTracker();
    const id = newClientOrderId('sell');
    tracker.register(new InFlightOrder({
      clientOrderId: id, tradingPair: 'ETH/USDT', side: 'sell', amount: 2.0, price: 3_000,
    }));
    tracker.markOpen(id);

    tracker.applyFill(id, { fillAmount: 0.5, fillPrice: 3_000, fee: 0.75 });
    const half = tracker.getById(id);
    expect(half.state).toBe(OrderState.PARTIALLY_FILLED);
    expect(half.filledAmount).toBeCloseTo(0.5, 12);
    expect(half.averageFillPrice).toBeCloseTo(3_000, 9);

    // Second fill at a different price -> weighted average.
    tracker.applyFill(id, { fillAmount: 1.5, fillPrice: 3_100, fee: 2.325 });
    const done = tracker.getById(id);
    expect(done.state).toBe(OrderState.FILLED);
    expect(done.isDone).toBe(true);
    expect(done.filledAmount).toBeCloseTo(2.0, 12);
    // (0.5*3000 + 1.5*3100) / 2.0 = 3075
    expect(done.averageFillPrice).toBeCloseTo(3_075, 9);
    expect(done.feePaid).toBeCloseTo(3.075, 9);
  });

  it('rejects an overfill beyond the ordered amount', () => {
    const tracker = makeTracker();
    const id = newClientOrderId('buy');
    tracker.register(new InFlightOrder({
      clientOrderId: id, tradingPair: 'BTC/USDT', side: 'buy', amount: 1.0, price: 50_000,
    }));
    tracker.markOpen(id);
    tracker.applyFill(id, { fillAmount: 0.9, fillPrice: 50_000, fee: 0 });
    expect(() => tracker.applyFill(id, { fillAmount: 0.2, fillPrice: 50_000, fee: 0 }))
      .toThrowError(/overfill/);
    // State was not corrupted by the rejected fill.
    const o = tracker.getById(id);
    expect(o.filledAmount).toBeCloseTo(0.9, 12);
    expect(o.state).toBe(OrderState.PARTIALLY_FILLED);
  });

  it('snapshotStates -> restoreTrackingStates restores an identical tracking map', () => {
    const tracker = makeTracker();

    // One partially filled live order...
    const liveId = newClientOrderId('buy');
    tracker.register(new InFlightOrder({
      clientOrderId: liveId, tradingPair: 'BTC/USDT', side: 'buy', amount: 1.0, price: 50_000,
    }));
    tracker.markOpen(liveId);
    tracker.applyFill(liveId, { fillAmount: 0.4, fillPrice: 50_000, fee: 20 });

    // ...and one fully filled (cached) order.
    const doneId = newClientOrderId('sell');
    tracker.register(new InFlightOrder({
      clientOrderId: doneId, tradingPair: 'BTC/USDT', side: 'sell', amount: 0.5, price: 51_000,
    }));
    tracker.markOpen(doneId);
    tracker.applyFill(doneId, { fillAmount: 0.5, fillPrice: 51_500, fee: 12.87 });

    const snapshot = JSON.parse(JSON.stringify(tracker.snapshotStates()));
    expect(Object.keys(snapshot).sort()).toEqual([liveId, doneId].sort());

    const restored = makeTracker().restoreTrackingStates(snapshot);
    for (const id of [liveId, doneId]) {
      const a = tracker.getById(id).toPlain();
      const b = restored.getById(id).toPlain();
      expect(b).toEqual(a);
      expect(restored.getById(id)).toBeInstanceOf(InFlightOrder);
    }
    // Live vs cached routing is preserved too.
    expect(restored.activeOrders.map(o => o.clientOrderId)).toEqual([liveId]);
    expect(restored.getById(doneId).isDone).toBe(true);
  });
});
