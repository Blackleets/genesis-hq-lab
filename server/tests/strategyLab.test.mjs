import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { bucketConcentration, evaluateExperimentResult, trendContinuationSignal, buildStrategyLabExperiments } from '../crypto/backtest/strategyLab.mjs';

describe('strategyLab helpers', () => {
  it('rejects a candidate with concentrated hour pnl', () => {
    const verdict = evaluateExperimentResult({
      train: { expectancy: 0.2, profitFactor: 1.3, trades: 220 },
      test: { expectancy: 0.15, profitFactor: 1.2, trades: 100 },
      concentration: {
        hour: { share: 0.66, bucket: '16' },
        side: { share: 0.4, bucket: 'LONG' },
      },
    });
    assert.equal(verdict.passed, false);
    assert.match(verdict.rejectReason, /hour bucket 16 contributes/);
  });

  it('passes a balanced candidate above thresholds', () => {
    const verdict = evaluateExperimentResult({
      train: { expectancy: 0.22, profitFactor: 1.4, trades: 260 },
      test: { expectancy: 0.11, profitFactor: 1.25, trades: 110 },
      concentration: {
        hour: { share: 0.32, bucket: '09' },
        side: { share: 0.45, bucket: 'LONG' },
      },
    });
    assert.equal(verdict.passed, true);
    assert.equal(verdict.rejectReason, null);
  });

  it('computes bucket concentration from trades', () => {
    const summary = bucketConcentration([
      { pnl: 8, openTime: Date.UTC(2026, 0, 1, 8), side: 'LONG' },
      { pnl: 3, openTime: Date.UTC(2026, 0, 1, 8), side: 'LONG' },
      { pnl: 5, openTime: Date.UTC(2026, 0, 1, 12), side: 'SHORT' },
    ], (trade) => trade.side);
    assert.equal(summary.bucket, 'LONG');
    assert.ok(summary.share > 0.5);
  });

  it('builds canonical experiments in strict order', () => {
    const experiments = buildStrategyLabExperiments();
    assert.equal(experiments[0].hypothesis, 'single_pair');
    assert.equal(experiments[1].hypothesis, 'single_pair');
    assert.equal(experiments[2].hypothesis, 'single_pair');
    assert.equal(experiments[3].hypothesis, 'trend');
    assert.ok(experiments.some((experiment) => experiment.hypothesis === 'reversion'));
  });

  it('trend continuation signal produces a long trade on aligned data', () => {
    const closes = Array.from({ length: 400 }, (_, index) => 100 + index * 0.2);
    const signal = trendContinuationSignal({ closes, price: closes.at(-1) }, { trendFrameMinutes: 60, trendMomentumPct: 0.2, trendRsiMax: 100 });
    assert.equal(signal.action, 'TRADE');
    assert.equal(signal.side, 'LONG');
  });
});
