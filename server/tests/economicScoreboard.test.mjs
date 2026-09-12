import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEconomicScoreboard, evaluateForwardChampion } from '../../src/core/economicScoreboard.mjs';

function passingFamily(overrides = {}) {
  return {
    familyKey: 'opening_range_breakout:XRPUSDT:4h:LONDON',
    championId: 'champion-1',
    championEvidenceStatus: 'FORWARD_VALIDATED',
    forwardGate: 'PASS',
    championForward: {
      trades: 24,
      expectancyBps: 4.2,
      profitFactor: 1.34,
      tStat: 1.4,
      maxDrawdownPct: 8.5,
      ...overrides,
    },
  };
}

const safeForward = (families) => ({
  paperOnly: true,
  liveOrders: false,
  executionAuthority: false,
  capitalEligible: false,
  families,
});

test('forward edge requires all economic gates, not just positive pnl', () => {
  const evaluation = evaluateForwardChampion({
    trades: 30,
    expectancyBps: 3,
    profitFactor: 1.08,
    tStat: 1.5,
    maxDrawdownPct: 7,
  });
  assert.equal(evaluation.proven, false);
  assert.equal(evaluation.checks.profitFactor, false);
});

test('research candidates never count as proven edge without forward evidence', () => {
  const scoreboard = buildEconomicScoreboard({
    edgeFactory: { tested: 946, paperCandidates: 6, killed: 900, verdict: 'CANDIDATES_FOUND' },
    forward: safeForward([]),
  });
  assert.notEqual(scoreboard.edgeVerdict, 'EDGE_PROVEN_PAPER');
  assert.equal(scoreboard.capitalEligible, false);
  assert.equal(scoreboard.liveEligible, false);
});

test('passing forward champion can prove PAPER edge but never unlock live', () => {
  const scoreboard = buildEconomicScoreboard({ forward: safeForward([passingFamily()]) });
  assert.equal(scoreboard.edgeVerdict, 'EDGE_PROVEN_PAPER');
  assert.equal(scoreboard.bestForwardFamily.evaluation.proven, true);
  assert.equal(scoreboard.liveEligible, false);
  assert.equal(scoreboard.executionAuthority, false);
});

test('self funding claim is blocked without explicit monthly cost basis', () => {
  const scoreboard = buildEconomicScoreboard({
    forward: safeForward([passingFamily()]),
    reconciledCompanyPnlUsd: 500,
    reconciledCompanyPnlWindowDays: 30,
  });
  assert.equal(scoreboard.selfFundingVerdict, 'COST_BASIS_MISSING');
});

test('self funding claim is blocked without reconciled company pnl', () => {
  const scoreboard = buildEconomicScoreboard({
    forward: safeForward([passingFamily()]),
    monthlyOperatingCostUsd: 50,
  });
  assert.equal(scoreboard.selfFundingVerdict, 'PNL_RECONCILIATION_REQUIRED');
  assert.equal(scoreboard.invariants.sumsUnreconciledSleeves, false);
});

test('PAYS_FOR_ITSELF_PAPER requires edge, matching monthly window and 1.5x cost coverage', () => {
  const scoreboard = buildEconomicScoreboard({
    forward: safeForward([passingFamily()]),
    monthlyOperatingCostUsd: 50,
    reconciledCompanyPnlUsd: 90,
    reconciledCompanyPnlWindowDays: 30,
  });
  assert.equal(scoreboard.selfFundingVerdict, 'PAYS_FOR_ITSELF_PAPER');
  assert.equal(scoreboard.economics.coverageRatio, 1.8);
  assert.equal(scoreboard.capitalEligible, false);
});

test('weak forward economics stay NO_EDGE_PROVEN even with enough trades', () => {
  const scoreboard = buildEconomicScoreboard({
    forward: safeForward([passingFamily({ expectancyBps: -1.2, profitFactor: 0.88 })]),
    monthlyOperatingCostUsd: 50,
    reconciledCompanyPnlUsd: 500,
    reconciledCompanyPnlWindowDays: 30,
  });
  assert.equal(scoreboard.edgeVerdict, 'NO_EDGE_PROVEN');
  assert.equal(scoreboard.selfFundingVerdict, 'EDGE_REQUIRED');
});
