import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getCryptoFeePct,
  cryptoSlippagePct,
  applyCryptoEntrySlippage,
  applyCryptoExitSlippage,
  cryptoNetPnl,
} from '../trading/costs.mjs';

test('getCryptoFeePct — defaults to 0.1% taker', () => {
  delete process.env.CRYPTO_FEE_PCT;
  assert.strictEqual(getCryptoFeePct(), 0.001);
});

test('getCryptoFeePct — respects env override', () => {
  process.env.CRYPTO_FEE_PCT = '0.0004';
  assert.strictEqual(getCryptoFeePct(), 0.0004);
  delete process.env.CRYPTO_FEE_PCT;
});

test('cryptoSlippagePct — liquid spot is small and size-tiered', () => {
  // $50 order on $50M volume → ratio 1e-6 → tiniest tier
  assert.strictEqual(cryptoSlippagePct(50, 50_000_000), 0.0002);
  // $500 order on $50k volume → ratio 0.01 → top tier
  assert.strictEqual(cryptoSlippagePct(500, 50_000), 0.001);
  // zero order → no impact
  assert.strictEqual(cryptoSlippagePct(0, 50_000_000), 0);
});

test('applyCryptoEntrySlippage — LONG pays more, SHORT receives less', () => {
  assert.ok(Math.abs(applyCryptoEntrySlippage('LONG', 100, 0.001) - 100.1) < 1e-9);
  assert.ok(Math.abs(applyCryptoEntrySlippage('SHORT', 100, 0.001) - 99.9) < 1e-9);
});

test('applyCryptoExitSlippage — closing LONG sells lower, closing SHORT buys higher', () => {
  assert.ok(Math.abs(applyCryptoExitSlippage('LONG', 100, 0.001) - 99.9) < 1e-9);
  assert.ok(Math.abs(applyCryptoExitSlippage('SHORT', 100, 0.001) - 100.1) < 1e-9);
});

test('cryptoNetPnl — LONG win is reduced by round-trip fees', () => {
  // gross = (101.5 - 100) * 1 = 1.5; fees = 0.001*(100+101.5)=0.2015 → net ~1.2985
  const net = cryptoNetPnl({ side: 'LONG', entryPrice: 100, exitPrice: 101.5, shares: 1, feePct: 0.001, slippagePct: 0 });
  assert.ok(Math.abs(net - 1.2985) < 0.01, `expected ~1.2985, got ${net}`);
  assert.ok(net < 1.5, 'net must be below gross 1.5');
});

test('cryptoNetPnl — SHORT win is reduced by round-trip fees', () => {
  // gross = (100 - 98.5) * 1 = 1.5; fees = 0.001*(100+98.5)=0.1985 → net ~1.3015
  const net = cryptoNetPnl({ side: 'SHORT', entryPrice: 100, exitPrice: 98.5, shares: 1, feePct: 0.001, slippagePct: 0 });
  assert.ok(Math.abs(net - 1.3015) < 0.01, `expected ~1.3015, got ${net}`);
});

test('cryptoNetPnl — LONG loss is made worse by fees', () => {
  // gross = (99.25 - 100) = -0.75; fees ~0.199 → net ~-0.949
  const net = cryptoNetPnl({ side: 'LONG', entryPrice: 100, exitPrice: 99.25, shares: 1, feePct: 0.001, slippagePct: 0 });
  assert.ok(net < -0.75, `loss must be worse than gross -0.75, got ${net}`);
});

test('cryptoNetPnl — slippage degrades the win further', () => {
  const noSlip = cryptoNetPnl({ side: 'LONG', entryPrice: 100, exitPrice: 101.5, shares: 1, feePct: 0.001, slippagePct: 0 });
  const slip   = cryptoNetPnl({ side: 'LONG', entryPrice: 100, exitPrice: 101.5, shares: 1, feePct: 0.001, slippagePct: 0.0005 });
  assert.ok(slip < noSlip, `slippage should reduce net (${slip} < ${noSlip})`);
});

test('cryptoNetPnl — fees erode the 2:1 reward/risk ratio', () => {
  // After costs, a +1.5% win and a -0.75% loss no longer sit at a clean 2:1.
  const win  = cryptoNetPnl({ side: 'LONG', entryPrice: 100, exitPrice: 101.5,  shares: 1, feePct: 0.001, slippagePct: 0.0005 });
  const loss = cryptoNetPnl({ side: 'LONG', entryPrice: 100, exitPrice: 99.25,  shares: 1, feePct: 0.001, slippagePct: 0.0005 });
  assert.ok(win > 0 && loss < 0, 'win positive, loss negative');
  const ratio = win / Math.abs(loss);
  assert.ok(ratio < 2, `net reward/risk must drop below 2 after costs, got ${ratio.toFixed(3)}`);
});
