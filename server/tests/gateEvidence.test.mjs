import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateWalkForwardEvidence,
  evaluateProfitFactorEvidence,
} from '../quant/validation/gateEvidence.mjs';

describe('evaluateWalkForwardEvidence', () => {
  test('missing cache FAILS', () => {
    const r = evaluateWalkForwardEvidence(null);
    assert.equal(r.pass, false);
    assert.equal(r.code, 'WF_NOT_RUN');
  });

  test('stale cache FAILS', () => {
    const r = evaluateWalkForwardEvidence(
      { summary: { robustCombined: true, combinedJudgedWindows: 4, combinedPositiveWindows: 4 } },
      { stale: true },
    );
    assert.equal(r.pass, false);
    assert.equal(r.code, 'WF_STALE');
  });

  test('non-robust FAILS', () => {
    const r = evaluateWalkForwardEvidence({
      summary: { robustCombined: false, robustShort: false, combinedJudgedWindows: 4, combinedPositiveWindows: 1 },
    });
    assert.equal(r.pass, false);
    assert.equal(r.code, 'WF_NOT_ROBUST');
  });

  test('robust PASS', () => {
    const r = evaluateWalkForwardEvidence({
      summary: { robustCombined: true, combinedJudgedWindows: 4, combinedPositiveWindows: 4 },
      completedAt: '2026-09-05T00:00:00Z',
    });
    assert.equal(r.pass, true);
    assert.equal(r.code, 'WF_ROBUST');
  });
});

describe('evaluateProfitFactorEvidence', () => {
  test('Infinity FAILS', () => {
    const r = evaluateProfitFactorEvidence(Infinity);
    assert.equal(r.pass, false);
    assert.equal(r.code, 'PROFIT_FACTOR_NO_LOSSES');
  });

  test('low PF FAILS', () => {
    const r = evaluateProfitFactorEvidence(1.1);
    assert.equal(r.pass, false);
    assert.equal(r.code, 'PROFIT_FACTOR_LOW');
  });

  test('ok PF PASS', () => {
    const r = evaluateProfitFactorEvidence(1.5);
    assert.equal(r.pass, true);
    assert.equal(r.code, 'PROFIT_FACTOR_OK');
  });
});
