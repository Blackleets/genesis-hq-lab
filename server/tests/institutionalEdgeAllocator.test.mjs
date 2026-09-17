import test from 'node:test';
import assert from 'node:assert/strict';
import { allocatePaperCapital, evaluateSleeve } from '../../src/core/institutionalEdgeAllocator.mjs';

test('allocator keeps 100% cash when no sleeve proves edge', () => {
  const result = allocatePaperCapital([{ sleeveKey: 'ARB', samples: 100, expectancyBps: -1, profitFactor: 0.8, tStat: -0.2, maxDrawdownPct: 5, evidenceQuality: 1 }]);
  assert.equal(result.qualifiedSleeves, 0);
  assert.equal(result.cashReserve.paperWeight, 1);
  assert.equal(result.allocations[0].paperCapitalUsd, 0);
  assert.equal(result.liveLocked, true);
  assert.equal(result.executionAuthority, false);
});

test('allocator distributes paper capital only across qualified sleeves', () => {
  const sleeves = [
    { sleeveKey: 'MM', samples: 50, expectancyBps: 2, profitFactor: 1.3, tStat: 1.1, maxDrawdownPct: 4, evidenceQuality: 0.9 },
    { sleeveKey: 'STAT', samples: 80, expectancyBps: 4, profitFactor: 1.5, tStat: 1.5, maxDrawdownPct: 6, evidenceQuality: 0.85 },
    { sleeveKey: 'BAD', samples: 100, expectancyBps: -3, profitFactor: 0.7, tStat: -1, maxDrawdownPct: 20, evidenceQuality: 1 },
  ];
  const result = allocatePaperCapital(sleeves, { totalPaperCapitalUsd: 10_000 });
  assert.equal(result.qualifiedSleeves, 2);
  assert.equal(result.allocations.find((x) => x.sleeveKey === 'BAD').paperWeight, 0);
  const invested = result.allocations.reduce((sum, x) => sum + x.paperCapitalUsd, 0);
  assert.ok(invested >= 9999 && invested <= 10001);
  assert.equal(result.invariants.unlocksLive, false);
});

test('a sleeve with weak evidence cannot qualify even with positive expectancy', () => {
  const result = evaluateSleeve({ sleeveKey: 'MM', samples: 100, expectancyBps: 10, profitFactor: 2, tStat: 2, maxDrawdownPct: 2, evidenceQuality: 0.2 });
  assert.equal(result.qualified, false);
  assert.equal(result.checks.evidence, false);
});

test('explicit paper ineligibility is fail-closed', () => {
  const result = evaluateSleeve({ sleeveKey: 'MM', samples: 100, expectancyBps: 10, profitFactor: 2, tStat: 2, maxDrawdownPct: 2, evidenceQuality: 1, paperCapitalEligible: false });
  assert.equal(result.qualified, false);
  assert.equal(result.checks.paperEligibility, false);
});
