import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAKER_EXECUTION_AUTHORITY,
  buildMakerShadowInputFromEvidence,
  estimateQueueCoverage,
  evaluateMakerEvidence,
  evaluateMakerShadowCandidate,
} from '../genesis/makerMicrostructureShadow.mjs';

function base(overrides = {}) {
  return {
    symbol: 'BTC-USDT-SWAP',
    venue: 'okx',
    side: 'BUY',
    notionalUsd: 100,
    observedSpreadBps: 4,
    empiricalSpreadCaptureBps: 3,
    makerFeeBps: 0,
    adverseSelectionBps: 0.5,
    inventoryRiskBps: 0.25,
    quoteAttemptCostUsd: 0,
    failedAttemptCostUsd: 0,
    sourceAgeMs: 250,
    queueAheadUsd: 50,
    orderSizeUsd: 100,
    aggressiveFlowTowardQuoteUsd: 180,
    empiricalFillProbability: 0.35,
    ...overrides,
  };
}

test('maker shadow has no execution authority', () => {
  assert.equal(MAKER_EXECUTION_AUTHORITY, false);
  assert.equal(evaluateMakerShadowCandidate(base()).executionAuthority, false);
});

test('queue coverage gives zero credit to cancellations and measures only observed aggressive flow', () => {
  assert.equal(estimateQueueCoverage({
    queueAheadUsd: 50,
    orderSizeUsd: 100,
    aggressiveFlowTowardQuoteUsd: 75,
  }), 0.5);
});

test('candidate survives only when queue, empirical fill, costs and adverse selection all pass', () => {
  const r = evaluateMakerShadowCandidate(base());
  assert.equal(r.verdict, 'SHADOW_CANDIDATE');
  assert.ok(r.perFillEdgeBps > 0);
  assert.ok(r.expectedNetPnlUsd > 0);
  assert.ok(r.queueCoverage >= 1);
});

test('missing adverse-selection evidence fails closed', () => {
  const r = evaluateMakerShadowCandidate(base({ adverseSelectionBps: null }));
  assert.equal(r.verdict, 'NO_GO');
  assert.ok(r.blockers.includes('inputsKnown'));
  assert.equal(r.expectedNetPnlUsd, null);
});

test('touch without enough queue-depleting flow is not treated as a fill', () => {
  const r = evaluateMakerShadowCandidate(base({ aggressiveFlowTowardQuoteUsd: 20 }));
  assert.equal(r.verdict, 'NO_GO');
  assert.ok(r.blockers.includes('queueCoverage'));
});

test('quote costs can kill an otherwise positive maker edge', () => {
  const r = evaluateMakerShadowCandidate(base({ quoteAttemptCostUsd: 0.10 }));
  assert.equal(r.verdict, 'NO_GO');
  assert.ok(r.blockers.includes('expectedNetPositive'));
});

test('stale book is rejected even when economic inputs are positive', () => {
  const r = evaluateMakerShadowCandidate(base({ sourceAgeMs: 2_500 }));
  assert.equal(r.verdict, 'NO_GO');
  assert.ok(r.blockers.includes('fresh'));
});


test('empirical capture cannot exceed the spread actually observed', () => {
  const r = evaluateMakerShadowCandidate(base({
    observedSpreadBps: 2,
    empiricalSpreadCaptureBps: 3,
  }));
  assert.equal(r.verdict, 'NO_GO');
  assert.ok(r.blockers.includes('captureWithinObservedSpread'));
});


