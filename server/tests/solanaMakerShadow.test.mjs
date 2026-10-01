import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SOLANA_MAKER_EXECUTION_AUTHORITY,
  SOLANA_MAKER_LIVE_LOCKED,
  SOLANA_MAKER_MODE,
  SOLANA_MAKER_POLICY,
  SolanaMakerShadowLoop,
  buildPassiveMakerQuote,
  decideMakerQuoteLifecycle,
  evaluateSolanaMakerShadow,
  normalizeMakerBook,
} from '../genesis/solanaMakerShadow.mjs';

const observedAt = '2026-09-27T08:19:00.000Z';

function snapshot(overrides = {}) {
  return {
    venue: 'PHOENIX_SHADOW_INPUT',
    market: 'SOL/USDC',
    bestBid: 99.95,
    bestAsk: 100.05,
    tickSize: 0.01,
    bidDepthUsd: 10_000,
    askDepthUsd: 9_000,
    slot: 123456,
    observedAt,
    ...overrides,
  };
}

function calibratedEvidence(overrides = {}) {
  return {
    fillProbability: { buy: 0.5, sell: 0.5 },
    fillSamples: { buy: 200, sell: 200 },
    makerFeeBps: 0,
    adverseSelectionBps: { buy: 0.5, sell: 0.5 },
    baseFeeUsd: 0.00002,
    priorityFeeUsd: 0.00002,
    cancelReplaceFeeUsd: 0.00002,
    ...overrides,
  };
}

const permissivePolicy = Object.freeze({
  ...SOLANA_MAKER_POLICY,
  minSpreadBps: 2,
  minNetEdgeBps: 1,
  minFillSamples: 10,
  inventoryPenaltyMaxBps: 0,
});

test('maker engine is SHADOW-only and LIVE locked', () => {
  assert.equal(SOLANA_MAKER_MODE, 'SHADOW');
  assert.equal(SOLANA_MAKER_EXECUTION_AUTHORITY, false);
  assert.equal(SOLANA_MAKER_LIVE_LOCKED, true);
});

test('passive maker quotes never cross the touch and stay tick-aligned', () => {
  const book = normalizeMakerBook(snapshot(), { nowMs: new Date(observedAt).getTime() });
  const buy = buildPassiveMakerQuote({ book, side: 'buy', policy: permissivePolicy });
  const sell = buildPassiveMakerQuote({ book, side: 'sell', policy: permissivePolicy });

  assert.ok(buy.price < book.bestAsk);
  assert.ok(sell.price > book.bestBid);
  assert.equal(buy.postOnly, true);
  assert.equal(sell.postOnly, true);
  assert.equal(buy.crossesTouch, false);
  assert.equal(sell.crossesTouch, false);
  assert.ok(Math.abs((buy.price / book.tickSize) - Math.round(buy.price / book.tickSize)) < 1e-8);
  assert.ok(Math.abs((sell.price / book.tickSize) - Math.round(sell.price / book.tickSize)) < 1e-8);
});

test('unknown fill, fee or adverse-selection evidence fails closed', () => {
  const result = evaluateSolanaMakerShadow({
    snapshot: snapshot(),
    evidence: {},
    inventoryUsd: 0,
    policy: permissivePolicy,
    nowMs: new Date(observedAt).getTime(),
  });

  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.selected, null);
  const blockers = new Set(result.candidates.flatMap((candidate) => candidate.blockers));
  assert.ok(blockers.has('fill_probability_unknown'));
  assert.ok(blockers.has('fill_model_uncalibrated'));
  assert.ok(blockers.has('maker_fee_unknown'));
  assert.ok(blockers.has('adverse_selection_unknown'));
  assert.ok(blockers.has('lifecycle_cost_unknown'));
  assert.ok(result.candidates.every((candidate) => candidate.economics.netEdgeBps === null));
});

