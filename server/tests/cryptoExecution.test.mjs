import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCryptoTargets, computeCryptoPnl } from '../crypto/cryptoExecution.mjs';

test('computeCryptoTargets — LONG: target +1.5%, stop -0.75%', () => {
  const { targetPrice, stopPrice } = computeCryptoTargets('LONG', 100);
  assert.ok(Math.abs(targetPrice - 101.5) < 0.01, `target ~101.5, got ${targetPrice}`);
  assert.ok(Math.abs(stopPrice - 99.25) < 0.01, `stop ~99.25, got ${stopPrice}`);
});

test('computeCryptoTargets — SHORT: target -1.5%, stop +0.75%', () => {
  const { targetPrice, stopPrice } = computeCryptoTargets('SHORT', 100);
  assert.ok(Math.abs(targetPrice - 98.5) < 0.01, `target ~98.5, got ${targetPrice}`);
  assert.ok(Math.abs(stopPrice - 100.75) < 0.01, `stop ~100.75, got ${stopPrice}`);
});

test('computeCryptoTargets — low-priced asset keeps precision (no rounding collapse)', () => {
  // DOGE ≈ $0.12: rounding to 2 decimals would make target == entry (fake instant wins).
  const p = { targetPct: 0.015, stopPct: 0.0075 };
  const { targetPrice, stopPrice } = computeCryptoTargets('LONG', 0.12, p);
  assert.ok(targetPrice > 0.12, `target must exceed entry, got ${targetPrice}`);
  assert.ok(stopPrice < 0.12, `stop must be below entry, got ${stopPrice}`);
  // ~ +1.5% / -0.75% preserved
  assert.ok(Math.abs(targetPrice - 0.1218) < 0.0002, `~0.1218, got ${targetPrice}`);
  assert.ok(Math.abs(stopPrice - 0.11910) < 0.0002, `~0.11910, got ${stopPrice}`);
});

test('computeCryptoPnl — LONG WIN', () => {
  const pnl = computeCryptoPnl('LONG', 100, 101.5, 0.5);
  assert.ok(Math.abs(pnl - 0.75) < 0.001, `~0.75, got ${pnl}`);
});

test('computeCryptoPnl — LONG LOSS', () => {
  const pnl = computeCryptoPnl('LONG', 100, 99.25, 0.5);
  assert.ok(Math.abs(pnl - (-0.375)) < 0.001, `~-0.375, got ${pnl}`);
});

test('computeCryptoPnl — SHORT WIN', () => {
  const pnl = computeCryptoPnl('SHORT', 100, 98.5, 0.5);
  assert.ok(Math.abs(pnl - 0.75) < 0.001, `~0.75, got ${pnl}`);
});

test('computeCryptoPnl — SHORT LOSS', () => {
  const pnl = computeCryptoPnl('SHORT', 100, 100.75, 0.5);
  assert.ok(Math.abs(pnl - (-0.375)) < 0.001, `~-0.375, got ${pnl}`);
});
