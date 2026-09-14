import test from 'node:test';
import assert from 'node:assert/strict';

import { createSolanaEvent, deduplicateSolanaEvents } from '../genesis/solanaEventModel.mjs';
import {
  SOLANA_RISK_POLICY,
  SolanaExecutionAdapter,
  evaluateSolanaRisk,
  measurePaperCapture,
} from '../genesis/solanaExecutionEngine.mjs';
import { buildSolanaLearningSnapshot } from '../genesis/solanaLearning.mjs';

const opportunity = {
  observedAt: '2026-09-14T12:00:00.000Z', inputUsdc: 25, slotDrift: 1,
  economics: { netPnlUsd: 0.08, netEdgeBps: 32, slippageReserveBps: 20, priorityFeeUsd: 0.001, jitoTipUsd: 0.002 },
};
const simulation = { attempted: true, success: true, balancesVerified: true, minOutVerified: true };

test('normalized Solana events are deterministic, append-only shaped and deduplicated', () => {
  const input = { runId: 'run-1', sequence: 1, timestamp: '2026-09-14T12:00:00.000Z', type: 'OPPORTUNITY_DETECTED', route: 'Jupiter → Orca', mode: 'SHADOW', inputAmountUsd: 25, expectedNetPnlUsd: 0.08 };
  const first = createSolanaEvent(input); const duplicate = createSolanaEvent(input);
  assert.equal(first.eventId, duplicate.eventId);
  assert.equal(first.chain, 'SOLANA'); assert.equal(first.executionAuthority, false); assert.equal(first.liveLocked, true);
  assert.deepEqual(deduplicateSolanaEvents([first, duplicate]), [first]);
  assert.equal(Object.isFrozen(first), true);
});

test('risk gate authorizes only fresh positive post-cost economics with verified simulation', () => {
  const result = evaluateSolanaRisk({ opportunity, simulation, runtime: { nowMs: Date.parse(opportunity.observedAt), quoteAt: opportunity.observedAt }, policy: SOLANA_RISK_POLICY });
  assert.equal(result.allowed, true); assert.deepEqual(result.reasons, []);
  const stale = evaluateSolanaRisk({ opportunity, simulation, runtime: { nowMs: Date.parse(opportunity.observedAt) + SOLANA_RISK_POLICY.maxQuoteAgeMs + 1, quoteAt: opportunity.observedAt }, policy: SOLANA_RISK_POLICY });
  assert.equal(stale.allowed, false); assert.ok(stale.reasons.includes('quote_stale'));
});

test('every mandatory kill switch fails closed with a specific reason', () => {
  const cases = [
    [{ emergencyStop: true }, 'emergency_stop'],
    [{ opportunity: { ...opportunity, inputUsdc: SOLANA_RISK_POLICY.maxTradeUsd + 1 } }, 'max_trade_usd'],
    [{ opportunity: { ...opportunity, economics: { ...opportunity.economics, netEdgeBps: SOLANA_RISK_POLICY.minNetEdgeBps - 1 } } }, 'min_net_edge_bps'],
    [{ opportunity: { ...opportunity, economics: { ...opportunity.economics, slippageReserveBps: SOLANA_RISK_POLICY.maxSlippageBps + 1 } } }, 'max_slippage_bps'],
    [{ opportunity: { ...opportunity, economics: { ...opportunity.economics, priorityFeeUsd: SOLANA_RISK_POLICY.maxPriorityFeeUsd + 1 } } }, 'max_priority_fee_usd'],
    [{ opportunity: { ...opportunity, economics: { ...opportunity.economics, jitoTipUsd: SOLANA_RISK_POLICY.maxJitoTipUsd + 1 } } }, 'max_jito_tip_usd'],
    [{ opportunity: { ...opportunity, slotDrift: SOLANA_RISK_POLICY.maxSlotDrift + 1 } }, 'max_slot_drift'],
    [{ dailyLossUsd: SOLANA_RISK_POLICY.maxDailyLossUsd }, 'max_daily_loss_usd'],
    [{ consecutiveFailures: SOLANA_RISK_POLICY.maxConsecutiveFailures }, 'max_consecutive_failures'],
    [{ dailyExecutions: SOLANA_RISK_POLICY.dailyExecutionLimit }, 'daily_execution_limit'],
  ];
  for (const [input, reason] of cases) {
    const selectedOpportunity = input.opportunity ?? opportunity;
    const { opportunity: _ignored, ...runtime } = input;
    const result = evaluateSolanaRisk({ opportunity: selectedOpportunity, simulation, runtime: { nowMs: Date.parse(opportunity.observedAt), quoteAt: opportunity.observedAt, ...runtime }, policy: SOLANA_RISK_POLICY });
    assert.equal(result.allowed, false); assert.ok(result.reasons.includes(reason));
  }
});

test('execution modes never allow LIVE and PAPER records expected versus captured', async () => {
  const shadow = new SolanaExecutionAdapter({ mode: 'SHADOW' });
  assert.equal((await shadow.decide({ opportunity, simulation, runtime: { nowMs: Date.parse(opportunity.observedAt), quoteAt: opportunity.observedAt } })).decision, 'SHADOW_ACCEPTED');
  const live = new SolanaExecutionAdapter({ mode: 'LIVE' });
  assert.equal((await live.decide({ opportunity, simulation, runtime: { nowMs: Date.parse(opportunity.observedAt), quoteAt: opportunity.observedAt } })).reason, 'live_locked');
  assert.equal(live.liveReadiness().ready, false); assert.ok(live.liveReadiness().missingCapabilities.includes('confirmation'));
  const paper = new SolanaExecutionAdapter({ mode: 'PAPER', paperCapture: async ({ opportunity: value }) => measurePaperCapture({ opportunity: value, capturedOutputUsd: 25.06, actualFeesUsd: 0.01 }) });
  const result = await paper.decide({ opportunity, simulation, runtime: { nowMs: Date.parse(opportunity.observedAt), quoteAt: opportunity.observedAt } });
  assert.equal(result.decision, 'PAPER_EXECUTED'); assert.equal(result.capture.expectedNetPnlUsd, 0.08); assert.ok(result.capture.capturedNetPnlUsd > 0);
});

test('learning optimizes measured captured PnL and penalizes poor capture cohorts', () => {
  const events = Array.from({ length: 5 }, (_, index) => createSolanaEvent({ runId: `run-${index}`, sequence: 1, timestamp: `2026-09-14T12:0${index}:00.000Z`, type: 'CAPTURE_MEASURED', route: 'Jupiter → Orca', venues: ['Jupiter', 'Orca'], tokens: ['USDC', 'SOL', 'USDC'], inputAmountUsd: 25, latencyMs: 80, priorityFeeUsd: 0.01, actualSlippageBps: 7, marketRegime: 'range', expectedNetPnlUsd: 0.1, capturedNetPnlUsd: -0.01, captureRatio: -0.1 }));
  const [row] = buildSolanaLearningSnapshot(events);
  assert.equal(row.samples, 5); assert.ok(row.netExpectancyUsd < 0); assert.equal(row.penalty, true);
  assert.equal(row.dimensions.marketRegime, 'range'); assert.equal(row.dimensions.route, 'Jupiter → Orca');
});