test('calibrated positive maker economics produce only an eligible SHADOW intent', () => {
  const result = evaluateSolanaMakerShadow({
    snapshot: snapshot(),
    evidence: calibratedEvidence(),
    inventoryUsd: 0,
    policy: permissivePolicy,
    nowMs: new Date(observedAt).getTime(),
  });

  assert.equal(result.status, 'ELIGIBLE_SHADOW');
  assert.ok(result.selected);
  assert.ok(result.selected.economics.expectedNetPnlUsd > 0);
  assert.ok(result.selected.economics.netEdgeBps >= permissivePolicy.minNetEdgeBps);
  assert.equal(result.executionAuthority, false);
  assert.equal(result.liveLocked, true);
  assert.ok(result.events.some((event) => event.type === 'OPPORTUNITY_DETECTED' && event.decision === 'SHADOW_ACCEPTED'));
  assert.equal(new Set(result.events.map((event) => event.eventId)).size, result.events.length);
});

test('adverse selection can erase a visible spread and blocks the quote', () => {
  const result = evaluateSolanaMakerShadow({
    snapshot: snapshot(),
    evidence: calibratedEvidence({ adverseSelectionBps: { buy: 8, sell: 8 } }),
    inventoryUsd: 0,
    policy: permissivePolicy,
    nowMs: new Date(observedAt).getTime(),
  });

  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.candidates.every((candidate) => candidate.economics.expectedNetPnlUsd < 0));
  assert.ok(result.candidates.every((candidate) => candidate.blockers.includes('net_not_positive')));
});

test('inventory cap blocks risk-increasing side while allowing the reducing side', () => {
  const result = evaluateSolanaMakerShadow({
    snapshot: snapshot(),
    evidence: calibratedEvidence(),
    inventoryUsd: permissivePolicy.maxInventoryUsd,
    policy: permissivePolicy,
    nowMs: new Date(observedAt).getTime(),
  });
  const buy = result.candidates.find((candidate) => candidate.side === 'buy');
  const sell = result.candidates.find((candidate) => candidate.side === 'sell');

  assert.ok(buy.blockers.includes('inventory_cap'));
  assert.equal(sell.blockers.includes('inventory_cap'), false);
  assert.equal(result.selected?.side, 'sell');
});

test('stale market data blocks maker promotion', () => {
  const result = evaluateSolanaMakerShadow({
    snapshot: snapshot(),
    evidence: calibratedEvidence(),
    policy: permissivePolicy,
    nowMs: new Date(observedAt).getTime() + permissivePolicy.maxBookAgeMs + 1,
  });
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.candidates.every((candidate) => candidate.blockers.includes('book_stale')));
});

test('cancel/replace lifecycle reacts to stale, blocked and repriced intents', () => {
  const previous = { side: 'buy', price: 100, observedAt };
  assert.equal(decideMakerQuoteLifecycle({ previousIntent: null, nextIntent: previous }).action, 'PLACE_SHADOW');
  assert.equal(decideMakerQuoteLifecycle({ previousIntent: previous, nextIntent: null }).action, 'CANCEL_SHADOW');
  assert.equal(decideMakerQuoteLifecycle({
    previousIntent: previous,
    nextIntent: { ...previous, price: 100.02 },
    policy: { ...permissivePolicy, repriceThresholdBps: 1 },
    nowMs: new Date(observedAt).getTime(),
  }).action, 'REPLACE_SHADOW');
  assert.equal(decideMakerQuoteLifecycle({
    previousIntent: previous,
    nextIntent: { ...previous, price: 100.0001 },
    policy: { ...permissivePolicy, repriceThresholdBps: 1 },
    nowMs: new Date(observedAt).getTime(),
  }).action, 'KEEP_SHADOW');
});

test('hot-path loop emits intents and timing without any transaction authority', async () => {
  const loop = new SolanaMakerShadowLoop({ policy: permissivePolicy });
  const result = await loop.cycle({
    readBook: async () => snapshot(),
    readEvidence: async () => calibratedEvidence(),
    now: () => new Date(observedAt),
  });

  assert.equal(result.ok, true);
  assert.equal(result.lifecycle.action, 'PLACE_SHADOW');
  assert.equal(result.liveLocked, true);
  assert.equal(result.executionAuthority, false);
  assert.ok(Number.isInteger(result.timing.readMs));
  assert.ok(Number.isInteger(result.timing.loopMs));
  assert.equal(result.stats.cycles, 1);
});
