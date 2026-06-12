import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { computeAllocation } from '../quant/portfolio/allocationEngine.mjs';
import { _resetGlobalRiskForTest } from '../risk/globalRiskEngine.mjs';

// Uses real dependencies (no module mocking) — DB safe mode is off by default.
// Pass `availableCapital` explicitly to skip the treasury DB lookup.

const CAPITAL = 10_000;

describe('computeAllocation — return shape', () => {
  before(() => _resetGlobalRiskForTest());
  after(() => _resetGlobalRiskForTest());

  test('always returns required top-level fields', () => {
    const result = computeAllocation({ availableCapital: CAPITAL });
    assert.ok('allocations'        in result);
    assert.ok('totalAllocatedPct'  in result);
    assert.ok('totalAllocatedUsd'  in result);
    assert.ok('blocked'            in result);
    assert.ok('updatedAt'          in result);
  });

  test('allocations is an array', () => {
    const result = computeAllocation({ availableCapital: CAPITAL });
    assert.ok(Array.isArray(result.allocations));
  });

  test('blocked is false when safe mode is off', () => {
    const result = computeAllocation({ availableCapital: CAPITAL });
    assert.equal(result.blocked, false);
  });

  test('totalAllocatedPct is a number between 0 and 0.5 (portfolio cap)', () => {
    const result = computeAllocation({ availableCapital: CAPITAL });
    assert.ok(typeof result.totalAllocatedPct === 'number');
    assert.ok(result.totalAllocatedPct >= 0);
    assert.ok(result.totalAllocatedPct <= 0.50, `totalAllocatedPct ${result.totalAllocatedPct} exceeded portfolio cap`);
  });

  test('each allocation entry has required fields', () => {
    const result = computeAllocation({ availableCapital: CAPITAL });
    for (const alloc of result.allocations) {
      assert.ok('strategyId'             in alloc, 'missing strategyId');
      assert.ok('name'                   in alloc, 'missing name');
      assert.ok('status'                 in alloc, 'missing status');
      assert.ok('recommendedCapitalPct'  in alloc, 'missing recommendedCapitalPct');
      assert.ok('maxPositionUsd'         in alloc, 'missing maxPositionUsd');
    }
  });
});

describe('computeAllocation — status rules', () => {
  before(() => _resetGlobalRiskForTest());
  after(() => _resetGlobalRiskForTest());

  test('REJECTED strategies get 0% allocation', () => {
    const result = computeAllocation({ availableCapital: CAPITAL });
    const rejected = result.allocations.filter((a) => a.status === 'REJECTED');
    for (const r of rejected) {
      assert.equal(r.recommendedCapitalPct, 0, `REJECTED ${r.strategyId} should get 0%`);
      assert.equal(r.maxPositionUsd, 0);
    }
  });

  test('DISABLED strategies get 0% allocation', () => {
    const result = computeAllocation({ availableCapital: CAPITAL });
    const disabled = result.allocations.filter((a) => a.status === 'DISABLED');
    for (const d of disabled) {
      assert.equal(d.recommendedCapitalPct, 0, `DISABLED ${d.strategyId} should get 0%`);
    }
  });

  test('RESEARCH strategies get 0% allocation', () => {
    const result = computeAllocation({ availableCapital: CAPITAL });
    const research = result.allocations.filter((a) => a.status === 'RESEARCH');
    for (const r of research) {
      assert.equal(r.recommendedCapitalPct, 0, `RESEARCH ${r.strategyId} should get 0%`);
    }
  });

  test('PAPER strategies get at most 5%', () => {
    const result = computeAllocation({ availableCapital: CAPITAL });
    const paper = result.allocations.filter((a) => a.status === 'PAPER');
    for (const p of paper) {
      assert.ok(
        p.recommendedCapitalPct <= 0.05,
        `PAPER ${p.strategyId} got ${p.recommendedCapitalPct} > 5%`,
      );
    }
  });

  test('PAPER allocation is flagged as paper mode', () => {
    const result = computeAllocation({ availableCapital: CAPITAL });
    const paper = result.allocations.filter((a) => a.status === 'PAPER');
    for (const p of paper) {
      assert.equal(p.paperMode, true, `PAPER ${p.strategyId} should have paperMode=true`);
    }
  });

  test('PROMOTED strategies get at most 20% each', () => {
    const result = computeAllocation({ availableCapital: CAPITAL });
    const promoted = result.allocations.filter((a) => a.status === 'PROMOTED');
    for (const p of promoted) {
      assert.ok(
        p.recommendedCapitalPct <= 0.20,
        `PROMOTED ${p.strategyId} got ${p.recommendedCapitalPct} > 20%`,
      );
    }
  });
});

