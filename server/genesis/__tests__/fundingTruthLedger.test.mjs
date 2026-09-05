import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildFundingTruthLedger,
  pricePnlForClosedTrade,
  reconcileFundingState,
} from '../fundingTruthLedger.mjs';

test('price PnL is exact for long and short closes', () => {
  assert.equal(pricePnlForClosedTrade({ side: 'long', entryPx: 100, exitPx: 105, notional: 1000 }), 50);
  assert.equal(pricePnlForClosedTrade({ side: 'short', entryPx: 100, exitPx: 105, notional: 1000 }), -50);
});

test('null explicit PnL does not erase reconstructable close economics', () => {
  assert.equal(pricePnlForClosedTrade({
    side: 'short',
    entryPx: 100,
    exitPx: 102,
    notional: 1000,
    realizedPricePnlUsdt: null,
  }), -20);
});

test('legacy closed MTM is recovered when exitPx was not persisted', () => {
  assert.equal(pricePnlForClosedTrade({ side: 'short', entryPx: 100, notional: 1000, mtmUsdt: -12.5 }), -12.5);
});

test('closed[] overrides stale persisted price total', () => {
  const state = {
    ledgerVersion: 2,
    capital: 10000,
    realizedFundingUsdt: 5,
    realizedPricePnlUsdt: 999,
    feesUsdt: 2,
    mtmUsdt: 0,
    holds: [],
    closed: [
      { side: 'short', entryPx: 100, exitPx: 102, notional: 1000, feeUsdt: 0.5 },
    ],
  };
  const ledger = buildFundingTruthLedger(state);
  assert.equal(ledger.realizedPricePnlUsdt, -20);
  assert.equal(ledger.realizedNetPnlUsdt, -17);
  assert.equal(ledger.reconciliation.pricePnlReconciliationDeltaUsdt, 1019);
});

test('economic PnL includes funding + realized price - fees + open MTM', () => {
  const state = reconcileFundingState({
    paper: true,
    capital: 10000,
    realizedFundingUsdt: 0.8668362719276501,
    feesUsdt: 6.25,
    mtmUsdt: 0,
    holds: [],
    closed: [
      { mtmUsdt: -1.348524878907995 },
      { mtmUsdt: -1.3639906469211451 },
      { mtmUsdt: -1.364416029939275 },
      { mtmUsdt: -4.811127244232409 },
      { mtmUsdt: -1.7906599178684663 },
      { mtmUsdt: -0.41491480416016674 },
      { mtmUsdt: -0.4148689014271033 },
    ],
  });

  assert.ok(Math.abs(state.realizedPricePnlUsdt - (-11.50850242345656)) < 1e-9);
  assert.ok(Math.abs(state.realizedNetPnlUsdt - (-16.89166615152891)) < 1e-9);
  assert.ok(Math.abs(state.equityUsdt - 9983.10833384847) < 1e-9);
  assert.equal(state.ledgerVersion, 2);
});

test('fee breakdown exposes legacy unallocated fees instead of inventing allocation', () => {
  const ledger = buildFundingTruthLedger({
    feesUsdt: 2,
    holds: [],
    closed: [{ feeUsdt: 0.5, mtmUsdt: 0 }],
  });
  assert.equal(ledger.feeBreakdown.knownEntryFeesUsdt, 0.5);
  assert.equal(ledger.feeBreakdown.unallocatedFeesUsdt, 1.5);
  assert.equal(ledger.reconciliation.legacyFeeAllocationIncomplete, true);
});
