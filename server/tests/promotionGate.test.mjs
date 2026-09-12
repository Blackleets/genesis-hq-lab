import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROMOTION_CRITERIA,
  evaluatePromotionEligibility,
} from '../quant/alpha/promotionGate.mjs';

describe('PROMOTION_CRITERIA vs 6-gate floor', () => {
  test('minTrades is 50 not 30', () => {
    assert.equal(PROMOTION_CRITERIA.minTrades, 50);
  });
});

describe('evaluatePromotionEligibility', () => {
  test('N=30 strong PF is NOT promoted', () => {
    const r = evaluatePromotionEligibility({
      trades: 30,
      profitFactor: 2,
      avgPnl: 5,
      winRate: 0.6,
      maxDrawdown: 0.1,
      tstat: 3,
    });
    assert.equal(r.eligible, false);
    assert.ok(r.checks.some((c) => c.code === 'SAMPLE' && !c.pass));
  });

  test('N=50 missing DD fails closed', () => {
    const r = evaluatePromotionEligibility({
      trades: 50,
      profitFactor: 1.5,
      avgPnl: 2,
      winRate: 0.5,
      tstat: 2.5,
    });
    assert.equal(r.eligible, false);
    assert.ok(r.checks.some((c) => c.code === 'DRAWDOWN' && !c.pass));
  });

  test('full institutional profile is eligible', () => {
    const r = evaluatePromotionEligibility({
      trades: 50,
      profitFactor: 1.5,
      avgPnl: 2,
      winRate: 0.5,
      maxDrawdown: 0.1,
      tstat: 2.5,
    });
    assert.equal(r.eligible, true);
    assert.equal(r.code, 'PROMOTED_ELIGIBLE');
  });

  test('infinite PF fails', () => {
    const r = evaluatePromotionEligibility({
      trades: 50,
      profitFactor: Infinity,
      avgPnl: 2,
      winRate: 0.5,
      maxDrawdown: 0.1,
      tstat: 2.5,
    });
    assert.equal(r.eligible, false);
  });
});
