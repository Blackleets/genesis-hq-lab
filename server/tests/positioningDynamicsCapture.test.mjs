import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPositioningObservation, deriveCrossCapturePositioningFeatures } from '../genesis/positioningDynamicsCapture.mjs';

const capturedAtMs = Date.parse('2026-09-09T16:30:00.000Z');

function context() {
  return {
    oiRecentChangePct: 0.42,
    oiAccelerationPct: 0.18,
    takerRecentBias: 0.91,
    takerImpulse: null,
    takerPressure: 'sell_pressure',
    takerReversal: false,
    fundingAvg: 0.00008,
    fundingCrowd: 'balanced',
    premiumNowBps: -1.4,
    premiumImpulseBps: -0.8,
    volatilityState: 'normal',
    volatilityExpansionRatio: 0.9,
    raw: {
      oi: [
        { time: capturedAtMs - 10 * 60_000, oi: 1_000_000 },
        { time: capturedAtMs - 5 * 60_000, oi: 1_020_000 },
      ],
      taker: [
        {
          time: capturedAtMs - 30_000,
          buySellRatio: 0.78,
          buyFraction: 0.4382,
          notionalBuyFraction: 0.44,
          tradeCount: 240,
          targetWindowMs: 60_000,
          coverageMs: 59_500,
          pagesFetched: 3,
          source: 'okx_public_history_trades_fixed_window',
        },
      ],
      funding: [
        { time: capturedAtMs - 8 * 60 * 60_000, rate: 0.0001 },
      ],
      premium: [],
    },
  };
}

function closedKline(closeTime = capturedAtMs - 1_000) {
  return [capturedAtMs - 60_000, '79000', '79100', '78900', '79050', '12', closeTime, '948600', 100, '6', '474300', '0'];
}

function observation({ capturedAt = '2026-09-09T16:25:00.000Z', oi = 1_000_000, taker = 0.8, buyFraction = 0.4444, funding = 0.00008, premium = -2, close = 79000 } = {}) {
  return {
    schemaVersion: 4,
    mode: 'RESEARCH_ONLY',
    provider: 'okx_public_market_data',
    symbol: 'BTCUSDT',
    capturedAt,
    price: { close },
    positioning: {
      openInterest: { value: oi, unit: 'CONTRACTS' },
      takerBuySellRatioNow: taker,
      takerBuyFractionNow: buyFraction,
      fundingRateNow: funding,
      premiumNowBps: premium,
    },
  };
}

test('builds one causal RESEARCH_ONLY envelope with fixed-window taker provenance and explicit OI units', () => {
  const out = buildPositioningObservation(context(), closedKline(), {
    capturedAtMs,
    openInterestUnit: 'CONTRACTS',
  });
  assert.equal(out.schemaVersion, 4);
  assert.equal(out.mode, 'RESEARCH_ONLY');
  assert.equal(out.researchUse, 'OBSERVATIONAL_ONLY_NOT_IN_H1_NOT_FOR_RANKING');
  assert.equal(out.price.close, 79050);
  assert.deepEqual(out.positioning.openInterest, { value: 1_020_000, unit: 'CONTRACTS' });
  assert.equal(out.positioning.takerBuySellRatioNow, 0.78);
  assert.equal(out.positioning.takerBuyFractionNow, 0.4382);
  assert.equal(out.positioning.takerTradeCount, 240);
  assert.equal(out.positioning.takerWindowMs, 60_000);
  assert.equal(out.positioning.fundingRateNow, 0.0001);
  assert.equal(out.positioning.volatilityState, 'normal');
  assert.equal(out.provenance.closedPriceBarOnly, true);
  assert.equal(out.provenance.fixedWindowTakerFlow, true);
  assert.equal(out.provenance.crossCaptureUsesStrictlyPriorDurableObservation, true);
  assert.match(out.provenance.note, /fixed one-minute public-trade window/);
  assert.equal(out.provenance.agesMs.openInterest, 5 * 60_000);
  assert.equal(out.provenance.agesMs.taker, 30_000);
  assert.equal(out.provenance.agesMs.funding, 8 * 60 * 60_000);
});

