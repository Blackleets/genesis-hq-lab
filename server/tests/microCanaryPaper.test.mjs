import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MICRO_CANARY_POLICY,
  validateCanaryPolicy,
  simulateFromSignals,
  summarizeResearchGates,
  buildEvidence,
} from '../canary/microCanaryPaper.mjs';

const k = (i, open = 100, high = 100.2, low = 99.8, close = 100) => [i * 1_000, open, high, low, close, 0];

test('policy hard-caps capital at $10 and max loss at $0.25', () => {
  assert.equal(validateCanaryPolicy(), true);
  assert.throws(() => validateCanaryPolicy({ ...MICRO_CANARY_POLICY, startingCapitalUsd: 10.01 }), /<= \$10/);
  assert.throws(() => validateCanaryPolicy({ ...MICRO_CANARY_POLICY, maxTotalLossUsd: 0.26 }), /<= \$0.25/);
  assert.throws(() => validateCanaryPolicy({ ...MICRO_CANARY_POLICY, maxOpenPositions: 2 }), /one open position/);
  assert.throws(() => validateCanaryPolicy({ ...MICRO_CANARY_POLICY, maxLeverage: 2 }), /remain 1x/);
});

test('one position uses no more than $10 notional and exits at target', () => {
  const klines = [k(0), k(1, 100, 100.2, 99.8, 100), k(2, 100, 101.2, 99.9, 101.1)];
  const signals = ['LONG', null, null];
  const result = simulateFromSignals(klines, signals, { costBps: 12 });
  assert.equal(result.trades, 1);
  assert.equal(result.tradesDetail[0].reason, 'TARGET');
  assert.ok(result.maxObservedNotionalUsd <= 10);
  assert.equal(result.maxObservedOpenPositions, 1);
  assert.ok(result.netPnlUsd > 0);
});

test('intrabar stop/target ambiguity is resolved stop-first conservatively', () => {
  const klines = [k(0), k(1, 100, 100.2, 99.8, 100), k(2, 100, 101.2, 99.4, 100)];
  const signals = ['LONG', null, null];
  const result = simulateFromSignals(klines, signals, { costBps: 12 });
  assert.equal(result.trades, 1);
  assert.equal(result.tradesDetail[0].reason, 'STOP_FIRST_INTRABAR_AMBIGUITY');
  assert.ok(result.netPnlUsd < 0);
});

test('stress costs cannot improve the same one-trade path', () => {
  const klines = [k(0), k(1, 100, 100.2, 99.8, 100), k(2, 100, 101.2, 99.9, 101.1)];
  const signals = ['LONG', null, null];
  const base = simulateFromSignals(klines, signals, { costBps: 12 });
  const stress = simulateFromSignals(klines, signals, { costBps: 18 });
  assert.ok(stress.netPnlUsd < base.netPnlUsd);
});

test('loss-bound sizing never breaches the $9.75 equity floor', () => {
  const klines = [];
  const signals = [];
  for (let i = 0; i < 24; i++) {
    const isStopCandle = i % 2 === 0 && i > 0;
    klines.push(isStopCandle ? k(i, 100, 100.1, 99.4, 99.6) : k(i));
    signals.push(i % 2 === 0 ? 'LONG' : null);
  }
  const result = simulateFromSignals(klines, signals, { costBps: 18 });
  assert.ok(result.finalEquityUsd >= 9.75 - 1e-8);
  assert.ok(result.maxObservedNotionalUsd <= 10);
  assert.ok(result.maxDrawdownUsd <= 0.25 + 1e-8);
});

test('research gates require safe forward candidate and ready portfolio evidence', () => {
  const root = mkdtempSync(join(tmpdir(), 'genesis-canary-'));
  const q = join(root, 'quant-evidence');
  mkdirSync(q, { recursive: true });
  writeFileSync(join(q, 'research-forward-shadow-latest.json'), JSON.stringify({
    status: 'FORWARD_ACTIVE',
    candidates: [
      { nextStageEligible: true, executionAuthority: false, capitalEligible: false, liveEligible: false },
      { nextStageEligible: true, executionAuthority: true, capitalEligible: false, liveEligible: false },
    ],
  }));
  writeFileSync(join(q, 'portfolio-risk-research-latest.json'), JSON.stringify({
    status: 'PORTFOLIO_RESEARCH_READY', paperOnly: true, liveOrders: false,
    executionAuthority: false, capitalEligible: false,
  }));
  const gates = summarizeResearchGates(root);
  assert.equal(gates.forwardEligible, 1);
  assert.equal(gates.portfolioReady, true);
});

test('paper diagnostic never grants execution or capital eligibility', () => {
  const baseline = { trades: 3, netPnlUsd: 0.1 };
  const stress = { trades: 3, netPnlUsd: 0.05 };
  const evidence = buildEvidence({
    baseline, stress,
    gates: { forwardEligible: 1, portfolioReady: true, forwardStatus: 'FORWARD_ACTIVE', portfolioStatus: 'PORTFOLIO_RESEARCH_READY' },
    generatedAt: '2026-09-10T00:00:00.000Z',
  });
  assert.equal(evidence.diagnosticVerdict, 'PAPER_WIN');
  assert.equal(evidence.canaryReadiness, 'RESEARCH_GATES_PRESENT_HUMAN_REVIEW_REQUIRED');
  assert.equal(evidence.paperOnly, true);
  assert.equal(evidence.liveOrders, false);
  assert.equal(evidence.executionAuthority, false);
  assert.equal(evidence.capitalEligible, false);
  assert.equal(evidence.boundaries.orderEndpointAvailable, false);
  assert.equal(evidence.boundaries.realOrdersPlaced, false);
});
