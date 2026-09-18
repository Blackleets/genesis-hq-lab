import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAKER_EXECUTION_AUTHORITY,
  estimateQueueCoverage,
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
