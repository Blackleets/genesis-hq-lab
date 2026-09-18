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


test('no fill has zero realized adverse selection even when mid moves sharply', () => {
  const current = { capturedAtMs: 1000, bid: 99.95, ask: 100.05, mid: 100, bidQty: 10, askQty: 10 };
  const next = { mid: 99.5 };
  const x = passiveQuoteWindow({
    current, next, trades: [], quoteNotionalUsd: 100,
    queueAheadMultiplier: 1, makerFeeBpsPerSide: 0, inventoryReserveBps: 0,
  });
  assert.equal(x.outcome, 'NO_FILL');
  assert.equal(x.adverseSelectionBps, 0);
  assert.ok(x.nextMidMoveBps < 0);
});

test('bid fill adverse selection is harmful-only and fill weighted', () => {
  const current = { capturedAtMs: 1000, bid: 99.95, ask: 100.05, mid: 100, bidQty: 1, askQty: 100 };
  const adverse = passiveQuoteWindow({
    current,
    next: { mid: 99.90 },
    trades: [{ time: 1010, price: 99.95, qty: 1.5, buyerIsMaker: true }],
    quoteNotionalUsd: 100,
    queueAheadMultiplier: 1,
  });
  assert.equal(adverse.bidFillRatio, 0.5);
  assert.equal(adverse.askFillRatio, 0);
  assert.ok(Math.abs(adverse.bidAdverseSelectionBps - 5) < 1e-9);
  assert.ok(Math.abs(adverse.adverseSelectionBps - 2.5) < 1e-9);

  const favorable = passiveQuoteWindow({
    current,
    next: { mid: 100.10 },
    trades: [{ time: 1010, price: 99.95, qty: 2, buyerIsMaker: true }],
    quoteNotionalUsd: 100,
    queueAheadMultiplier: 1,
  });
  assert.equal(favorable.bidFillRatio, 1);
  assert.equal(favorable.bidAdverseSelectionBps, 0);
  assert.equal(favorable.adverseSelectionBps, 0);
});

test('ask fill adverse selection is harmful-only and fill weighted', () => {
  const current = { capturedAtMs: 1000, bid: 99.95, ask: 100.05, mid: 100, bidQty: 100, askQty: 1 };
  const adverse = passiveQuoteWindow({
    current,
    next: { mid: 100.10 },
    trades: [{ time: 1010, price: 100.05, qty: 1.5, buyerIsMaker: false }],
    quoteNotionalUsd: 100,
    queueAheadMultiplier: 1,
  });
  assert.equal(adverse.askFillRatio, 0.5);
  assert.equal(adverse.bidFillRatio, 0);
  assert.ok(Math.abs(adverse.askAdverseSelectionBps - 5) < 1e-9);
  assert.ok(Math.abs(adverse.adverseSelectionBps - 2.5) < 1e-9);

  const favorable = passiveQuoteWindow({
    current,
    next: { mid: 99.90 },
    trades: [{ time: 1010, price: 100.05, qty: 2, buyerIsMaker: false }],
    quoteNotionalUsd: 100,
    queueAheadMultiplier: 1,
  });
  assert.equal(favorable.askFillRatio, 1);
  assert.equal(favorable.askAdverseSelectionBps, 0);
  assert.equal(favorable.adverseSelectionBps, 0);
});

test('two-sided fills only charge the side with harmful markout and preserve signed mid move', () => {
  const current = { capturedAtMs: 1000, bid: 99.95, ask: 100.05, mid: 100, bidQty: 1, askQty: 1 };
  const next = { mid: 100.10 };
  const trades = [
    { time: 1010, price: 99.95, qty: 2, buyerIsMaker: true },
    { time: 1011, price: 100.05, qty: 2, buyerIsMaker: false },
  ];
  const x = passiveQuoteWindow({
    current, next, trades, quoteNotionalUsd: 100,
    queueAheadMultiplier: 1,
  });
  assert.equal(x.bidFillRatio, 1);
  assert.equal(x.askFillRatio, 1);
  assert.equal(x.bidAdverseSelectionBps, 0);
  assert.ok(Math.abs(x.askAdverseSelectionBps - 5) < 1e-9);
  assert.ok(Math.abs(x.adverseSelectionBps - 5) < 1e-9);
  assert.ok(Math.abs(x.nextMidMoveBps - 10) < 1e-9);
});
