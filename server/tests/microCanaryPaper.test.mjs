import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MICRO_CANARY_POLICY,
  validateCanaryPolicy,
  assertSafeRunnerSnapshot,
  selectCurrentV8PaperTrades,
  simulateFromPaperTrades,
  summarizeResearchGates,
  buildEvidence,
} from '../canary/microCanaryPaper.mjs';

const trade = (overrides = {}) => ({
  id: 't1',
  pair: 'ETHUSDT',
  side: 'SHORT',
  status: 'closed',
  mode: 'paper',
  entryPrice: 100,
  exitPrice: 99,
  stopPrice: 103,
  targetPrice: 90,
  pnl: 4,
  capitalUsed: 150,
  leverage: 3,
  openedAt: '2026-09-11T00:00:00.000Z',
  closedAt: '2026-09-11T01:00:00.000Z',
  exitReason: 'timeout',
  strategyVersionId: 'futures_breakout_short_micro:v8',
  validationStatus: 'EXPERIMENT',
  runnerVersion: 'v8.1',
  ...overrides,
});

const snapshot = (trades = []) => ({
  ok: true,
  timestamp: '2026-09-11T01:05:00.000Z',
  agentRunner: {
    ok: true,
    paperOnly: true,
    liveOrders: false,
    runnerVersion: 'v8.1',
    validationEngineVersion: 'qve_v1.1',
    lastTickAt: '2026-09-11T01:04:00.000Z',
    recentTrades: trades,
  },
});

test('policy hard-caps capital at $10, loss at $0.25, and leverage at 1x', () => {
  assert.equal(validateCanaryPolicy(), true);
  assert.throws(() => validateCanaryPolicy({ ...MICRO_CANARY_POLICY, startingCapitalUsd: 10.01 }), /<= \$10/);
  assert.throws(() => validateCanaryPolicy({ ...MICRO_CANARY_POLICY, maxTotalLossUsd: 0.26 }), /<= \$0.25/);
  assert.throws(() => validateCanaryPolicy({ ...MICRO_CANARY_POLICY, maxOpenPositions: 2 }), /one open position/);
  assert.throws(() => validateCanaryPolicy({ ...MICRO_CANARY_POLICY, maxLeverage: 2 }), /remain 1x/);
});

test('runner snapshot must prove PAPER-only and no LIVE orders', () => {
  assert.equal(assertSafeRunnerSnapshot(snapshot()).paperOnly, true);
  assert.throws(() => assertSafeRunnerSnapshot({ ...snapshot(), agentRunner: { ...snapshot().agentRunner, paperOnly: false } }), /paper_boundary/);
  assert.throws(() => assertSafeRunnerSnapshot({ ...snapshot(), agentRunner: { ...snapshot().agentRunner, liveOrders: true } }), /live_orders_boundary/);
});

test('selector admits only closed current-v8 EXPERIMENT paper trades', () => {
  const selected = selectCurrentV8PaperTrades(snapshot([
    trade({ id: 'good' }),
    trade({ id: 'legacy', strategyVersionId: 'futures_breakout_short_micro:v7' }),
    trade({ id: 'other-profile', strategyVersionId: 'futures_breakout_short_alt:v8' }),
    trade({ id: 'open', status: 'open' }),
    trade({ id: 'not-paper', mode: 'live' }),
    trade({ id: 'quarantined', validationStatus: 'QUARANTINED' }),
  ]));
  assert.deepEqual(selected.map(row => row.id), ['good']);
});

test('profitable PAPER fill produces a positive $10 1x canary result', () => {
  const result = simulateFromPaperTrades([trade()], { costBps: 12 });
  assert.equal(result.trades, 1);
  assert.equal(result.wins, 1);
  assert.ok(result.netPnlUsd > 0);
  assert.ok(result.finalEquityUsd > 10);
  assert.ok(result.maxObservedNotionalUsd <= 10);
  assert.equal(result.maxObservedOpenPositions, 1);
  assert.equal(result.tradesDetail[0].canaryLeverage, 1);
});

test('losing PAPER fill is loss-bounded and cannot breach the $9.75 floor', () => {
  const result = simulateFromPaperTrades([
    trade({ exitPrice: 110, stopPrice: 103, pnl: -40 }),
  ], { costBps: 18 });
  assert.equal(result.trades, 1);
  assert.equal(result.losses, 1);
  assert.ok(result.finalEquityUsd >= 9.75 - 1e-8);
  assert.ok(result.maxDrawdownUsd <= 0.25 + 1e-8);
  assert.ok(result.maxObservedNotionalUsd <= 10);
});

test('overlapping source trades are ignored to preserve one-position semantics', () => {
  const result = simulateFromPaperTrades([
    trade({ id: 'a', openedAt: '2026-09-11T00:00:00.000Z', closedAt: '2026-09-11T02:00:00.000Z' }),
    trade({ id: 'b', openedAt: '2026-09-11T01:00:00.000Z', closedAt: '2026-09-11T03:00:00.000Z' }),
  ]);
  assert.equal(result.trades, 1);
  assert.equal(result.ignoredOverlaps, 1);
});

test('stress costs cannot improve the same verified paper path', () => {
  const trades = [trade()];
  const base = simulateFromPaperTrades(trades, { costBps: 12 });
  const stress = simulateFromPaperTrades(trades, { costBps: 18 });
  assert.ok(stress.netPnlUsd < base.netPnlUsd);
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

test('paper mirror evidence never grants execution or capital eligibility', () => {
  const baseline = { trades: 1, netPnlUsd: 0.05 };
  const stress = { trades: 1, netPnlUsd: 0.04 };
  const evidence = buildEvidence({
    baseline,
    stress,
    source: { kind: 'VERIFIED_SYSTEM_HEALTH_PAPER_TRADES', sourceClosedTrades: 1 },
    gates: { forwardEligible: 1, portfolioReady: true, forwardStatus: 'FORWARD_ACTIVE', portfolioStatus: 'PORTFOLIO_RESEARCH_READY' },
    generatedAt: '2026-09-11T00:00:00.000Z',
  });
  assert.equal(evidence.diagnosticVerdict, 'PAPER_WIN');
  assert.equal(evidence.strategy.purpose, 'ACTIVE_V8_PAPER_MIRROR_DIAGNOSTIC');
  assert.equal(evidence.canaryReadiness, 'RESEARCH_GATES_PRESENT_HUMAN_REVIEW_REQUIRED');
  assert.equal(evidence.paperOnly, true);
  assert.equal(evidence.liveOrders, false);
  assert.equal(evidence.executionAuthority, false);
  assert.equal(evidence.capitalEligible, false);
  assert.equal(evidence.boundaries.orderEndpointAvailable, false);
  assert.equal(evidence.boundaries.realOrdersPlaced, false);
});
