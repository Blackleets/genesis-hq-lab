import test from 'node:test';
import assert from 'node:assert/strict';
import {
  micropriceFromTop,
  riskAdversePartialFill,
  filterTradesAfterActivation,
  passiveQuoteWindow,
} from '../../src/core/passiveQueueExecution.mjs';

test('risk-adverse queue only fills after traded flow consumes queue ahead', () => {
  assert.deepEqual(
    riskAdversePartialFill({ queueAheadQty: 5, quoteQty: 2, aggressorQty: 4 }),
    { filledQty: 0, fillRatio: 0, queueAheadQty: 5, aggressorQty: 4 },
  );
  const partial = riskAdversePartialFill({ queueAheadQty: 5, quoteQty: 2, aggressorQty: 6 });
  assert.equal(partial.filledQty, 1);
  assert.equal(partial.fillRatio, 0.5);
  const full = riskAdversePartialFill({ queueAheadQty: 5, quoteQty: 2, aggressorQty: 8 });
  assert.equal(full.fillRatio, 1);
});

test('latency removes trades that occurred before a quote could be active', () => {
  const rows = [{ time: 1000 }, { time: 1050 }, { time: 1100 }];
  assert.deepEqual(filterTradesAfterActivation(rows, 1051).map(x => x.time), [1100]);
});

test('microprice shifts toward ask when bid queue is heavier', () => {
  const m = micropriceFromTop({ bid: 99, ask: 101, bidQty: 9, askQty: 1 });
  assert.ok(m > 100);
});

test('full two-sided fill captures spread minus two maker fees', () => {
  const current = { capturedAtMs: 1000, bid: 99.95, ask: 100.05, mid: 100, bidQty: 1, askQty: 1 };
  const next = { mid: 100 };
  const trades = [
    { time: 1010, price: 99.95, qty: 2, buyerIsMaker: true },
    { time: 1011, price: 100.05, qty: 2, buyerIsMaker: false },
  ];
  const x = passiveQuoteWindow({
    current, next, trades, quoteNotionalUsd: 100,
    queueAheadMultiplier: 1, makerFeeBpsPerSide: 1, inventoryReserveBps: 1, orderLatencyMs: 0,
  });
  assert.equal(x.outcome, 'FULL_BOTH');
  assert.ok(Math.abs(x.grossCaptureBps - 10) < 1e-9);
  assert.ok(Math.abs(x.netCaptureBps - 8) < 1e-9);
});

test('one-sided partial fill is scaled instead of pretending a full fill', () => {
  const current = { capturedAtMs: 1000, bid: 99.95, ask: 100.05, mid: 100, bidQty: 1, askQty: 1 };
  const next = { mid: 100.02 };
  const trades = [{ time: 1100, price: 99.95, qty: 1.5, buyerIsMaker: true }];
  const x = passiveQuoteWindow({
    current, next, trades, quoteNotionalUsd: 100,
    queueAheadMultiplier: 1, makerFeeBpsPerSide: 1, inventoryReserveBps: 1, orderLatencyMs: 0,
  });
  assert.equal(x.bidFillRatio, 0.5);
  assert.equal(x.askFillRatio, 0);
  assert.equal(x.outcome, 'PARTIAL_ONE_SIDE');
});
