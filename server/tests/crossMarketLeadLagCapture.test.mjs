import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCrossMarketObservation, buildExecutionFriction, parseTopOfBook } from '../genesis/crossMarketLeadLagCapture.mjs';

const row = (t, close, quote, confirm = '1') => [
  String(t), String(close - 1), String(close + 1), String(close - 2), String(close),
  '10', '20', String(quote), confirm,
];
const book = (ts, bid, ask) => ({ ts: String(ts), bids: [[String(bid), '1', '0', '1']], asks: [[String(ask), '1', '0', '1']] });

test('aligns only confirmed OKX spot/perp bars and derives causal cross-market features', () => {
  const t0 = Date.UTC(2026, 8, 9, 12, 0, 0);
  const t1 = t0 + 60_000;
  const t2 = t1 + 60_000;
  const spot = [row(t2, 999, 1, '0'), row(t1, 101, 1200), row(t0, 100, 1000)];
  const fut = [row(t2, 1, 1, '0'), row(t1, 101.2, 2400), row(t0, 100.1, 2000)];
  const out = buildCrossMarketObservation(spot, fut, { spotBook: book(t2, 100.99, 101.01), futuresBook: book(t2 + 5, 101.18, 101.22) });

  assert.equal(out.schemaVersion, 3);
  assert.equal(out.mode, 'RESEARCH_ONLY');
  assert.equal(out.provider, 'okx_public_market_data');
  assert.equal(out.researchUse, 'OBSERVATIONAL_ONLY_NOT_IN_H1_NOT_FOR_RANKING');
  assert.equal(out.barOpenTime, new Date(t1).toISOString());
  assert.equal(out.features.spotClose, 101);
  assert.equal(out.features.futuresClose, 101.2);
  assert.equal(out.features.spotQuoteVolume, 1200);
  assert.equal(out.features.futuresQuoteVolume, 2400);
  assert.equal(out.features.futuresToSpotQuoteVolumeRatio, 2);
  assert.equal(out.features.volatility.available, false);
  assert.equal(out.features.executionFriction.available, true);
  assert.ok(out.features.executionFriction.spot.spreadBps > 0);
  assert.ok(out.features.executionFriction.futures.spreadBps > 0);
  assert.ok(out.features.basisBps > 0);
  assert.ok(out.features.spotReturn1mBps > 0);
  assert.equal(out.provenance.confirmedBarsOnly, true);
  assert.equal(out.provenance.requestLimit, 20);
  assert.equal(out.provenance.orderBookDepth, 5);
  assert.match(out.provenance.volatilityBaselinePolicy, /PRECEDING_15_CLOSED_ALIGNED_1M_RETURNS_RMS/);
  assert.match(out.provenance.executionFrictionPolicy, /OBSERVATIONAL_ONLY/);
});

test('top-of-book execution friction requires valid bid/ask and preserves exchange source timestamp', () => {
  const ts = Date.UTC(2026, 8, 9, 12, 3, 1, 123);
  const parsed = parseTopOfBook(book(ts, 100, 100.1));
  assert.equal(parsed.available, true);
  assert.equal(parsed.sourceAsOf, new Date(ts).toISOString());
  assert.ok(parsed.spreadBps > 0);

  const invalid = parseTopOfBook(book(ts, 100.1, 100));
  assert.equal(invalid.available, false);
  assert.equal(invalid.spreadBps, null);
  const friction = buildExecutionFriction(book(ts, 100, 100.1), null);
  assert.equal(friction.available, false);
  assert.equal(friction.conservativeRoundTripTopOfBookBps, null);
  assert.match(friction.policy, /NO_GATE_OR_RANKING_USE/);
});

test('volatility shock compares current closed return only with the preceding 15 closed returns', () => {
  const t0 = Date.UTC(2026, 8, 9, 12, 0, 0);
  const spot = [];
  const fut = [];
  for (let i = 0; i < 17; i += 1) {
    const t = t0 + i * 60_000;
    const quietClose = 100 + i * 0.01;
    spot.push(row(t, i === 16 ? quietClose + 1 : quietClose, 1000 + i));
    fut.push(row(t, i === 16 ? quietClose + 1.2 : quietClose + 0.05, 2000 + i));
  }
  spot.push(row(t0 + 17 * 60_000, 1000, 9999, '0'));
  fut.push(row(t0 + 17 * 60_000, 1, 9999, '0'));

  const out = buildCrossMarketObservation(spot.reverse(), fut.reverse());
  assert.equal(out.features.volatility.available, true);
  assert.equal(out.features.volatility.baselineReturnCount, 15);
  assert.equal(out.features.volatility.baselineWindowMinutes, 15);
  assert.ok(out.features.volatility.spotRms15mBps > 0);
  assert.ok(out.features.volatility.futuresRms15mBps > 0);
  assert.ok(out.features.volatility.spotShockRatio > 10);
  assert.ok(out.features.volatility.futuresShockRatio > 10);
  assert.equal(out.features.executionFriction.available, false);
  assert.equal(out.barOpenTime, new Date(t0 + 16 * 60_000).toISOString());
});

test('requires two aligned confirmed bars', () => {
  const t0 = Date.UTC(2026, 8, 9, 12, 0, 0);
  assert.throws(
    () => buildCrossMarketObservation([row(t0, 100, 1000)], [row(t0, 100, 1000)]),
    /two aligned confirmed 1m bars/,
  );
});
