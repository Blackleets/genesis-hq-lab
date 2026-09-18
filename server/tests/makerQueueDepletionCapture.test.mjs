import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMakerFillObservation,
  captureMakerQueueBurst,
} from '../genesis/makerQueueDepletionCapture.mjs';

function book(time, overrides = {}) {
  return {
    time,
    source: 'okx_books_rpi',
    instId: 'BTC-USDT-SWAP',
    rpiBestBid: 99.95,
    rpiBestAsk: 100.05,
    rpiBestBidQty: 5,
    rpiBestAskQty: 4,
    rpiMidPrice: 100,
    rpiSpreadBps: 10,
    rpiDepthImbalance: 0.1,
    rpiMicropriceSkewBps: 0.5,
    ...overrides,
  };
}

function flow(start, end, overrides = {}) {
  return {
    available: true,
    source: 'okx_public_history_trades_interval',
    requestedStartTime: start,
    requestedEndTime: end,
    tradeCount: 4,
    buyContracts: 7,
    sellContracts: 8,
    pagesFetched: 1,
    ...overrides,
  };
}

test('BUY observation uses post-entry sell flow and zero cancellation credit', () => {
  const start = 1_800_000_000_000;
  const end = start + 10_000;
  const row = buildMakerFillObservation({
    side: 'BUY',
    targetHorizonMs: 10_000,
    orderSizeUnits: 2,
    entryBook: book(start),
    futureBook: book(end, { rpiMidPrice: 99.90 }),
    takerInterval: flow(start, end, { sellContracts: 6 }),
  });
  assert.equal(row.queueAheadUnits, 5);
  assert.equal(row.aggressiveFlowTowardQuoteUnits, 6);
  assert.equal(row.filledUnits, 1);
  assert.equal(row.fillRatio, 0.5);
  assert.equal(row.fullFill, false);
  assert.ok(row.adverseSelectionBps > 0);
  assert.equal(row.provenance.priceTouchAloneCountsAsFill, false);
});

test('SELL observation uses post-entry buy flow', () => {
  const start = 1_800_000_000_000;
  const end = start + 3_000;
  const row = buildMakerFillObservation({
    side: 'SELL',
    targetHorizonMs: 3_000,
    orderSizeUnits: 2,
    entryBook: book(start),
    futureBook: book(end, { rpiMidPrice: 100.10 }),
    takerInterval: flow(start, end, { buyContracts: 5 }),
  });
  assert.equal(row.queueAheadUnits, 4);
  assert.equal(row.aggressiveFlowTowardQuoteUnits, 5);
  assert.equal(row.fillRatio, 0.5);
  assert.ok(row.adverseSelectionBps > 0);
});

test('no queue-depleting flow means zero fill rather than touch fill', () => {
  const start = 1_800_000_000_000;
  const end = start + 1_000;
  const row = buildMakerFillObservation({
    side: 'BUY',
    targetHorizonMs: 1_000,
    orderSizeUnits: 2,
    entryBook: book(start),
    futureBook: book(end),
    takerInterval: flow(start, end, { sellContracts: 5 }),
  });
  assert.equal(row.fillRatio, 0);
  assert.equal(row.spreadCaptureBps, null);
  assert.equal(row.adverseSelectionBps, null);
});

test('mismatched exact flow interval boundaries fail closed', () => {
  const start = 1_800_000_000_000;
  const targetEnd = start + 10_000;
  const future = start + 11_000;
  const wrongStart = buildMakerFillObservation({
    side: 'BUY',
    targetHorizonMs: 10_000,
    orderSizeUnits: 2,
    entryBook: book(start),
    futureBook: book(future),
    takerInterval: flow(start - 1, targetEnd),
  });
  assert.equal(wrongStart, null);

  const optimisticEnd = buildMakerFillObservation({
    side: 'BUY',
    targetHorizonMs: 10_000,
    orderSizeUnits: 2,
    entryBook: book(start),
    futureBook: book(future),
    takerInterval: flow(start, future),
  });
  assert.equal(optimisticEnd, null);
});

test('future markout beyond 25 percent horizon drift fails closed', () => {
  const start = 1_800_000_000_000;
  const row = buildMakerFillObservation({
    side: 'BUY',
    targetHorizonMs: 1_000,
    orderSizeUnits: 1,
    entryBook: book(start),
    futureBook: book(start + 1_300),
    takerInterval: flow(start, start + 1_000),
  });
  assert.equal(row, null);
});

test('burst captures 1s 3s 10s horizons with injected causal evidence', async () => {
  const start = 1_800_000_000_000;
  const books = [
    book(start),
    book(start + 1_200),
    book(start + 3_600),
    book(start + 11_200),
  ];
  let bookIndex = 0;
  const sleeps = [];
  const requestedIntervals = [];
  const bookFetcher = async () => books[bookIndex++];
  const flowFetcher = async (_inst, { startTimeMs, endTimeMs }) => {
    requestedIntervals.push([startTimeMs, endTimeMs]);
    return flow(startTimeMs, endTimeMs, { buyContracts: 10, sellContracts: 10 });
  };
  const sleepImpl = async ms => { sleeps.push(ms); };

  const burst = await captureMakerQueueBurst({
    instId: 'BTC-USDT-SWAP',
    orderSizeUnits: 1,
    horizonsMs: [1_000, 3_000, 10_000],
    bookFetcher,
    flowFetcher,
    sleepImpl,
  });

  assert.deepEqual(sleeps, [1_000, 2_000, 7_000]);
  assert.deepEqual(requestedIntervals, [
    [start, start + 1_000],
    [start, start + 3_000],
    [start, start + 10_000],
  ]);
  assert.equal(burst.observationCount, 6);
  assert.equal(burst.failureCount, 0);
  assert.deepEqual(
    [...new Set(burst.observations.map(row => row.targetHorizonMs))],
    [1_000, 3_000, 10_000],
  );
  assert.ok(burst.observations.every(row => row.boundaries.executionAuthority === false));
  assert.ok(burst.observations.every(row => row.flowHorizonMs === row.targetHorizonMs));
  assert.ok(burst.observations.every(row => row.markoutHorizonDriftRatio <= 0.25));
  assert.ok(burst.observations.every(row => row.provenance.exactFlowHorizon === true));
});
