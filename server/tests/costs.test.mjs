import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSlippage,
  applySlippageToPrice,
  computePolymarketFee,
  netPnl,
  computePaperFillCosts,
} from '../trading/costs.mjs';

test('computeSlippage — tiny order is 0.5%', () => {
  const result = computeSlippage(20, 10_000);
  assert.strictEqual(result, 0.005);
});

test('computeSlippage — medium order is 1%', () => {
  const result = computeSlippage(100, 10_000);
  assert.strictEqual(result, 0.01);
});

test('computeSlippage — large order is 2%', () => {
  const result = computeSlippage(300, 10_000);
  assert.strictEqual(result, 0.02);
});

test('applySlippageToPrice — raises entry price by slippage', () => {
  // Buying YES at 0.60 with 1% slippage → effective price 0.606
  const effective = applySlippageToPrice(0.60, 0.01);
  assert.ok(Math.abs(effective - 0.606) < 0.0001, `Expected ~0.606 got ${effective}`);
});

test('computePolymarketFee — 2% of gross winnings on a win', () => {
  // Bought YES at 0.60, resolves YES → gross payout per share = 1.0 - 0.60 = 0.40
  // fee = 0.40 * 0.02 = 0.008 per share; 10 shares → $0.08
  const fee = computePolymarketFee(0.60, 10, true);
  assert.ok(Math.abs(fee - 0.08) < 0.001, `Expected 0.08 got ${fee}`);
});

test('computePolymarketFee — zero fee on a loss', () => {
  const fee = computePolymarketFee(0.60, 10, false);
  assert.strictEqual(fee, 0);
});

test('netPnl — win scenario: positive PnL minus fee', () => {
  // Capital $60 on 100 shares at $0.60. Resolves YES → gross PnL = $40, fee = $0.80
  const result = netPnl({ capitalUsed: 60, shares: 100, entryPrice: 0.60, won: true });
  assert.ok(Math.abs(result - 39.20) < 0.01, `Expected ~39.20 got ${result}`);
});

test('netPnl — loss scenario: negative PnL, no fee', () => {
  // Capital $60. Resolves NO → lose the capital
  const result = netPnl({ capitalUsed: 60, shares: 100, entryPrice: 0.60, won: false });
  assert.ok(Math.abs(result - (-60)) < 0.01, `Expected -60 got ${result}`);
});

test('applySlippageToPrice — capped at 0.99 for near-certainty markets', () => {
  const effective = applySlippageToPrice(0.98, 0.02);
  assert.strictEqual(effective, 0.99);
});

test('computeSlippage — zero order size returns 0 slippage', () => {
  const result = computeSlippage(0, 10_000);
  assert.strictEqual(result, 0);
});

test('computePaperFillCosts — returns effective price, shares, capital and costNote', () => {
  const result = computePaperFillCosts({
    entryPrice: 0.60,
    shares: 100,
    capitalUsed: 60,
    volume24h: 10_000,
  });
  // $60 / $10000 = 0.006 → medium slippage 1%
  assert.strictEqual(result.slippage, 0.01);
  assert.ok(Math.abs(result.effectivePrice - 0.606) < 0.0001, `effectivePrice: ${result.effectivePrice}`);
  // effectiveShares = floor(60 / 0.606) = floor(99.009...) = 99
  assert.strictEqual(result.effectiveShares, 99);
  assert.ok(typeof result.costNote === 'string' && result.costNote.includes('slippage'), 'costNote should mention slippage');
});
