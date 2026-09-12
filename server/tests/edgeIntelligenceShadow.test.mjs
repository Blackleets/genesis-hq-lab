import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEdgeIntelligence,
  evaluateCandidate,
  summarizeEconomicEdge,
} from '../quant/edgeIntelligenceShadow.mjs';

function trade(i, overrides = {}) {
  return {
    trade_id: 'ei-' + i,
    strategy_version_id: 'futures_breakout_short_micro:v9',
    asset_pair: 'BTCUSDT',
    side: 'SHORT',
    entry_regime: 'TREND_DOWN',
    entry_session: 'LONDON',
    realized_net_pnl_usd: i % 2 === 0 ? 2 : -1,
    mfe_net_usd: i % 2 === 0 ? 6 : 1,
    exit_reason: i % 2 === 0 ? 'timed_profit_capture' : 'timeout',
    closed_at: '2026-09-12T08:00:00.000Z',
    ...overrides,
  };
}

test('economics use persisted net pnl and calculate expectancy/pf/win rate', () => {
  const metrics = summarizeEconomicEdge([trade(0), trade(1), trade(2), trade(3)]);
  assert.equal(metrics.closed, 4);
  assert.equal(metrics.realizedPnl, 2);
  assert.equal(metrics.expectancyUsd, 0.5);
  assert.equal(metrics.profitFactor, 2);
  assert.equal(metrics.winRate, 0.5);
  assert.equal(metrics.avgWin, 2);
  assert.equal(metrics.avgLoss, -1);
});

test('fewer than minimum segment trades never grant shadow permission', () => {
  const intel = buildEdgeIntelligence(Array.from({ length: 10 }, (_, i) => trade(i)));
  const seg = Object.values(intel.segments)[0];
  assert.equal(seg.verdict, 'INSUFFICIENT_EVIDENCE');
  assert.equal(intel.invariants.opensTrades, false);
  assert.equal(intel.executionAuthority, false);
});

test('positive net segment can become ALLOW_SHADOW without execution authority', () => {
  const intel = buildEdgeIntelligence(Array.from({ length: 20 }, (_, i) => trade(i)));
  const seg = Object.values(intel.segments)[0];
  assert.equal(seg.verdict, 'ALLOW_SHADOW');
  assert.equal(intel.systemVerdict, 'SELECTIVE_SHADOW_EDGE_PRESENT');
  assert.equal(intel.liveOrders, false);
});

test('negative expectancy blocks candidate and can flag quarantine candidate at 20 trades', () => {
  const rows = Array.from({ length: 20 }, (_, i) => trade(i, {
    realized_net_pnl_usd: i < 5 ? 1 : -1,
    mfe_net_usd: i < 5 ? 6 : 0,
  }));
  const intel = buildEdgeIntelligence(rows);
  assert.equal(intel.systemVerdict, 'QUARANTINE_CANDIDATE');
  const decision = evaluateCandidate({
    strategyVersionId: 'futures_breakout_short_micro:v9',
    side: 'SHORT',
    regime: 'TREND_DOWN',
    session: 'LONDON',
  }, intel);
  assert.equal(decision.decision, 'NO_TRADE_SHADOW');
});

test('v8 trades are excluded from edge intelligence', () => {
  const rows = [
    ...Array.from({ length: 12 }, (_, i) => trade(i)),
    trade(99, { strategy_version_id: 'futures_breakout_short_micro:v8', realized_net_pnl_usd: 999 }),
  ];
  const intel = buildEdgeIntelligence(rows);
  assert.equal(intel.overall.closed, 12);
  assert.equal(intel.strategyScope, 'v9_only');
});
