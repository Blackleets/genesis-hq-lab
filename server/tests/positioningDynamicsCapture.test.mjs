import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPositioningObservation } from '../genesis/positioningDynamicsCapture.mjs';

const capturedAtMs = Date.parse('2026-09-09T16:30:00.000Z');

function context() {
  return {
    oiRecentChangePct: 0.42,
    oiAccelerationPct: 0.18,
    takerRecentBias: 0.91,
    takerImpulse: -0.21,
    takerPressure: 'sell_pressure',
    takerReversal: true,
    fundingAvg: 0.00008,
    fundingCrowd: 'balanced',
    premiumNowBps: -1.4,
    premiumImpulseBps: -0.8,
    raw: {
      oi: [
        { time: capturedAtMs - 10 * 60_000, oiUsd: 1_000_000 },
        { time: capturedAtMs - 5 * 60_000, oiUsd: 1_020_000 },
      ],
      taker: [
        { time: capturedAtMs - 90 * 60_000, buySellRatio: 1.17 },
        { time: capturedAtMs - 30 * 60_000, buySellRatio: 0.78 },
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

test('builds one causal RESEARCH_ONLY envelope with source provenance', () => {
  const out = buildPositioningObservation(context(), closedKline(), { capturedAtMs });
  assert.equal(out.mode, 'RESEARCH_ONLY');
  assert.equal(out.researchUse, 'OBSERVATIONAL_ONLY_NOT_IN_H1_NOT_FOR_RANKING');
  assert.equal(out.price.close, 79050);
  assert.equal(out.positioning.oiUsdNow, 1_020_000);
  assert.equal(out.positioning.takerBuySellRatioNow, 0.78);
  assert.equal(out.positioning.fundingRateNow, 0.0001);
  assert.equal(out.positioning.takerReversal, true);
  assert.equal(out.provenance.closedPriceBarOnly, true);
  assert.equal(out.provenance.agesMs.openInterest, 5 * 60_000);
  assert.equal(out.provenance.agesMs.taker, 30 * 60_000);
  assert.equal(out.provenance.agesMs.funding, 8 * 60 * 60_000);
});

test('fails closed on future price data', () => {
  assert.throws(
    () => buildPositioningObservation(context(), closedKline(capturedAtMs + 1), { capturedAtMs }),
    /not closed/,
  );
});

test('fails closed on stale OI instead of silently using old positioning', () => {
  const c = context();
  c.raw.oi = [{ time: capturedAtMs - 16 * 60_000, oiUsd: 1_020_000 }];
  assert.throws(
    () => buildPositioningObservation(c, closedKline(), { capturedAtMs }),
    /openInterest source stale/,
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
