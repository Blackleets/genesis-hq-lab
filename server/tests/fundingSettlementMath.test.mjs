import test from 'node:test';
import assert from 'node:assert/strict';

import {
  fundingSettlementPnl,
  sideForFunding,
} from '../crypto/backtest/fundingSettlementMath.mjs';

test('positive funding selects short perp because longs pay shorts', () => {
  assert.equal(sideForFunding(0.0002), 'SHORT_PERP_LONG_SPOT');
});

test('negative funding selects long perp because shorts pay longs', () => {
  assert.equal(sideForFunding(-0.0002), 'LONG_PERP_SHORT_SPOT');
});

test('small funding inside threshold stays flat', () => {
  assert.equal(sideForFunding(0.00005), null);
  assert.equal(sideForFunding(-0.00005), null);
});

test('held receiving side earns signed settlement PnL', () => {
  assert.equal(fundingSettlementPnl({ rate: 0.0002, notional: 1000, side: 'SHORT_PERP_LONG_SPOT' }), 0.2);
  assert.equal(fundingSettlementPnl({ rate: -0.0002, notional: 1000, side: 'LONG_PERP_SHORT_SPOT' }), 0.2);
});

test('held wrong side records a funding loss instead of abs(rate) profit', () => {
  assert.equal(fundingSettlementPnl({ rate: -0.0002, notional: 1000, side: 'SHORT_PERP_LONG_SPOT' }), -0.2);
  assert.equal(fundingSettlementPnl({ rate: 0.0002, notional: 1000, side: 'LONG_PERP_SHORT_SPOT' }), -0.2);
});

test('invalid settlement inputs fail closed', () => {
  assert.equal(fundingSettlementPnl({ rate: 'bad', notional: 1000, side: 'SHORT_PERP_LONG_SPOT' }), null);
  assert.equal(fundingSettlementPnl({ rate: 0.0002, notional: -1, side: 'SHORT_PERP_LONG_SPOT' }), null);
  assert.equal(fundingSettlementPnl({ rate: 0.0002, notional: 1000, side: 'UNKNOWN' }), null);
});
