import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  bucketConcentration,
  evaluateExperimentResult,
  trendContinuationSignal,
  breakoutSignal,
  trendGatedBreakoutSignal,
  regimeSwitchBreakoutSignal,
  regimeGatedScalpSignal,
  shortOnlyRegimeSwitchBreakoutSignal,
  longOnlyRegimeSwitchBreakoutSignal,
  buildStrategyLabExperiments,
} from '../crypto/backtest/strategyLab.mjs';

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

  it('allows intentional one-sided strategies when requireTwoSided is disabled', () => {
    const verdict = evaluateExperimentResult({
      train: { expectancy: 0.30, profitFactor: 1.2, trades: 90 },
      test: { expectancy: 0.25, profitFactor: 1.3, trades: 45 },
      concentration: {
        hour: { share: 0.45, bucket: '12' },
        side: { share: 1, bucket: 'SHORT' },
      },
    }, { minTrainTrades: 80, minTestTrades: 40, minProfitFactor: 1.1, maxBucketShare: 0.5, requireTwoSided: false });
    assert.equal(verdict.passed, true);
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
    assert.ok(experiments.some((experiment) => experiment.hypothesis === 'scalp_regime_gated'));
    assert.ok(experiments.some((experiment) => experiment.hypothesis === 'breakout_regime_switch_short_focus'));
    assert.ok(experiments.some((experiment) => experiment.hypothesis === 'breakout_regime_switch_long_probe'));
  });

  it('breakout signal goes LONG when the last close breaks the prior channel high', () => {
    const closes = [...Array.from({ length: 25 }, () => 100), 105]; // flat channel, then a break up
    const signal = breakoutSignal({ closes }, { breakoutPeriod: 20 });
    assert.equal(signal.action, 'TRADE');
    assert.equal(signal.side, 'LONG');
    assert.deepEqual(signal.reasons, ['donchian_breakout_long']);
  });

  it('breakout signal goes SHORT when the last close breaks the prior channel low', () => {
    const closes = [...Array.from({ length: 25 }, () => 100), 95]; // flat channel, then a break down
    const signal = breakoutSignal({ closes }, { breakoutPeriod: 20 });
    assert.equal(signal.action, 'TRADE');
    assert.equal(signal.side, 'SHORT');
    assert.deepEqual(signal.reasons, ['donchian_breakout_short']);
  });

  it('breakout signal SKIPs inside the channel', () => {
    const closes = [...Array.from({ length: 24 }, (_, i) => 100 + (i % 2)), 100]; // oscillates 100-101, last inside
    const signal = breakoutSignal({ closes }, { breakoutPeriod: 20 });
    assert.equal(signal.action, 'SKIP');
    assert.equal(signal.side, null);
    assert.deepEqual(signal.reasons, ['inside_channel']);
  });

  it('breakout signal reports insufficient history below period + 2 closes', () => {
    const signal = breakoutSignal({ closes: [100, 101, 102] }, { breakoutPeriod: 20 });
    assert.equal(signal.action, 'SKIP');
    assert.deepEqual(signal.reasons, ['insufficient_history']);
  });

  it('trend-gated breakout SKIPs a LONG breakout when EMA trend is down (counter-trend)', () => {
    const closes = [...Array.from({ length: 25 }, () => 100), 105]; // breaks the high → LONG breakout
    // ema9 < ema21 → downtrend, so a LONG breakout is counter-trend and must be skipped.
    const signal = trendGatedBreakoutSignal({ closes, ema9: 99, ema21: 100 }, { breakoutPeriod: 20 });
    assert.equal(signal.action, 'SKIP');
    assert.deepEqual(signal.reasons, ['breakout_LONG_counter_trend']);
  });

  it('trend-gated breakout TRADEs a LONG breakout when EMA trend is up (aligned)', () => {
    const closes = [...Array.from({ length: 25 }, () => 100), 105];
    const signal = trendGatedBreakoutSignal({ closes, ema9: 101, ema21: 100 }, { breakoutPeriod: 20 });
    assert.equal(signal.action, 'TRADE');
    assert.equal(signal.side, 'LONG');
    assert.ok(signal.reasons.includes('trend_aligned'));
  });

  it('regime-switch breakout takes a LONG breakout only when price is above the SMA (bull)', () => {
    // 24 closes climbing 80→103 (SMA below price), then a break to 130 → LONG breakout in a bull regime.
    const closes = [...Array.from({ length: 24 }, (_, i) => 80 + i), 130];
    const signal = regimeSwitchBreakoutSignal({ closes }, { breakoutPeriod: 20, regimeSmaPeriod: 20 });
    assert.equal(signal.action, 'TRADE');
    assert.equal(signal.side, 'LONG');
    assert.ok(signal.reasons.includes('regime_bull'));
  });

  it('regime-switch breakout SKIPs a LONG breakout when price is below the SMA (counter-regime)', () => {
    // A short-period local high inside a larger downtrend: 20 bars at 200, 19 at 100, last 101.
    // breakoutPeriod 5 → 101 breaks the recent (100) high = LONG breakout. regimeSmaPeriod 40 →
    // SMA ≈ 150, price 101 is below it = bear regime → counter-regime LONG must be skipped.
    const closes = [...Array.from({ length: 20 }, () => 200), ...Array.from({ length: 19 }, () => 100), 101];
    const signal = regimeSwitchBreakoutSignal({ closes }, { breakoutPeriod: 5, regimeSmaPeriod: 40 });
    assert.equal(signal.action, 'SKIP');
    assert.equal(signal.reasons[0], 'breakout_LONG_vs_regime');
  });

  it('regime-switch breakout reports regime_unknown without enough closes for the SMA', () => {
    const closes = [...Array.from({ length: 24 }, () => 100), 105]; // breaks high, but only 25 closes < sma200
    const signal = regimeSwitchBreakoutSignal({ closes }, { breakoutPeriod: 20, regimeSmaPeriod: 200 });
    assert.equal(signal.action, 'SKIP');
    assert.deepEqual(signal.reasons, ['regime_unknown']);
  });

  it('short-only regime-switch breakout filters out aligned LONG trades', () => {
    const closes = [...Array.from({ length: 24 }, (_, i) => 80 + i), 130];
    const signal = shortOnlyRegimeSwitchBreakoutSignal({ closes }, { breakoutPeriod: 20, regimeSmaPeriod: 20 });
    assert.equal(signal.action, 'SKIP');
    assert.deepEqual(signal.reasons, ['regime_long_filtered']);
  });

  it('long-only regime-switch breakout filters out aligned SHORT trades', () => {
    const closes = [...Array.from({ length: 25 }, () => 100), 95];
    const signal = longOnlyRegimeSwitchBreakoutSignal({ closes }, { breakoutPeriod: 20, regimeSmaPeriod: 20 });
    assert.equal(signal.action, 'SKIP');
    assert.deepEqual(signal.reasons, ['regime_short_filtered']);
  });

  it('regime-gated scalp blocks a local LONG when the slow regime is still bearish', () => {
    const closes = [
      ...Array.from({ length: 200 }, () => 200),
      ...Array.from({ length: 30 }, (_, index) => 100 + index * 0.15),
    ];
    const signal = regimeGatedScalpSignal({
      closes,
      price: 104.35,
      ema9: 104,
      ema21: 103.5,
      rsi14: 56,
      change1h: 0.5,
      volume24h: 2_000_000,
    }, {
      useHtfFilter: 0,
      regimeSmaPeriod: 200,
      minVolume24h: 1_000_000,
      momentumPct: 0.2,
      emaMarginPct: 0.001,
      rsiLongMin: 45,
      rsiLongMax: 68,
      rsiShortMin: 32,
      rsiShortMax: 55,
    });
    assert.equal(signal.action, 'SKIP');
    assert.deepEqual(signal.reasons, ['scalp_LONG_vs_regime']);
  });

  it('regime-gated scalp keeps a LONG when the live scalp signal agrees with the bull regime', () => {
    const closes = Array.from({ length: 240 }, (_, index) => 100 + index * 0.2);
    const signal = regimeGatedScalpSignal({
      closes,
      price: closes.at(-1),
      ema9: 147.9,
      ema21: 146.2,
      rsi14: 58,
      change1h: 0.6,
      volume24h: 2_000_000,
    }, {
      useHtfFilter: 0,
      regimeSmaPeriod: 200,
      minVolume24h: 1_000_000,
      momentumPct: 0.2,
      emaMarginPct: 0.001,
      rsiLongMin: 45,
      rsiLongMax: 68,
      rsiShortMin: 32,
      rsiShortMax: 55,
    });
    assert.equal(signal.action, 'TRADE');
    assert.equal(signal.side, 'LONG');
    assert.ok(signal.reasons.includes('regime_bull'));
  });

  it('trend continuation signal produces a long trade on aligned data', () => {
    const closes = Array.from({ length: 400 }, (_, index) => 100 + index * 0.2);
    const signal = trendContinuationSignal({ closes, price: closes.at(-1) }, { trendFrameMinutes: 60, trendMomentumPct: 0.2, trendRsiMax: 100 });
    assert.equal(signal.action, 'TRADE');
    assert.equal(signal.side, 'LONG');
  });
});
