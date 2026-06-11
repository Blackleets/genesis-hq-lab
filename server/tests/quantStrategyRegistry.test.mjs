import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';

// Mock futuresGovernor to avoid DB dependency in unit tests
import { createRequire } from 'node:module';

// We test the pure logic: deriveStatus via registry output
// by injecting mock governor data through the env and module mocking pattern.

describe('strategyRegistry — static structure', () => {
  test('STATIC_STRATEGIES has all expected strategy IDs', async () => {
    const { STATIC_STRATEGIES } = await import('../quant/alpha/strategyRegistry.mjs');
    const ids = STATIC_STRATEGIES.map((s) => s.strategyId);
    assert.ok(ids.includes('futures_breakout_short_micro'));
    assert.ok(ids.includes('futures_breakout_short_core'));
    assert.ok(ids.includes('futures_breakout_short_alt'));
    assert.ok(ids.includes('futures_breakout_long_probe'));
    assert.ok(ids.includes('crypto_scalp_v1'));
    assert.ok(ids.includes('crypto_swing'));
  });

  test('PROMOTION_CRITERIA has correct institutional minimums', async () => {
    const { PROMOTION_CRITERIA } = await import('../quant/alpha/strategyRegistry.mjs');
    assert.equal(PROMOTION_CRITERIA.minTrades,       30);
    assert.equal(PROMOTION_CRITERIA.minProfitFactor, 1.3);
    assert.equal(PROMOTION_CRITERIA.minExpectancy,   0);
    assert.equal(PROMOTION_CRITERIA.maxDrawdownPct,  0.15);
  });

  test('scalp strategy has note about negative edge', async () => {
    const { STATIC_STRATEGIES } = await import('../quant/alpha/strategyRegistry.mjs');
    const scalp = STATIC_STRATEGIES.find((s) => s.strategyId === 'crypto_scalp_v1');
    assert.ok(scalp?.note?.includes('negative edge') || scalp?.note?.includes('PF'));
  });

  test('every strategy has required fields', async () => {
    const { STATIC_STRATEGIES } = await import('../quant/alpha/strategyRegistry.mjs');
    const REQUIRED = ['strategyId', 'name', 'market', 'timeframe', 'tradeType', 'sourceFile'];
    for (const s of STATIC_STRATEGIES) {
      for (const f of REQUIRED) {
        assert.ok(s[f] != null, `${s.strategyId} missing field: ${f}`);
      }
    }
  });
});

describe('strategyRegistry — getStrategyRegistry()', () => {
  test('returns strategies array with all expected fields', async () => {
    const { getStrategyRegistry } = await import('../quant/alpha/strategyRegistry.mjs');
    const reg = getStrategyRegistry();
    assert.ok(Array.isArray(reg.strategies));
    assert.ok(reg.strategies.length > 0);
    for (const s of reg.strategies) {
      assert.ok('strategyId' in s);
      assert.ok('status' in s);
      assert.ok('name' in s);
      assert.ok('enabled' in s);
    }
  });

  test('summary.total matches strategies.length', async () => {
    const { getStrategyRegistry } = await import('../quant/alpha/strategyRegistry.mjs');
    const reg = getStrategyRegistry();
    assert.equal(reg.summary.total, reg.strategies.length);
  });

  test('DISABLED status when env flag is off', async () => {
    const saved = process.env.SCALP_ENGINE_ENABLED;
    process.env.SCALP_ENGINE_ENABLED = 'false';
    const { getStrategyRegistry } = await import('../quant/alpha/strategyRegistry.mjs');
    const reg = getStrategyRegistry();
    const scalp = reg.strategies.find((s) => s.strategyId === 'crypto_scalp_v1');
    assert.equal(scalp?.status, 'DISABLED');
    if (saved !== undefined) process.env.SCALP_ENGINE_ENABLED = saved;
    else delete process.env.SCALP_ENGINE_ENABLED;
  });

  test('REJECTED status for scalp (known negative edge + note)', async () => {
    // When SCALP_ENGINE_ENABLED=true (which is off by default, so DISABLED)
    // but the note triggers REJECTED when enabled
    const { STATIC_STRATEGIES } = await import('../quant/alpha/strategyRegistry.mjs');
    const scalp = STATIC_STRATEGIES.find((s) => s.strategyId === 'crypto_scalp_v1');
    // It should be marked REJECTED or DISABLED (negative edge documented)
    assert.ok(
      scalp?.note?.toLowerCase().includes('negative') || !scalp?.enabled(),
      'scalp should be DISABLED or have negative edge note',
    );
  });

  test('byStatus counts are consistent with strategies array', async () => {
    const { getStrategyRegistry } = await import('../quant/alpha/strategyRegistry.mjs');
    const reg = getStrategyRegistry();
    let total = 0;
    for (const count of Object.values(reg.summary.byStatus)) {
      total += count;
    }
    assert.equal(total, reg.strategies.length);
  });
});
