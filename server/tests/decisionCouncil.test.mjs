// decisionCouncil.test.mjs — Fase 8 verification of the Genesis Decision
// Council: approval of good signals, hard rejections (RR, EV, duplicates,
// blocked setups), the no-bypass execution gate, and dashboard reads.
//
// Context is injected (treasury/risk/setupStats/openPositions/...) so every
// council verdict here is deterministic and independent of live DB state.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTrade, getCouncilConfig } from '../crypto/decisionCouncil.mjs';
import {
  consumeApprovedDecision,
  getDecisionById,
  getLatestDecision,
  recordDecisionOutcome,
  attachTradeToDecision,
} from '../crypto/decisionMemory.mjs';
import { openCryptoPosition } from '../trading/paperExecutionEngine.mjs';

const healthyContext = () => ({
  treasury: { total: 10_000, available: 8_000, isPaused: false },
  risk: { band: 'HEALTHY', score: 10 },
  setupStats: [],
  openPositions: [],
  dailyPnlUsd: 0,
  lossStreak: 0,
  lastLossAt: null,
  lessons: [],
  // explicit nulls keep tests offline-deterministic (no live news/book fetch)
  sentiment: null,
  realSpreadPct: null,
});

const goodSwingSignal = (over = {}) => ({
  strategy: 'swing_v1',
  symbol: 'BTC',
  pair: 'BTCUSDT',
  side: 'LONG',
  entryPrice: 100_000,
  targetPct: 0.05,
  stopPct: 0.015,
  confidence: 0.80,
  capitalUsed: 300,
  instrumentType: 'spot',
  volume24h: 20_000_000_000,
  regime: 'BULL',
  signals: ['TF_ALIGNED_LONG', 'RSI_1H_BULL_ZONE'],
  agentId: 'council-test',
  tradeType: 'swing_v1',
  ...over,
});

test('council — good signal is approved with full structured output', async () => {
  const d = await evaluateTrade(goodSwingSignal(), healthyContext());
  assert.equal(d.final_decision, 'approved');
  assert.equal(d.risk_manager_verdict, 'approved');
  assert.equal(d.portfolio_manager_verdict, 'approved');
  assert.equal(d.side, 'long');
  assert.ok(d.decision_id.startsWith('council-'));
  assert.ok(d.risk_reward >= getCouncilConfig().minRiskReward, `RR ${d.risk_reward}`);
  assert.ok(d.expected_value > 0, `EV ${d.expected_value}`);
  // every report is present and grounded
  assert.ok(d.technical_report.includes('Risk/reward'));
  assert.ok(d.sentiment_report.includes('insufficient_data'), 'no news source → must abstain');
  assert.ok(d.bull_case.length > 0 && d.bear_case.length > 0);
  assert.ok(d.trader_summary.includes('Trader proposes LONG'));
  assert.equal(d.rejection_reason, '');
});

test('council — low risk/reward is rejected', async () => {
  const d = await evaluateTrade(
    goodSwingSignal({ targetPct: 0.01, stopPct: 0.01 }), healthyContext());
  assert.equal(d.final_decision, 'rejected');
  assert.match(d.rejection_reason, /risk_reward_below/);
});

test('council — costs that destroy the edge produce non-positive EV and rejection', async () => {
  // 0.4% TP / 0.2% SL spot scalp: round-trip fees+spread+slippage exceed the
  // gross edge at p=0.62 → the council must refuse to pay the toll.
  const d = await evaluateTrade(goodSwingSignal({
    strategy: 'scalp_v2', tradeType: 'scalp_v2',
    targetPct: 0.004, stopPct: 0.002, confidence: 0.62, capitalUsed: 200,
  }), healthyContext());
  assert.equal(d.final_decision, 'rejected');
  assert.ok(d.expected_value <= 0, `EV must be ≤ 0, got ${d.expected_value}`);
  assert.match(d.rejection_reason, /costs_destroy_edge|negative_expected_value/);
});

test('council — duplicate open position on same pair+strategy is rejected', async () => {
  const ctx = healthyContext();
  ctx.openPositions = [{ asset_pair: 'BTCUSDT', trade_type: 'swing_v1', capital_used: 300 }];
  const d = await evaluateTrade(goodSwingSignal(), ctx);
  assert.equal(d.final_decision, 'rejected');
  assert.match(d.rejection_reason, /duplicate_position/);
});