describe('computeAllocation — daily loss cap blocks all', () => {
  let savedCap;

  before(() => {
    _resetGlobalRiskForTest();
    savedCap = process.env.CRYPTO_DAILY_LOSS_CAP;
    // Cap of 0 means any dailyLossToday (even 0) hits the cap
    process.env.CRYPTO_DAILY_LOSS_CAP = '0';
  });

  after(() => {
    if (savedCap !== undefined) process.env.CRYPTO_DAILY_LOSS_CAP = savedCap;
    else delete process.env.CRYPTO_DAILY_LOSS_CAP;
    _resetGlobalRiskForTest();
  });

  test('returns blocked=true when daily loss cap is exceeded', () => {
    const result = computeAllocation({ availableCapital: CAPITAL });
    assert.equal(result.blocked, true);
    assert.equal(result.reason, 'DAILY_LOSS_CAP');
  });

  test('blocked result has empty allocations array', () => {
    const result = computeAllocation({ availableCapital: CAPITAL });
    assert.ok(Array.isArray(result.allocations));
    assert.equal(result.allocations.length, 0);
  });

  test('blocked result has 0% totalAllocatedPct', () => {
    const result = computeAllocation({ availableCapital: CAPITAL });
    assert.equal(result.totalAllocatedPct, 0);
    assert.equal(result.totalAllocatedUsd, 0);
  });
});

describe('computeAllocation — capital math', () => {
  before(() => _resetGlobalRiskForTest());
  after(() => _resetGlobalRiskForTest());

  test('totalAllocatedUsd is consistent with totalAllocatedPct and allocatableCapital', () => {
    const result = computeAllocation({ availableCapital: CAPITAL });
    if (!result.blocked) {
      // allocatableCapital = capital - 500 buffer = 9500
      const expectedUsd = Math.round(result.allocatableCapital * result.totalAllocatedPct * 100) / 100;
      assert.ok(
        Math.abs(result.totalAllocatedUsd - expectedUsd) < 0.05,
        `USD ${result.totalAllocatedUsd} doesn't match pct ${result.totalAllocatedPct} × capital ${result.allocatableCapital}`,
      );
    }
  });

  test('availableCapital reflects the passed-in value', () => {
    const result = computeAllocation({ availableCapital: 5000 });
    if (!result.blocked) {
      assert.equal(result.availableCapital, 5000);
    }
  });

  test('allocatableCapital = availableCapital minus 500 buffer', () => {
    const result = computeAllocation({ availableCapital: 5000 });
    if (!result.blocked) {
      assert.equal(result.allocatableCapital, 4500);
    }
  });

  test('no allocation returns null maxPositionUsd for PAPER with zero capital', () => {
    const result = computeAllocation({ availableCapital: 0 });
    if (!result.blocked) {
      // With capital=0, allocatableCapital = max(0, 0-500) = 0
      const paper = result.allocations.filter((a) => a.status === 'PAPER');
      for (const p of paper) {
        assert.equal(p.maxPositionUsd, 0, 'PAPER strategy should get $0 when capital is 0');
      }
    }
  });
});

describe('computeAllocation — strategy count', () => {
  before(() => _resetGlobalRiskForTest());
  after(() => _resetGlobalRiskForTest());

  test('allocations length matches total strategy count in registry', async () => {
    const { getStrategyRegistry } = await import('../quant/alpha/strategyRegistry.mjs');
    const reg    = getStrategyRegistry();
    const result = computeAllocation({ availableCapital: CAPITAL });
    if (!result.blocked) {
      assert.equal(
        result.allocations.length,
        reg.strategies.length,
        'every strategy should have an allocation entry',
      );
    }
  });
});
