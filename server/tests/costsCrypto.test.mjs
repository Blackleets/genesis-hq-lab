import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getCryptoFeePct,
  getCryptoFuturesFeePct,
  cryptoSlippagePct,
  cryptoFuturesSlippagePct,
  applyCryptoEntrySlippage,
  applyCryptoExitSlippage,
  cryptoNetPnl,
  estimateFuturesLiquidationPrice,
  estimateFuturesMaintenanceMarginUsd,
  estimateFundingFeeUsd,
  cryptoFuturesNetPnl,
} from '../trading/costs.mjs';

test('getCryptoFeePct defaults to 0.1% taker', () => {
  delete process.env.CRYPTO_FEE_PCT;
  assert.strictEqual(getCryptoFeePct(), 0.001);
});

test('getCryptoFeePct respects env override', () => {
  process.env.CRYPTO_FEE_PCT = '0.0004';
  assert.strictEqual(getCryptoFeePct(), 0.0004);
  delete process.env.CRYPTO_FEE_PCT;
});

test('getCryptoFuturesFeePct defaults to 0.04% taker', () => {
  delete process.env.CRYPTO_FUTURES_FEE_PCT;
  assert.strictEqual(getCryptoFuturesFeePct(), 0.0004);
});

test('cryptoSlippagePct liquid spot is small and size-tiered', () => {
  assert.strictEqual(cryptoSlippagePct(50, 50_000_000), 0.0002);
  assert.strictEqual(cryptoSlippagePct(500, 50_000), 0.001);
  assert.strictEqual(cryptoSlippagePct(0, 50_000_000), 0);
});

test('cryptoFuturesSlippagePct liquid futures is tighter than spot', () => {
  assert.strictEqual(cryptoFuturesSlippagePct(50, 50_000_000), 0.0001);
  assert.strictEqual(cryptoFuturesSlippagePct(500, 50_000), 0.0008);
});

test('applyCryptoEntrySlippage LONG pays more and SHORT receives less', () => {
  assert.ok(Math.abs(applyCryptoEntrySlippage('LONG', 100, 0.001) - 100.1) < 1e-9);
  assert.ok(Math.abs(applyCryptoEntrySlippage('SHORT', 100, 0.001) - 99.9) < 1e-9);
});

test('applyCryptoExitSlippage closing LONG sells lower and closing SHORT buys higher', () => {
  assert.ok(Math.abs(applyCryptoExitSlippage('LONG', 100, 0.001) - 99.9) < 1e-9);
  assert.ok(Math.abs(applyCryptoExitSlippage('SHORT', 100, 0.001) - 100.1) < 1e-9);
});

test('cryptoNetPnl LONG win is reduced by round-trip fees', () => {
  const net = cryptoNetPnl({ side: 'LONG', entryPrice: 100, exitPrice: 101.5, shares: 1, feePct: 0.001, slippagePct: 0 });
  assert.ok(Math.abs(net - 1.2985) < 0.01, `expected ~1.2985, got ${net}`);
  assert.ok(net < 1.5);
});

test('cryptoNetPnl SHORT win is reduced by round-trip fees', () => {
  const net = cryptoNetPnl({ side: 'SHORT', entryPrice: 100, exitPrice: 98.5, shares: 1, feePct: 0.001, slippagePct: 0 });
  assert.ok(Math.abs(net - 1.3015) < 0.01, `expected ~1.3015, got ${net}`);
});

test('cryptoNetPnl LONG loss is made worse by fees', () => {
  const net = cryptoNetPnl({ side: 'LONG', entryPrice: 100, exitPrice: 99.25, shares: 1, feePct: 0.001, slippagePct: 0 });
  assert.ok(net < -0.75, `loss must be worse than gross -0.75, got ${net}`);
});

test('cryptoNetPnl slippage degrades the win further', () => {
  const noSlip = cryptoNetPnl({ side: 'LONG', entryPrice: 100, exitPrice: 101.5, shares: 1, feePct: 0.001, slippagePct: 0 });
  const slip = cryptoNetPnl({ side: 'LONG', entryPrice: 100, exitPrice: 101.5, shares: 1, feePct: 0.001, slippagePct: 0.0005 });
  assert.ok(slip < noSlip, `slippage should reduce net (${slip} < ${noSlip})`);
});

test('cryptoNetPnl fees erode the 2:1 reward-risk ratio', () => {
  const win = cryptoNetPnl({ side: 'LONG', entryPrice: 100, exitPrice: 101.5, shares: 1, feePct: 0.001, slippagePct: 0.0005 });
  const loss = cryptoNetPnl({ side: 'LONG', entryPrice: 100, exitPrice: 99.25, shares: 1, feePct: 0.001, slippagePct: 0.0005 });
  assert.ok(win > 0 && loss < 0);
  assert.ok(win / Math.abs(loss) < 2);
});

test('estimateFuturesLiquidationPrice places long liq below entry and short liq above entry', () => {
  const longLiq = estimateFuturesLiquidationPrice({ side: 'LONG', entryPrice: 100, leverage: 5 });
  const shortLiq = estimateFuturesLiquidationPrice({ side: 'SHORT', entryPrice: 100, leverage: 5 });
  assert.ok(longLiq < 100);
  assert.ok(shortLiq > 100);
});

test('estimateFuturesMaintenanceMarginUsd scales with notional', () => {
  assert.equal(estimateFuturesMaintenanceMarginUsd(10_000, 0.005), 50);
});

test('estimateFundingFeeUsd charges linearly over 8h intervals', () => {
  assert.equal(estimateFundingFeeUsd({ notionalUsd: 1_000, fundingRate: 0.0001, holdingHours: 16 }), 0.2);
});

test('cryptoFuturesNetPnl funding and fees reduce net futures pnl', () => {
  const noFunding = cryptoFuturesNetPnl({ side: 'SHORT', entryPrice: 100, exitPrice: 98, shares: 1, feePct: 0.0004, fundingFeeUsd: 0 });
  const withFunding = cryptoFuturesNetPnl({ side: 'SHORT', entryPrice: 100, exitPrice: 98, shares: 1, feePct: 0.0004, fundingFeeUsd: 0.2 });
  assert.ok(withFunding < noFunding);
});