test('council — setup blocked by historical profit factor is rejected', async () => {
  const ctx = healthyContext();
  ctx.setupStats = [{
    key: 'LONG_BULL', side: 'LONG', regime: 'BULL',
    samples: 20, winRate: 0.30, profitFactor: 0.5, expectancy: -1.2, pnl: -24,
  }];
  const d = await evaluateTrade(goodSwingSignal(), ctx);
  assert.equal(d.final_decision, 'rejected');
  assert.match(d.rejection_reason, /setup_profit_factor_below_floor|setup_win_rate_below_floor|negative_expected_value/);
  // historical stats must surface in the decision, not be invented
  assert.equal(d.win_rate, 0.30);
});

test('council — daily max loss and loss streak hard-stop new trades', async () => {
  const lossDay = await evaluateTrade(goodSwingSignal(),
    { ...healthyContext(), dailyPnlUsd: -400 }); // > 3% of $10k
  assert.equal(lossDay.final_decision, 'rejected');
  assert.match(lossDay.rejection_reason, /daily_max_loss_reached/);

  const streak = await evaluateTrade(goodSwingSignal(),
    { ...healthyContext(), lossStreak: 6 });
  assert.equal(streak.final_decision, 'rejected');
  assert.match(streak.rejection_reason, /loss_streak_limit/);
});

test('council — portfolio manager rejects on drawdown pause even if risk approves', async () => {
  const ctx = healthyContext();
  ctx.treasury = { total: 10_000, available: 8_000, isPaused: true };
  const d = await evaluateTrade(goodSwingSignal(), ctx);
  assert.equal(d.risk_manager_verdict, 'approved');
  assert.equal(d.portfolio_manager_verdict, 'rejected');
  assert.equal(d.final_decision, 'rejected');
  assert.match(d.rejection_reason, /drawdown_pause/);
});

test('gate — approved decision is single-use and validates pair/side/type', async () => {
  const d = await evaluateTrade(goodSwingSignal({ pair: 'ETHUSDT', symbol: 'ETH', entryPrice: 3000 }), healthyContext());
  assert.equal(d.final_decision, 'approved');

  const wrongSide = consumeApprovedDecision(d.decision_id, { pair: 'ETHUSDT', side: 'SHORT', tradeType: 'swing_v1' });
  assert.equal(wrongSide.ok, false);
  assert.equal(wrongSide.reason, 'side_mismatch');

  const first = consumeApprovedDecision(d.decision_id, { pair: 'ETHUSDT', side: 'LONG', tradeType: 'swing_v1' });
  assert.equal(first.ok, true);
  const second = consumeApprovedDecision(d.decision_id, { pair: 'ETHUSDT', side: 'LONG', tradeType: 'swing_v1' });
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'decision_already_consumed');
});

test('gate — rejected decisions never authorize execution', async () => {
  const d = await evaluateTrade(goodSwingSignal({ targetPct: 0.01, stopPct: 0.01 }), healthyContext());
  assert.equal(d.final_decision, 'rejected');
  const gate = consumeApprovedDecision(d.decision_id, { pair: 'BTCUSDT', side: 'LONG', tradeType: 'swing_v1' });
  assert.equal(gate.ok, false);
  assert.equal(gate.reason, 'decision_not_approved');
});

test('gate — stale approved decisions expire (TTL)', async () => {
  const d = await evaluateTrade(goodSwingSignal(),
    { ...healthyContext(), nowMs: Date.now() - 10 * 60_000 });
  assert.equal(d.final_decision, 'approved');
  const gate = consumeApprovedDecision(d.decision_id, { pair: 'BTCUSDT', side: 'LONG', tradeType: 'swing_v1' });
  assert.equal(gate.ok, false);
  assert.equal(gate.reason, 'decision_expired');
});

test('gate — openCryptoPosition refuses any order without an approved decision', async () => {
  const result = await openCryptoPosition({
    asset: { symbol: 'BTC', pair: 'BTCUSDT', price: 100_000, volume24h: 2e10 },
    side: 'LONG', confidence: 0.9, capitalUsed: 100,
    reason: 'bypass attempt', agentId: 'council-test', tradeType: 'swing_v1',
    targetPct: 0.05, stopPct: 0.015,
  });
  assert.equal(result.executed, false);
  // Either the council gate or a safety mode refused — never an open trade.
  assert.match(result.reason, /council_gate:missing_decision_id|safe_mode/);
});

