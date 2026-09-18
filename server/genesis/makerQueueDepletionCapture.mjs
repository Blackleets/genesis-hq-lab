// RESEARCH_ONLY maker queue-depletion evidence capture.
// Captures an entry RPI book, then exact post-entry aggressive trade flow and
// future RPI books at predeclared horizons. No orders, signatures or cancellations.

import fs from 'node:fs';
import path from 'node:path';
import { getOkxRpiOrderBookContext } from './okxRpiOrderBook.mjs';
import { fetchTakerInterval } from './okxFixedWindowTaker.mjs';

export const MAKER_QUEUE_TAPE_VERSION = 'maker_queue_depletion_tape_v1';
export const MAKER_QUEUE_TAPE_MODE = 'RESEARCH_ONLY';
export const DEFAULT_MAKER_HORIZONS_MS = Object.freeze([1_000, 3_000, 10_000]);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function nonNegative(value) {
  const n = finite(value);
  return n !== null && n >= 0 ? n : null;
}

function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value));
}

export function buildMakerFillObservation({
  instId = 'BTC-USDT-SWAP',
  side,
  targetHorizonMs,
  orderSizeUnits,
  entryBook,
  futureBook,
  takerInterval,
  capturedAt = new Date().toISOString(),
} = {}) {
  const normalizedSide = String(side ?? '').toUpperCase();
  if (normalizedSide !== 'BUY' && normalizedSide !== 'SELL') return null;

  const horizon = nonNegative(targetHorizonMs);
  const orderSize = nonNegative(orderSizeUnits);
  const entryTime = finite(entryBook?.time);
  const futureTime = finite(futureBook?.time);
  const entryMid = finite(entryBook?.rpiMidPrice);
  const futureMid = finite(futureBook?.rpiMidPrice);
  const spreadBps = nonNegative(entryBook?.rpiSpreadBps);
  const bid = finite(entryBook?.rpiBestBid);
  const ask = finite(entryBook?.rpiBestAsk);
  const queueAheadUnits = normalizedSide === 'BUY'
    ? nonNegative(entryBook?.rpiBestBidQty)
    : nonNegative(entryBook?.rpiBestAskQty);
  const aggressiveFlowTowardQuoteUnits = normalizedSide === 'BUY'
    ? nonNegative(takerInterval?.sellContracts)
    : nonNegative(takerInterval?.buyContracts);

  const inputsKnown =
    horizon !== null && horizon > 0 &&
    orderSize !== null && orderSize > 0 &&
    entryTime !== null &&
    futureTime !== null &&
    futureTime > entryTime &&
    entryMid !== null && entryMid > 0 &&
    futureMid !== null && futureMid > 0 &&
    spreadBps !== null && spreadBps > 0 &&
    bid !== null && bid > 0 &&
    ask !== null && ask > bid &&
    queueAheadUnits !== null &&
    aggressiveFlowTowardQuoteUnits !== null &&
    takerInterval?.available === true &&
    Number(takerInterval?.requestedStartTime) === entryTime &&
    Number(takerInterval?.requestedEndTime) === futureTime;

  if (!inputsKnown) return null;

  const quotePrice = normalizedSide === 'BUY' ? bid : ask;
  const fillableUnits = Math.max(0, aggressiveFlowTowardQuoteUnits - queueAheadUnits);
  const filledUnits = clamp(fillableUnits, 0, orderSize);
  const fillRatio = filledUnits / orderSize;
  const requiredForFullFill = queueAheadUnits + orderSize;
  const queueCoverage = requiredForFullFill > 0
    ? aggressiveFlowTowardQuoteUnits / requiredForFullFill
    : null;
  const spreadCaptureBps = fillRatio > 0
    ? Math.abs((entryMid - quotePrice) / entryMid) * 10_000
    : null;
  const adverseSelectionBps = fillRatio > 0
    ? normalizedSide === 'BUY'
      ? Math.max(0, ((quotePrice - futureMid) / entryMid) * 10_000)
      : Math.max(0, ((futureMid - quotePrice) / entryMid) * 10_000)
    : null;

  return {
    schemaVersion: 1,
    mode: MAKER_QUEUE_TAPE_MODE,
    version: MAKER_QUEUE_TAPE_VERSION,
    provider: 'okx',
    instId,
    side: normalizedSide,
    targetHorizonMs: horizon,
    actualHorizonMs: futureTime - entryTime,
    observedAt: new Date(futureTime).toISOString(),
    capturedAt,
    entrySourceTime: entryTime,
    futureSourceTime: futureTime,
    orderSizeUnits: orderSize,
    queueAheadUnits,
    aggressiveFlowTowardQuoteUnits,
    queueCoverage,
    filledUnits,
    fillRatio,
    fullFill: fillRatio === 1,
    quotePrice,
    entryMidPrice: entryMid,
    futureMidPrice: futureMid,
    spreadBps,
    spreadCaptureBps,
    adverseSelectionBps,
    entryDepthImbalance: finite(entryBook?.rpiDepthImbalance),
    entryMicropriceSkewBps: finite(entryBook?.rpiMicropriceSkewBps),
    flowEvidence: {
      source: takerInterval.source,
      requestedStartTime: takerInterval.requestedStartTime,
      requestedEndTime: takerInterval.requestedEndTime,
      tradeCount: takerInterval.tradeCount,
      buyContracts: takerInterval.buyContracts,
      sellContracts: takerInterval.sellContracts,
      pagesFetched: takerInterval.pagesFetched ?? null,
    },
    provenance: {
      bookSource: entryBook?.source ?? 'okx_books_rpi',
      futureBookSource: futureBook?.source ?? 'okx_books_rpi',
      flowSource: takerInterval.source,
      queuePolicy: 'ZERO_CANCELLATION_CREDIT_FIFO_LOWER_BOUND',
      fillRule: 'AGGRESSIVE_FLOW_MINUS_QUEUE_AHEAD_CLAMPED_TO_ORDER_SIZE',
      priceTouchAloneCountsAsFill: false,
    },
    boundaries: {
      executionAuthority: false,
      signsTransactions: false,
      broadcastsTransactions: false,
      liveLocked: true,
    },
  };
}