test('real book + fixed-window taker evidence maps queue pressure by maker side', () => {
  const capturedAt = '2026-09-18T13:00:01.000Z';
  const book = {
    instId: 'BTC-USDT-SWAP',
    time: Date.parse('2026-09-18T13:00:00.500Z'),
    rpiBestBidQty: 50,
    rpiBestAskQty: 40,
    rpiSpreadBps: 4,
  };
  const taker = {
    time: Date.parse('2026-09-18T13:00:00.800Z'),
    buyContracts: 100,
    sellContracts: 200,
  };
  const calibration = {
    empiricalSpreadCaptureBps: 3,
    makerFeeBps: 0,
    adverseSelectionBps: 0.5,
    inventoryRiskBps: 0.25,
    quoteAttemptCostUsd: 0,
    failedAttemptCostUsd: 0,
    empiricalFillProbability: 0.35,
  };

  const buyInput = buildMakerShadowInputFromEvidence({
    side: 'BUY',
    orderSizeUnits: 100,
    notionalUsd: 100,
    book,
    taker,
    calibration,
    capturedAt,
  });
  assert.equal(buyInput.queueAheadUnits, 50);
  assert.equal(buyInput.aggressiveFlowTowardQuoteUnits, 200);
  assert.equal(buyInput.sourceAgeMs, 500);

  const buy = evaluateMakerEvidence({
    side: 'BUY',
    orderSizeUnits: 100,
    notionalUsd: 100,
    book,
    taker,
    calibration,
    capturedAt,
  });
  assert.equal(buy.queueCoverageBasis, 'contract_units');
  assert.equal(buy.verdict, 'SHADOW_CANDIDATE');

  const sell = evaluateMakerEvidence({
    side: 'SELL',
    orderSizeUnits: 100,
    notionalUsd: 100,
    book,
    taker,
    calibration,
    capturedAt,
  });
  assert.equal(sell.queueAheadUnits, 40);
  assert.equal(sell.aggressiveFlowTowardQuoteUnits, 100);
  assert.equal(sell.verdict, 'NO_GO');
  assert.ok(sell.blockers.includes('queueCoverage'));
});

test('future or missing source timestamps fail closed in evidence adapter', () => {
  const input = buildMakerShadowInputFromEvidence({
    side: 'BUY',
    orderSizeUnits: 1,
    notionalUsd: 100,
    capturedAt: '2026-09-18T13:00:00.000Z',
    book: { time: Date.parse('2026-09-18T13:00:01.000Z'), rpiBestBidQty: 1, rpiSpreadBps: 2 },
    taker: { time: Date.parse('2026-09-18T12:59:59.000Z'), sellContracts: 10 },
  });
  assert.equal(input.sourceAgeMs, null);
  assert.equal(evaluateMakerShadowCandidate(input).verdict, 'NO_GO');
});


test('empty-string numeric evidence fails closed instead of coercing to zero', () => {
  const r = evaluateMakerShadowCandidate(base({ adverseSelectionBps: '' }));
  assert.equal(r.verdict, 'NO_GO');
  assert.ok(r.blockers.includes('inputsKnown'));
  assert.equal(r.adverseSelectionBps, null);
});

test('non-numeric and non-finite evidence fail closed', () => {
  for (const value of ['not-a-number', Number.NaN, Number.POSITIVE_INFINITY]) {
    const r = evaluateMakerShadowCandidate(base({ inventoryRiskBps: value }));
    assert.equal(r.verdict, 'NO_GO');
    assert.ok(r.blockers.includes('inputsKnown'));
    assert.equal(r.inventoryRiskBps, null);
  }
});

test('negative queue evidence cannot satisfy queue coverage', () => {
  const coverage = estimateQueueCoverage({
    queueAheadUsd: -1,
    orderSizeUsd: 100,
    aggressiveFlowTowardQuoteUsd: 1_000,
  });
  assert.equal(coverage, null);

  const r = evaluateMakerShadowCandidate(base({ queueAheadUsd: -1 }));
  assert.equal(r.verdict, 'NO_GO');
  assert.ok(r.blockers.includes('inputsKnown'));
  assert.ok(r.blockers.includes('queueCoverage'));
});

test('fill probability outside [0, 1] fails closed', () => {
  for (const value of [-0.01, 1.01]) {
    const r = evaluateMakerShadowCandidate(base({ empiricalFillProbability: value }));
    assert.equal(r.verdict, 'NO_GO');
    assert.ok(r.blockers.includes('inputsKnown'));
    assert.ok(r.blockers.includes('fillProbability'));
    assert.equal(r.empiricalFillProbability, null);
  }
});

test('missing side cannot become a candidate', () => {
  const r = evaluateMakerShadowCandidate(base({ side: null }));
  assert.equal(r.verdict, 'NO_GO');
  assert.ok(r.blockers.includes('inputsKnown'));
  assert.equal(r.side, null);
});

test('zero notional is invalid economic evidence', () => {
  const r = evaluateMakerShadowCandidate(base({ notionalUsd: 0 }));
  assert.equal(r.verdict, 'NO_GO');
  assert.ok(r.blockers.includes('inputsKnown'));
  assert.equal(r.expectedNetPnlUsd, null);
});
