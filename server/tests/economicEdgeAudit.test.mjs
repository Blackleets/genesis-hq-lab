import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEconomicEdgeAudit, modeledFriction } from '../quant/economicEdgeAudit.mjs';

function trade(i, overrides = {}) {
  const win = overrides.win ?? (i % 2 === 0);
  const confidence = overrides.confidence ?? (i % 4 < 2 ? 0.65 : 0.85);
  const pnl = overrides.pnl ?? (win ? 12 : -4);
  return {
    id: `t-${i}`,
    trade_type: 'crypto_futures_breakout_short_micro',
    instrument_type: 'futures',
    asset_pair: i % 2 === 0 ? 'BTCUSDT' : 'ETHUSDT',
    outcome: 'SHORT',
    status: 'closed',
    mode: 'paper',
    confidence,
    entry_price: 100,
    exit_price: 99,
    shares: 5,
    capital_used: 150,
    leverage: 3,
    notional_usd: 450,
    entry_volume24h: 5_000_000,
    funding_paid: 0.02,
    pnl,
    opened_at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
    closed_at: new Date(Date.UTC(2026, 0, 1, 1, i)).toISOString(),
    evidence: JSON.stringify(['DONCHIAN20', 'RUNNER_V8.1', 'REGIME_TREND_DOWN', 'STRATEGY_VERSION_futures_breakout_short_micro:v8']),
    strategy_version_id: 'futures_breakout_short_micro:v8',
    entry_regime: i % 2 === 0 ? 'TREND_DOWN' : 'HIGH_VOL_TREND_DOWN',
    entry_session: i % 3 === 0 ? 'LONDON' : 'NEW_YORK',
    runner_version: 'v8.1',
    validation_status: 'PAPER',
    ...overrides,
  };
}

const research = {
  'futures_breakout_short_micro:v8': {
    evaluated_at: '2026-09-11T00:00:00Z',
    verdict: 'VALIDATED',
    policy_version: 'institutional_v1',
    walk_forward: { pass: true },
    oos_evidence: { pass: true },
  },
};

test('friction reconstruction includes round-trip fees, slippage and funding', () => {
  const result = modeledFriction(trade(1));
  assert.ok(result.feeUsd > 0);
  assert.ok(result.slippageUsd > 0);
  assert.equal(result.fundingUsd, 0.02);
  assert.ok(result.modeledCostBps > 8);
});

test('negative exact-version cohort triggers strict kill criteria', () => {
  const rows = Array.from({ length: 24 }, (_, i) => trade(i, { pnl: i % 5 === 0 ? 2 : -6, confidence: i % 2 ? 0.7 : 0.8 }));
  const audit = buildEconomicEdgeAudit(rows, { researchEvidence: research, generatedAt: '2026-09-11T00:00:00Z' });
  const strategy = audit.strategies['futures_breakout_short_micro:v8'];
  assert.equal(strategy.status, 'KILL');
  assert.ok(strategy.killReasons.some((reason) => reason.startsWith('NEGATIVE_EDGE:')));
  assert.equal(strategy.capitalEligible, false);
});

test('live contamination fails pipeline integrity and can never promote', () => {
  const rows = Array.from({ length: 60 }, (_, i) => trade(i));
  rows[10] = trade(10, { mode: 'real' });
  const audit = buildEconomicEdgeAudit(rows, { researchEvidence: research, generatedAt: '2026-09-11T00:00:00Z' });
  const strategy = audit.strategies['futures_breakout_short_micro:v8'];
  assert.equal(strategy.status, 'KILL');
  assert.equal(strategy.pipeline.checks.paperOnly, false);
  assert.equal(strategy.liveOrdersAuthorized, false);
});

test('constant confidence blocks evidence candidate even when PnL is strong', () => {
  const rows = Array.from({ length: 60 }, (_, i) => trade(i, { confidence: 0.75, pnl: i % 3 === 0 ? -4 : 12 }));
  const audit = buildEconomicEdgeAudit(rows, { researchEvidence: research, generatedAt: '2026-09-11T00:00:00Z' });
  const strategy = audit.strategies['futures_breakout_short_micro:v8'];
  assert.equal(strategy.status, 'KEEP_PAPER');
  assert.equal(strategy.calibration.bucketsPopulated, 1);
  assert.equal(strategy.gates.find((gate) => gate.code === 'CALIBRATION_DIVERSITY').pass, false);
});

test('well-attributed positive evidence can become evidence candidate but never capital eligible', () => {
  const rows = Array.from({ length: 80 }, (_, i) => {
    const high = i % 4 < 2;
    const win = high ? i % 10 !== 0 : i % 5 !== 0;
    return trade(i, {
      confidence: high ? 0.85 : 0.65,
      pnl: win ? 14 : -4,
      win,
    });
  });
  const audit = buildEconomicEdgeAudit(rows, { researchEvidence: research, generatedAt: '2026-09-11T00:00:00Z' });
  const strategy = audit.strategies['futures_breakout_short_micro:v8'];
  assert.equal(strategy.status, 'EVIDENCE_CANDIDATE');
  assert.equal(strategy.capitalEligible, false);
  assert.equal(strategy.liveOrdersAuthorized, false);
  assert.ok(strategy.metrics.expectancy > 0);
  assert.ok(Object.keys(strategy.segments.asset).length >= 2);
  assert.ok(Object.keys(strategy.segments.regime).length >= 2);
  assert.ok(Object.keys(strategy.segments.cost).length >= 1);
  assert.ok(Object.keys(strategy.segments.sizing).length >= 1);
});

test('audit hash is reproducible and independent of generatedAt', () => {
  const rows = [trade(2), trade(1)];
  const a = buildEconomicEdgeAudit(rows, { generatedAt: '2026-09-11T00:00:00Z' });
  const b = buildEconomicEdgeAudit([...rows].reverse(), { generatedAt: '2026-09-12T00:00:00Z' });
  assert.equal(a.source.evidenceSha256, b.source.evidenceSha256);
});