test('memory — dashboard reads back the latest decision with all fields', async () => {
  const d = await evaluateTrade(goodSwingSignal({ symbol: 'SOL', pair: 'SOLUSDT', entryPrice: 150 }), healthyContext());
  const latest = getLatestDecision();
  assert.equal(latest.decision_id, d.decision_id);
  assert.equal(latest.symbol, 'SOL');
  assert.equal(latest.final_decision, 'approved');
  assert.ok(Array.isArray(latest.lessons_from_similar_trades));
  assert.equal(latest.technical_report, d.technical_report);
});

test('memory — trade outcome closes the loop with bull/bear attribution and a lesson', async () => {
  const d = await evaluateTrade(goodSwingSignal({ symbol: 'ADA', pair: 'ADAUSDT', entryPrice: 1.2 }), healthyContext());
  const fakeTradeId = `swing_v1-test-${Date.now()}`;
  attachTradeToDecision(d.decision_id, fakeTradeId);
  recordDecisionOutcome({ id: fakeTradeId, pnl: -4.5, exitReason: 'stop_loss' });
  const updated = getDecisionById(d.decision_id);
  assert.ok(updated.outcome, 'outcome must be recorded');
  assert.equal(updated.outcome.pnl, -4.5);
  assert.equal(updated.outcome.bullWasRight, false);
  assert.equal(updated.outcome.bearWasRight, true);
  assert.match(updated.outcome.lesson, /swing_v1 long ADA/);
  assert.match(updated.outcome.lesson, /stop_loss/);
});

import { executeTrade } from '../trading/execution.mjs';

test('sentiment — real headlines feed the report and the debate', async () => {
  const sentiment = {
    sentiment: 'bullish', strength: 0.7, bull: 6, bear: 1, count: 8,
    headlines: [{ title: 'Bitcoin rallies to record high', source: 'Reuters' }],
    fetchedAt: new Date().toISOString(),
  };
  const aligned = await evaluateTrade(goodSwingSignal(), { ...healthyContext(), sentiment });
  assert.match(aligned.sentiment_report, /BULLISH/);
  assert.match(aligned.sentiment_report, /Bitcoin rallies to record high/);
  assert.match(aligned.bull_case, /News flow agrees/);

  const opposed = await evaluateTrade(goodSwingSignal({ side: 'SHORT', regime: 'BEAR' }),
    { ...healthyContext(), sentiment });
  assert.match(opposed.bear_case, /News flow disagrees/);
});

test('sentiment — unavailable source produces honest abstention', async () => {
  const d = await evaluateTrade(goodSwingSignal(), healthyContext());
  assert.match(d.sentiment_report, /insufficient_data/);
});

test('spread — live order-book spread overrides the tier estimate', async () => {
  const live = await evaluateTrade(goodSwingSignal(), { ...healthyContext(), realSpreadPct: 0.004 });
  // 0.4% of $300 notional = $1.20 (vs tier estimate 0.02% = $0.06)
  assert.equal(live.spread_estimated, 1.2);
  assert.match(live.technical_report, /order_book/);

  const fallback = await evaluateTrade(goodSwingSignal(), healthyContext());
  assert.match(fallback.technical_report, /tier_estimate/);
});

test('binary — open prediction trades do not false-positive the duplicate gate', async () => {
  const ctx = healthyContext();
  ctx.openPositions = [{ asset_pair: null, trade_type: 'prediction', capital_used: 50 }];
  const d = await evaluateTrade({
    strategy: 'prediction_market', binary: true,
    symbol: 'Will X happen by July?', pair: null,
    side: 'YES', entryPrice: 0.45, confidence: 0.72, genesisProb: 0.72,
    capitalUsed: 50, volume24h: 50_000, agentId: 'market-agent-1', tradeType: 'prediction',
  }, ctx);
  assert.equal(d.final_decision, 'approved', d.rejection_reason);
  assert.ok(d.expected_value > 0);
});

test('gate — executeTrade refuses ANY proposal without an approved decision', async () => {
  const result = await executeTrade({
    agentId: 'market-agent-1', marketId: 'm1', marketSource: 'polymarket',
    marketQuestion: 'bypass attempt', outcome: 'YES', entryPrice: 0.5,
    shares: 10, capitalUsed: 5, confidence: 0.9, tradeType: 'prediction',
  });
  assert.equal(result.executed, false);
  assert.equal(result.reason, 'council_gate:missing_decision_id');
});
