import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildPortfolioRiskSnapshot,
  concurrencyDiagnostics,
  covarianceDiagnostics,
  openShockScenarios,
  runPortfolioRiskResearch,
  simulatePortfolio,
} from '../research/runPortfolioRiskResearch.mjs';

const iso = minute => new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString();
function trade(candidateId, index, openedMinute, closedMinute, baseBps, stressBps, direction = 1) {
  return {
    id: `${candidateId}:${index}`,
    candidateId,
    symbol: candidateId.startsWith('a') ? 'BTCUSDT' : 'ETHUSDT',
    family: 'family_x',
    openedAt: iso(openedMinute),
    closedAt: iso(closedMinute),
    openedAtMs: Date.parse(iso(openedMinute)),
    closedAtMs: Date.parse(iso(closedMinute)),
    direction,
    netBaseBps: baseBps,
    netStressBps: stressBps,
  };
}
function candidate(id, trades = [], extra = {}) {
  return {
    id,
    symbol: id.startsWith('a') ? 'BTCUSDT' : 'ETHUSDT',
    family: 'family_x',
    laneType: 'POSITIONING',
    enrollmentBaselineCapturedAt: iso(0),
    lastProcessedCapturedAt: iso(240),
    pendingSignal: null,
    closedTrades: trades,
    invalidClosedTrades: 0,
    ...extra,
  };
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

test('portfolio return is capital-weighted and is not cumulative trade return', () => {
  const a = candidate('a', [trade('a', 0, 1, 30, 100, 94)]);
  const b = candidate('b', [trade('b', 0, 1, 30, 100, 94)]);
  const result = simulatePortfolio([a, b]);
  assert.equal(result.cumulativeTradeReturnPct, 2);
  assert.ok(result.portfolioReturnPct > 1 && result.portfolioReturnPct < 1.01);
  assert.equal(result.weightPerCandidatePct, 50);
});

test('concurrency exposes gross, symbol and family concentration without changing gates', () => {
  const a = candidate('a', [trade('a', 0, 10, 100, 10, 4)]);
  const b = candidate('b', [trade('b', 0, 20, 90, 10, 4)]);
  const result = concurrencyDiagnostics([a, b]);
  assert.equal(result.peakConcurrentTrades, 2);
  assert.equal(result.peakConcurrentCandidates, 2);
  assert.equal(result.peakGrossExposurePct, 100);
  assert.equal(result.peakSymbolExposurePct, 50);
  assert.equal(result.peakFamilyExposurePct, 100);
});

test('covariance uses an aligned common post-enrollment window and preserves zero-return buckets', () => {
  const a = candidate('a', [
    trade('a', 0, 10, 30, 10, 4), trade('a', 1, 70, 90, -10, -16), trade('a', 2, 130, 150, 20, 14), trade('a', 3, 190, 210, -20, -26),
  ]);
  const b = candidate('b', [
    trade('b', 0, 10, 30, 20, 14), trade('b', 1, 70, 90, -20, -26), trade('b', 2, 130, 150, 40, 34), trade('b', 3, 190, 210, -40, -46),
  ]);
  const result = covarianceDiagnostics([a, b], { bucketMs: 60 * 60 * 1000 });
  const pair = result.pairs.find(item => item.a === 'a' && item.b === 'b');
  assert.equal(result.status, 'ALIGNED');
  assert.equal(result.bucketCount, 4);
  assert.ok(Math.abs(pair.correlation - 1) < 1e-12);
  assert.ok(result.portfolioBucketStdBps > 0);
});

test('open signal shock scenarios are stress-only and use stressed exit cost', () => {
  const a = candidate('a', [], { pendingSignal: { openedAt: iso(200), direction: 1 } });
  const b = candidate('b', [], { pendingSignal: { openedAt: iso(200), direction: -1 } });
  const result = openShockScenarios([a, b]);
  assert.equal(result.status, 'SCENARIOS_AVAILABLE');
  assert.equal(result.openSignals, 2);
  assert.equal(result.scenarios.length, 2);
  assert.ok(result.scenarios.every(item => item.assumedExitCostBps === 18));
  assert.ok(result.scenarios.every(item => item.portfolioPnlPct < 0));
});

test('snapshot admits only forward-gate-pass candidates with zero authority', () => {
  const id = 'POSITIONING:BTCUSDT:cohort:family_x';
  const rejectedId = 'POSITIONING:ETHUSDT:cohort:family_y';
  const forward = {
    version: 'research_forward_shadow_v1',
    mode: 'FORWARD_PAPER_RESEARCH', paperOnly: true, liveOrders: false, executionAuthority: false, capitalEligible: false,
    completedAt: iso(240),
    candidates: [
      { id, nextStageEligible: true, liveEligible: false, executionAuthority: false, capitalEligible: false },
      { id: rejectedId, nextStageEligible: false, liveEligible: false, executionAuthority: false, capitalEligible: false },
    ],
  };
  const ledger = {
    version: 'research_forward_shadow_ledger_v1',
    candidates: {
      [id]: {
        id, symbol: 'BTCUSDT', family: 'family_x', laneType: 'POSITIONING', enrollmentBaselineCapturedAt: iso(0), lastProcessedCapturedAt: iso(240),
        pendingSignal: null, paperOnly: true, liveEligible: false, executionAuthority: false, capitalEligible: false,
        closedTrades: [
          { openedAt: iso(10), closedAt: iso(30), direction: 1, netBaseBps: 20, netStressBps: 14 },
        ],
      },
      [rejectedId]: {
        id: rejectedId, symbol: 'ETHUSDT', family: 'family_y', laneType: 'POSITIONING', enrollmentBaselineCapturedAt: iso(0), lastProcessedCapturedAt: iso(240),
        pendingSignal: null, paperOnly: true, liveEligible: false, executionAuthority: false, capitalEligible: false,
        closedTrades: [{ openedAt: iso(10), closedAt: iso(30), direction: 1, netBaseBps: 999, netStressBps: 999 }],
      },
    },
  };
  const snapshot = buildPortfolioRiskSnapshot(forward, ledger);
  assert.equal(snapshot.source.admittedCandidates, 1);
  assert.equal(snapshot.universe.length, 1);
  assert.equal(snapshot.universe[0].id, id);
  assert.equal(snapshot.mode, 'PORTFOLIO_RISK_RESEARCH');
  assert.equal(snapshot.paperOnly, true);
  assert.equal(snapshot.liveOrders, false);
  assert.equal(snapshot.executionAuthority, false);
  assert.equal(snapshot.capitalEligible, false);
  assert.equal(snapshot.boundaries.changesRiskGates, false);
  assert.equal(snapshot.regimeSizing.status, 'UNAVAILABLE');
});

test('unsafe forward capital boundary is rejected', () => {
  const forward = { mode: 'FORWARD_PAPER_RESEARCH', paperOnly: true, liveOrders: true, executionAuthority: false, capitalEligible: false };
  const ledger = { version: 'research_forward_shadow_ledger_v1', candidates: {} };
  assert.throws(() => buildPortfolioRiskSnapshot(forward, ledger), /capital_boundary_failed/);
});

test('runner writes durable latest and history evidence only', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'genesis-portfolio-risk-'));
  const id = 'POSITIONING:BTCUSDT:cohort:family_x';
  writeJson(path.join(root, 'quant-evidence/research-forward-shadow-latest.json'), {
    version: 'research_forward_shadow_v1', mode: 'FORWARD_PAPER_RESEARCH', paperOnly: true, liveOrders: false, executionAuthority: false, capitalEligible: false,
    completedAt: iso(240), candidates: [{ id, nextStageEligible: true, liveEligible: false, executionAuthority: false, capitalEligible: false }],
  });
  writeJson(path.join(root, 'quant-evidence/research-forward-shadow-ledger.json'), {
    version: 'research_forward_shadow_ledger_v1', candidates: {
      [id]: {
        id, symbol: 'BTCUSDT', family: 'family_x', laneType: 'POSITIONING', enrollmentBaselineCapturedAt: iso(0), lastProcessedCapturedAt: iso(240),
        pendingSignal: null, paperOnly: true, liveEligible: false, executionAuthority: false, capitalEligible: false,
        closedTrades: [{ openedAt: iso(10), closedAt: iso(30), direction: 1, netBaseBps: 20, netStressBps: 14 }],
      },
    },
  });
  const snapshot = runPortfolioRiskResearch({ root });
  assert.equal(snapshot.ok, true);
  assert.ok(fs.existsSync(path.join(root, 'quant-evidence/portfolio-risk-research-latest.json')));
  assert.ok(fs.readFileSync(path.join(root, 'quant-evidence/portfolio-risk-research-history.jsonl'), 'utf8').trim().length > 0);
  assert.equal(snapshot.boundaries.realOrdersPlaced, false);
  assert.equal(snapshot.boundaries.writesExecutionState, false);
});
