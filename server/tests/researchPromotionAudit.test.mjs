import test from 'node:test';
import assert from 'node:assert/strict';
import { auditGate, preAuditGate, selectLaneChampion, stressAdjustedExpectancy } from '../research/runResearchPromotionAudit.mjs';

function candidate(family, { trainEv = 20, validationEv = 16, trainTrades = 12, validationTrades = 6, trainPf = 1.4, validationPf = 1.3 } = {}) {
  return {
    family,
    status: 'RESEARCH_CANDIDATE',
    train: { trades: trainTrades, expectancyBps: trainEv, profitFactor: trainPf, tStat: 1 },
    validation: { trades: validationTrades, expectancyBps: validationEv, profitFactor: validationPf, tStat: 1 },
  };
}

test('18 bps stress is an exact fixed-cost expectancy shift from the 12 bps research model', () => {
  assert.equal(stressAdjustedExpectancy(20, 12, 18), 14);
  assert.equal(stressAdjustedExpectancy(5, 12, 18), -1);
  assert.equal(stressAdjustedExpectancy(null, 12, 18), null);
});

test('pre-audit gate refuses thin samples and candidates that lose expectancy at 18 bps', () => {
  assert.equal(preAuditGate(candidate('thin', { trainTrades: 7 })).reason, 'RESEARCH_SAMPLE_THIN');
  assert.equal(preAuditGate(candidate('fragile', { validationEv: 5 })).reason, 'FAILS_18BPS_EXPECTANCY_STRESS');
  assert.equal(preAuditGate(candidate('robust')).pass, true);
});

test('lane champion is selected before holdout using worst stressed train/validation expectancy', () => {
  const a = candidate('family_a', { trainEv: 40, validationEv: 13 }); // stressed floor 7
  const b = candidate('family_b', { trainEv: 22, validationEv: 20 }); // stressed floor 14
  const c = candidate('family_c', { trainEv: 60, validationEv: 5 });  // stress fail
  const selected = selectLaneChampion([a, b, c]);
  assert.equal(selected.candidate.family, 'family_b');
  assert.equal(selected.score, 14);
});

test('one-shot holdout gate requires base evidence and 18 bps stress to survive', () => {
  const base = { trades: 7, expectancyBps: 8, profitFactor: 1.4, tStat: 0.8, maxDrawdownPct: 1.2 };
  const stressed = { trades: 7, expectancyBps: 2, profitFactor: 1.08, tStat: 0.3, maxDrawdownPct: 1.6 };
  assert.equal(auditGate(base, stressed).pass, true);
  assert.equal(auditGate({ ...base, trades: 4 }, stressed).reason, 'HOLDOUT_SAMPLE_THIN');
  assert.equal(auditGate(base, { ...stressed, expectancyBps: -0.1 }).reason, 'HOLDOUT_18BPS_STRESS_FAIL');
});