test('derives real positioning dynamics only from a strictly prior durable capture', () => {
  const previous = observation();
  const current = observation({
    capturedAt: '2026-09-09T16:30:00.000Z',
    oi: 1_010_000,
    taker: 1.05,
    buyFraction: 0.5122,
    funding: 0.00009,
    premium: -1.25,
    close: 79158,
  });
  const out = deriveCrossCapturePositioningFeatures(previous, current);
  assert.equal(out.available, true);
  assert.equal(out.causal, true);
  assert.equal(out.elapsedMinutes, 5);
  assert.ok(Math.abs(out.oiChangePct - 1) < 1e-9);
  assert.ok(Math.abs(out.takerBuySellRatioDelta - 0.25) < 1e-9);
  assert.ok(Math.abs(out.takerBuyFractionDelta - 0.0678) < 1e-9);
  assert.ok(Math.abs(out.fundingDeltaBps - 0.1) < 1e-9);
  assert.ok(Math.abs(out.premiumDeltaBps - 0.75) < 1e-9);
  assert.ok(out.perpReturnBps > 0);
  assert.equal(out.researchUse, 'OBSERVATIONAL_ONLY_NOT_FOR_RANKING');
});

test('keeps legacy prior captures usable but does not fabricate bounded taker delta', () => {
  const previous = observation();
  delete previous.positioning.takerBuyFractionNow;
  const current = observation({ capturedAt: '2026-09-09T16:30:00.000Z' });
  const out = deriveCrossCapturePositioningFeatures(previous, current);
  assert.equal(out.available, true);
  assert.equal(out.takerBuyFractionDelta, null);
});

test('refuses non-causal or stale prior captures', () => {
  const current = observation({ capturedAt: '2026-09-09T16:30:00.000Z' });
  const future = observation({ capturedAt: '2026-09-09T16:31:00.000Z' });
  const stale = observation({ capturedAt: '2026-09-09T15:00:00.000Z' });
  assert.equal(deriveCrossCapturePositioningFeatures(future, current).reason, 'NON_CAUSAL_TIME_ORDER');
  assert.equal(deriveCrossCapturePositioningFeatures(stale, current).reason, 'PRIOR_CAPTURE_TOO_OLD');
});

test('refuses cross-series contamination', () => {
  const previous = observation();
  previous.symbol = 'ETHUSDT';
  const current = observation({ capturedAt: '2026-09-09T16:30:00.000Z' });
  assert.equal(deriveCrossCapturePositioningFeatures(previous, current).reason, 'SERIES_MISMATCH');
});

test('fails closed on future price data', () => {
  assert.throws(
    () => buildPositioningObservation(context(), closedKline(capturedAtMs + 1), { capturedAtMs }),
    /not closed/,
  );
});

test('fails closed on stale OI instead of silently using old positioning', () => {
  const c = context();
  c.raw.oi = [{ time: capturedAtMs - 16 * 60_000, oi: 1_020_000 }];
  assert.throws(
    () => buildPositioningObservation(c, closedKline(), { capturedAtMs }),
    /openInterest source stale/,
  );
});

test('fails closed on stale taker evidence instead of carrying a burst forward', () => {
  const c = context();
  c.raw.taker[0].time = capturedAtMs - 3 * 60_000;
  assert.throws(
    () => buildPositioningObservation(c, closedKline(), { capturedAtMs }),
    /taker source stale/,
  );
});

test('fails closed when a required derivatives source is absent', () => {
  const c = context();
  c.raw.taker = [];
  assert.throws(
    () => buildPositioningObservation(c, closedKline(), { capturedAtMs }),
    /OI, taker and funding observations are required/,
  );
});
