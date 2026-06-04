import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kellySizeCalc } from '../trading/treasury.mjs';

const AVAILABLE = 9500;
const TOTAL     = 10000;

test('kellySizeCalc — positive edge returns a bet size', () => {
  // 70% confidence on a market priced at 0.60 → positive Kelly
  const result = kellySizeCalc(0.70, 0.60, AVAILABLE, TOTAL);
  assert.ok(!result.skip, 'should not skip');
  assert.ok(result.dollarSize > 0, 'should have positive dollar size');
  assert.ok(result.fraction > 0, 'fraction should be positive');
  assert.ok(result.fraction <= 0.05, 'fraction must not exceed 5% cap');
});

test('kellySizeCalc — negative edge returns skip', () => {
  // 45% confidence on a 0.60 market → negative Kelly
  const result = kellySizeCalc(0.45, 0.60, AVAILABLE, TOTAL);
  assert.ok(result.skip, 'negative edge should skip');
});

test('kellySizeCalc — 5% cap is enforced', () => {
  // Extremely high confidence should still be capped at 5%
  const result = kellySizeCalc(0.99, 0.10, AVAILABLE, TOTAL);
  assert.ok(!result.skip);
  assert.ok(result.fraction <= 0.05, `fraction ${result.fraction} exceeds 5% cap`);
  assert.ok(result.dollarSize <= TOTAL * 0.05 + 0.01, 'dollar size exceeds cap');
});

test('kellySizeCalc — tiny available returns skip when size below minimum', () => {
  // With only $0.40 available, any bet would be below $0.50 minimum
  const result = kellySizeCalc(0.70, 0.60, 0.40, 0.40);
  assert.ok(result.skip, 'should skip when size is below minimum');
});

test('kellySizeCalc — half-Kelly is applied (half of full Kelly)', () => {
  const full = kellySizeCalc(0.70, 0.60, AVAILABLE, TOTAL);
  assert.ok(full.fullKelly > full.halfKelly, 'halfKelly should be less than fullKelly');
  assert.ok(Math.abs(full.halfKelly - full.fullKelly / 2) < 0.0001, 'halfKelly should be exactly half');
});