export async function captureMakerQueueBurst({
  instId = 'BTC-USDT-SWAP',
  orderSizeUnits = 1,
  horizonsMs = DEFAULT_MAKER_HORIZONS_MS,
  depth = 20,
  bookFetcher = getOkxRpiOrderBookContext,
  flowFetcher = fetchTakerInterval,
  sleepImpl = sleep,
} = {}) {
  const orderedHorizons = [...new Set(horizonsMs.map(Number))]
    .filter(value => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (!orderedHorizons.length) throw new Error('no_valid_maker_horizons');

  const entryBook = await bookFetcher(instId, { depth });
  const observations = [];
  const failures = [];
  let elapsedTarget = 0;

  for (const targetHorizonMs of orderedHorizons) {
    await sleepImpl(Math.max(0, targetHorizonMs - elapsedTarget));
    elapsedTarget = targetHorizonMs;

    try {
      const futureBook = await bookFetcher(instId, { depth });
      const flow = await flowFetcher(instId, {
        startTimeMs: entryBook.time,
        endTimeMs: futureBook.time,
      });
      for (const side of ['BUY', 'SELL']) {
        const observation = buildMakerFillObservation({
          instId,
          side,
          targetHorizonMs,
          orderSizeUnits,
          entryBook,
          futureBook,
          takerInterval: flow,
        });
        if (observation) observations.push(observation);
        else failures.push({ targetHorizonMs, side, reason: flow?.reason ?? 'INVALID_EVIDENCE' });
      }
    } catch (error) {
      failures.push({
        targetHorizonMs,
        side: 'BOTH',
        reason: String(error?.message || error),
      });
    }
  }

  return {
    mode: MAKER_QUEUE_TAPE_MODE,
    version: MAKER_QUEUE_TAPE_VERSION,
    executionAuthority: false,
    liveLocked: true,
    instId,
    orderSizeUnits,
    horizonsMs: orderedHorizons,
    observationCount: observations.length,
    failureCount: failures.length,
    observations,
    failures,
  };
}

export function appendMakerObservationsJsonl(jsonl, observations = []) {
  if (!jsonl || !observations.length) return;
  fs.mkdirSync(path.dirname(jsonl), { recursive: true });
  fs.appendFileSync(jsonl, observations.map(row => JSON.stringify(row)).join('\n') + '\n');
}

function valueAfter(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

if (process.argv[1]?.endsWith('makerQueueDepletionCapture.mjs')) {
  const args = process.argv.slice(2);
  const instId = valueAfter(args, '--inst') || 'BTC-USDT-SWAP';
  const out = valueAfter(args, '--out');
  const jsonl = valueAfter(args, '--jsonl');
  const samples = Math.max(1, Number(valueAfter(args, '--samples') || 1));
  const orderSizeUnits = Math.max(0.000001, Number(valueAfter(args, '--order-size-units') || 1));
  const sampleGapMs = Math.max(0, Number(valueAfter(args, '--sample-gap-ms') || 1_000));
  const horizonsMs = (valueAfter(args, '--horizons') || '1000,3000,10000')
    .split(',')
    .map(Number)
    .filter(value => Number.isFinite(value) && value > 0);

  const all = [];
  const failures = [];
  for (let i = 0; i < samples; i += 1) {
    const burst = await captureMakerQueueBurst({ instId, orderSizeUnits, horizonsMs });
    all.push(...burst.observations);
    failures.push(...burst.failures);
    if (i < samples - 1 && sampleGapMs > 0) await sleep(sampleGapMs);
  }

  appendMakerObservationsJsonl(jsonl, all);
  const payload = {
    mode: MAKER_QUEUE_TAPE_MODE,
    version: MAKER_QUEUE_TAPE_VERSION,
    executionAuthority: false,
    liveLocked: true,
    generatedAt: new Date().toISOString(),
    instId,
    samples,
    horizonsMs,
    orderSizeUnits,
    observationCount: all.length,
    failureCount: failures.length,
    observations: all,
    failures,
  };
  if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(payload, null, 2) + '\n');
  }
  console.log(JSON.stringify({
    version: payload.version,
    instId,
    samples,
    observationCount: payload.observationCount,
    failureCount: payload.failureCount,
  }));
}
