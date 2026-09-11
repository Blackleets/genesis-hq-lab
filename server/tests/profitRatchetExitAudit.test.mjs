import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProfitRatchetExitAudit,
  mfeBand,
  normalizeRatchetTrade,
  summarizeRatchetCohort,
  WINNER_LOST_MFE_USD,
} from '../quant/profitRatchetExitAudit.mjs';

function trade(overrides = {}) {
  return {
    trade_id: 'v9-test',
    strategy_version_id: 'futures_breakout_short_micro:v9',
    runner_version: 'v8.4',
    exit_policy_version: 'adaptive_profit_ratchet_v1',
    asset_pair: 'BTCUSDT',
    side: 'SHORT',
    entry_regime: 'TREND_DOWN',
    entry_session: 'LONDON',
    leverage: 3,
    notional_usd: 450,
    mfe_net_usd: 20,
    mae_observed_net_usd: -3,
    max_protected_profit_usd: 10,
    realized_net_pnl_usd: 15,
    ratchet_activated: true,
    ratchet_save_exit: true,
    exit_reason: 'profit_ratchet_stop',
    activation_strength: 'STRONG',
    opened_at: '2026-09-11T12:00:00.000Z',
    closed_at: '2026-09-11T13:00:00.000Z',
    ...overrides,
  };
}

test('capture efficiency and giveback use persisted net PnL directly', () => {
  const normalized = normalizeRatchetTrade(trade());
  assert.equal(normalized.capture, 0.75);
  assert.equal(normalized.giveback, 5);
  assert.equal(normalized.givebackPct, 0.25);
  assert.equal(normalized.protectedEfficiency, 1.5);
  const metrics = summarizeRatchetCohort([trade()]);
  assert.equal(metrics.realizedPnl, 15);
  assert.equal(metrics.economicsBasis, 'persisted_net_pnl_no_additional_cost_subtraction');
});

test('winner lost uses the existing $5 activation threshold and realized net PnL <= 0', () => {
  assert.equal(WINNER_LOST_MFE_USD, 5);
  assert.equal(normalizeRatchetTrade(trade({ mfe_net_usd: 14.2, realized_net_pnl_usd: -3.1, ratchet_save_exit: false, exit_reason: 'timeout' })).winnerLost, true);
  assert.equal(normalizeRatchetTrade(trade({ mfe_net_usd: 4.99, realized_net_pnl_usd: -3.1, ratchet_save_exit: false, exit_reason: 'timeout' })).winnerLost, false);
});

test('ratchet save exit never claims an unobserved counterfactual', () => {
  const audit = buildProfitRatchetExitAudit([trade()]);
  assert.equal(audit.metrics.ratchetSaveExits, 1);
  assert.equal(audit.metrics.counterfactualWithoutRatchet, 'NOT_DEMONSTRABLE_FROM_OBSERVED_PATH');
  assert.equal(audit.evidenceGates.automaticTuning, false);
});

test('MFE bands match the charter exactly', () => {
  assert.equal(mfeBand(0), '$0-5');
  assert.equal(mfeBand(4.999), '$0-5');
  assert.equal(mfeBand(5), '$5-10');
  assert.equal(mfeBand(10), '$10-25');
  assert.equal(mfeBand(25), '$25-50');
  assert.equal(mfeBand(50), '$50-100');
  assert.equal(mfeBand(100), '$100+');
});

test('audit keeps v8 evidence out of the v9 ratchet cohort', () => {
  const rows = [
    trade({ trade_id: 'v9' }),
    trade({ trade_id: 'v8', strategy_version_id: 'futures_breakout_short_micro:v8', realized_net_pnl_usd: -999 }),
  ];
  const audit = buildProfitRatchetExitAudit(rows);
  assert.equal(audit.metrics.trades, 1);
  assert.equal(audit.metrics.realizedPnl, 15);
  assert.equal(audit.strategyScope, 'v9_only');
});

test('entry vs exit diagnosis stays insufficient before 10 closed v9 trades', () => {
  const rows = Array.from({ length: 9 }, (_, index) => trade({ trade_id: `t-${index}` }));
  const audit = buildProfitRatchetExitAudit(rows);
  assert.equal(audit.diagnosis.sampleGate, 'INSUFFICIENT_EVIDENCE');
  assert.equal(audit.diagnosis.entryEdge, 'INSUFFICIENT_EVIDENCE');
  assert.equal(audit.diagnosis.exitEdge, 'INSUFFICIENT_EVIDENCE');
  assert.equal(audit.evidenceGates.earlyDiagnosticReady, false);
});

test('ten-trade diagnosis can isolate exit capture weakness without tuning', () => {
  const rows = Array.from({ length: 10 }, (_, index) => trade({
    trade_id: `weak-exit-${index}`,
    mfe_net_usd: 20,
    realized_net_pnl_usd: index < 6 ? 3 : -2,
    ratchet_save_exit: false,
    exit_reason: 'timeout',
  }));
  const audit = buildProfitRatchetExitAudit(rows);
  assert.equal(audit.diagnosis.sampleGate, 'TEN_TRADE_EARLY_DIAGNOSTIC');
  assert.equal(audit.diagnosis.entryEdge, 'FAVORABLE_EXCURSION_PRESENT');
  assert.equal(audit.diagnosis.exitEdge, 'CAPTURE_WEAKNESS_SUSPECTED');
  assert.equal(audit.diagnosis.automaticParameterChangeAllowed, false);
});

test('segmentation includes version pair side regime session leverage sizing exit strength and MFE band', () => {
  const audit = buildProfitRatchetExitAudit([trade()]);
  assert.ok(audit.segments.strategyVersion['futures_breakout_short_micro:v9']);
  assert.ok(audit.segments.pair.BTCUSDT);
  assert.ok(audit.segments.side.SHORT);
  assert.ok(audit.segments.regime.TREND_DOWN);
  assert.ok(audit.segments.session.LONDON);
  assert.ok(audit.segments.leverage['3x']);
  assert.ok(audit.segments.notionalSizing['<$500']);
  assert.ok(audit.segments.exitReason.profit_ratchet_stop);
  assert.ok(audit.segments.contextStrength.STRONG);
  assert.ok(audit.segments.mfeBand['$10-25']);
});
