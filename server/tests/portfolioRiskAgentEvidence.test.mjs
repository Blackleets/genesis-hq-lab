import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compactPortfolioRisk,
  compactResearchLifecycleForward,
  portfolioRiskBlocker,
} from '../genesis/portfolioRiskAgentEvidence.mjs';

function lifecycle(nextStageEligible = 0) {
  return {
    version: 'research_forward_shadow_v1',
    mode: 'FORWARD_PAPER_RESEARCH',
    paperOnly: true,
    liveOrders: false,
    executionAuthority: false,
    capitalEligible: false,
    completedAt: '2026-01-01T00:00:00.000Z',
    registeredEligible: nextStageEligible,
    enrolled: nextStageEligible,
    openSignals: 0,
    nextStageEligible,
    candidates: [],
    boundaries: { realOrdersPlaced: false, liveTradingEnabled: false, changesRiskGates: false },
  };
}

function portfolio(status = 'PORTFOLIO_RESEARCH_READY') {
  return {
    version: 'portfolio_risk_research_v1',
    mode: 'PORTFOLIO_RISK_RESEARCH',
    paperOnly: true,
    liveOrders: false,
    executionAuthority: false,
    capitalEligible: false,
    status,
    completedAt: '2026-01-01T00:00:00.000Z',
    source: { admittedCandidates: 1 },
    methodology: {
      cumulativeTradeReturnIsNotPortfolioReturn: true,
      changesProductionRiskGates: false,
      optimizationOrRanking: false,
    },
    realized: {
      base12Bps: { tradeCount: 20, portfolioReturnPct: 2, maxDrawdownPct: 1 },
      stress18Bps: { tradeCount: 20, portfolioReturnPct: 0.5, maxDrawdownPct: 1.5 },
    },
    concurrency: { peakConcurrentCandidates: 1, peakGrossExposurePct: 100, peakSymbolExposurePct: 100, peakFamilyExposurePct: 100 },
    covariance: { bucketCount: 4, portfolioBucketStdBps: 10, status: 'ALIGNED' },
    openScenarios: { status: 'NO_OPEN_FORWARD_SIGNALS', openSignals: 0, scenarios: [] },
    regimeSizing: { status: 'UNAVAILABLE', usedForSizing: false },
    boundaries: {
      realOrdersPlaced: false,
      liveTradingEnabled: false,
      changesRiskGates: false,
      writesExecutionState: false,
      grantsCapitalEligibility: false,
    },
  };
}

test('compacts only zero-authority Issue-72 forward evidence', () => {
  const result = compactResearchLifecycleForward(lifecycle(1));
  assert.equal(result.nextStageEligible, 1);
  assert.equal(result.mode, 'FORWARD_PAPER_RESEARCH');
});

test('rejects unsafe Issue-72 forward evidence', () => {
  assert.throws(() => compactResearchLifecycleForward({ ...lifecycle(1), liveOrders: true }), /research_forward_boundary_failed/);
});

test('compacts portfolio evidence while preserving no-authority semantics', () => {
  const result = compactPortfolioRisk(portfolio());
  assert.equal(result.status, 'PORTFOLIO_RESEARCH_READY');
  assert.equal(result.base.trades, 20);
  assert.equal(result.executionAuthority, false);
  assert.equal(result.capitalEligible, false);
});

test('rejects portfolio evidence that changes production risk gates or grants authority', () => {
  assert.throws(() => compactPortfolioRisk({ ...portfolio(), methodology: { ...portfolio().methodology, changesProductionRiskGates: true } }), /portfolio_boundary_failed/);
  assert.throws(() => compactPortfolioRisk({ ...portfolio(), executionAuthority: true }), /portfolio_boundary_failed/);
});

test('forward next-stage eligibility is blocked until portfolio research is ready', () => {
  const forward = compactResearchLifecycleForward(lifecycle(1));
  assert.equal(portfolioRiskBlocker(forward, null), 'PORTFOLIO_RISK_UNVERIFIED');
  assert.equal(portfolioRiskBlocker(forward, compactPortfolioRisk(portfolio('PORTFOLIO_EVIDENCE_BUILDING'))), 'PORTFOLIO_RISK_NOT_READY');
  assert.equal(portfolioRiskBlocker(forward, compactPortfolioRisk(portfolio('PORTFOLIO_RESEARCH_READY'))), null);
});

test('portfolio state does not fabricate a blocker before a forward candidate passes', () => {
  const forward = compactResearchLifecycleForward(lifecycle(0));
  assert.equal(portfolioRiskBlocker(forward, null), null);
});
