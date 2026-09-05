import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateStrategyProfile } from '../quant/validation/validationGate.mjs';

// validateStrategyProfile is pure (no DB): unit-testable directly.
// runSystemValidation requires DB — tested via integration check only.

describe('validateStrategyProfile — rejects bad strategies', () => {
  test('rejects strategy with fewer than 30 trades', () => {
    const result = validateStrategyProfile({ trades: 15, profitFactor: 1.5, avgPnl: 5, winRate: 0.6, paused: false });
    assert.equal(result.approved, false);
    assert.ok(result.reasons.some((r) => r.includes('30') || r.includes('trades')));
  });

  test('rejects strategy with profit factor < 1.3', () => {
    const result = validateStrategyProfile({ trades: 50, profitFactor: 1.1, avgPnl: 2, winRate: 0.55, paused: false });
    assert.equal(result.approved, false);
    assert.ok(result.reasons.some((r) => r.includes('PF') || r.includes('profit') || r.includes('1.1')));
  });

  test('rejects strategy with negative EV (avgPnl ≤ 0)', () => {
    const result = validateStrategyProfile({ trades: 50, profitFactor: 0.9, avgPnl: -3, winRate: 0.45, paused: false });
    assert.equal(result.approved, false);
    assert.ok(result.reasons.some((r) => r.includes('EV') || r.includes('negative') || r.includes('Expectancy') || r.includes('avgPnl') || r.includes('zero')));
  });

  test('rejects paused strategy immediately', () => {
    const result = validateStrategyProfile({ trades: 100, profitFactor: 2.0, avgPnl: 10, winRate: 0.7, paused: true });
    assert.equal(result.approved, false);
    assert.ok(result.reasons.some((r) => r.includes('paused') || r.includes('pause')));
  });

  test('rejects when profitFactor is null', () => {
    const result = validateStrategyProfile({ trades: 50, profitFactor: null, avgPnl: 5, winRate: 0.6, paused: false });
    assert.equal(result.approved, false);
  });

  test('rejects when trades is 0', () => {
    const result = validateStrategyProfile({ trades: 0, profitFactor: 2.0, avgPnl: 10, winRate: 0.8, paused: false });
    assert.equal(result.approved, false);
  });
});

describe('validateStrategyProfile — approves valid strategies', () => {
  test('approves strategy meeting all criteria', () => {
    const result = validateStrategyProfile({
      trades:       45,
      profitFactor: 1.6,
      avgPnl:       8,
      winRate:      0.65,
      paused:       false,
    });
    assert.equal(result.approved, true);
    assert.equal(result.reasons.length, 0);
  });

  test('approves strategy exactly at minimums (boundary)', () => {
    const result = validateStrategyProfile({
      trades:       30,
      profitFactor: 1.3,
      avgPnl:       0.01, // just above 0
      winRate:      0.5,
      paused:       false,
    });
    assert.equal(result.approved, true);
  });
});

describe('validateStrategyProfile — check structure', () => {
  test('result always has approved, checks, reasons', () => {
    const result = validateStrategyProfile({ trades: 5, profitFactor: 0.5, avgPnl: -1, winRate: 0.3, paused: false });
    assert.ok('approved' in result);
    assert.ok(Array.isArray(result.checks));
    assert.ok(Array.isArray(result.reasons));
  });

  test('each check has pass, code, detail', () => {
    const result = validateStrategyProfile({ trades: 50, profitFactor: 1.5, avgPnl: 5, winRate: 0.6, paused: false });
    for (const c of result.checks) {
      assert.ok('pass' in c, 'check missing pass');
      assert.ok('code' in c, 'check missing code');
      assert.ok('detail' in c, 'check missing detail');
    }
  });

  test('no mix of crypto and prediction market metrics', () => {
    // Validate that profile only uses crypto fields (no pm-specific ones)
    const result = validateStrategyProfile({ trades: 50, profitFactor: 1.5, avgPnl: 5, winRate: 0.6, paused: false });
    const codes = result.checks.map((c) => c.code);
    assert.ok(!codes.some((c) => c.includes('PREDICTION') || c.includes('MARKET')));
  });
});

describe('validateStrategyProfile — edge cases', () => {
  test('Infinity profitFactor (no losses) is REJECTED — not edge evidence', () => {
    const result = validateStrategyProfile({ trades: 35, profitFactor: Infinity, avgPnl: 12, winRate: 1.0, paused: false });
    assert.equal(result.approved, false);
    assert.ok(result.checks.some((c) => c.code === 'PROFIT_FACTOR_NO_LOSSES' && c.pass === false));
  });
});

