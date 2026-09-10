import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPECTED_SETTLES,
  MIN_NET_EDGE_BPS,
  ROUND_TRIP_FEE_BPS,
  feesDominate,
  fundingEconomics,
  targetSettlesReached,
} from '../genesis/fundingHold.mjs';

test('feesDominate locks new tickets when collected funding is below fees', () => {
  assert.equal(feesDominate({ realizedFundingUsdt: 1, feesUsdt: 2 }), true);
  assert.equal(feesDominate({ realizedFundingUsdt: 3, feesUsdt: 2 }), false);
});

test('funding economics rejects headline funding that cannot pay round-trip costs', () => {
  const out = fundingEconomics({ predBps: 6, meanBps: 6, spreadBps: 1 });
  assert.equal(ROUND_TRIP_FEE_BPS, 10);
  assert.equal(EXPECTED_SETTLES, 2);
  assert.equal(out.grossCaptureBps, 12);
  assert.equal(out.executionCostBps, 13);
  assert.equal(out.netEdgeBps, -1);
  assert.equal(out.pass, false);
  assert.equal(out.reason, 'FUNDING_EDGE_BELOW_EXECUTION_HURDLE');
});

test('funding economics admits only conservative post-cost edge above the safety margin', () => {
  const out = fundingEconomics({ predBps: 10, meanBps: 9, spreadBps: 1 });
  assert.equal(out.grossCaptureBps, 18);
  assert.equal(out.executionCostBps, 13);
  assert.equal(out.netEdgeBps, 5);
  assert.ok(out.netEdgeBps >= MIN_NET_EDGE_BPS);
  assert.equal(out.pass, true);
  assert.equal(out.reason, null);
});

test('missing numeric evidence never becomes a zero-cost edge', () => {
  for (const input of [
    { predBps: null, meanBps: 9, spreadBps: 1 },
    { predBps: 10, meanBps: undefined, spreadBps: 1 },
    { predBps: 10, meanBps: 9, spreadBps: '' },
  ]) {
    const out = fundingEconomics(input);
    assert.equal(out.pass, false);
    assert.equal(out.reason, 'ECONOMICS_EVIDENCE_MISSING');
    assert.equal(out.netEdgeBps, null);
  }
});

test('paper lifecycle exits at the exact settle target used by entry economics', () => {
  assert.equal(targetSettlesReached({ settledCount: 0, expectedSettles: 2 }), false);
  assert.equal(targetSettlesReached({ settledCount: 1, expectedSettles: 2 }), false);
  assert.equal(targetSettlesReached({ settledCount: 2, expectedSettles: 2 }), true);
  assert.equal(targetSettlesReached({ settledCount: 3, expectedSettles: 2 }), true);
  assert.equal(targetSettlesReached({ settledCount: null, expectedSettles: 2 }), false);
});

test('legacy paper holds use the conservative configured settle target', () => {
  assert.equal(targetSettlesReached({ settledCount: 1 }), false);
  assert.equal(targetSettlesReached({ settledCount: EXPECTED_SETTLES }), true);
});
