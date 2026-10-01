import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildPositioningObservation } from '../genesis/positioningDynamicsCapture.mjs';
import { CONTINUITY_PROTOCOL, budgetedFetch, runPositioningContinuity } from '../research/runPositioningContinuity.mjs';

function harness(t, change = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'positioning-continuity-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sessionDir = path.join(root, 'session');
  let clock = Date.parse('2026-09-30T23:00:10.000Z');
  let calls = 0;
  const snapshot = () => {
    const barTime = Math.floor(clock / 60_000) * 60_000 - 60_000;
    return buildPositioningObservation({
      premiumNowBps: 1, volatilityExpansionRatio: 1.1,
      raw: {
        oi: [{ time: clock - 1000, oi: 1000 + calls }],
        taker: [{ time: clock - 1000, buySellRatio: 1.1, buyFraction: 0.52,
          notionalBuyFraction: 0.52, targetWindowMs: 60_000, coverageMs: 59_500, tradeCount: 100 }],
        funding: [{ time: clock - 60_000, rate: 0.00008 }],
      },
    }, [barTime, 100, 101, 99, 100 + calls / 100, 10, barTime + 59_999],
    { capturedAtMs: clock, openInterestUnit: 'CONTRACTS' });
  };
  return {
    sessionDir, out: path.join(root, 'summary.json'), snapshot,
    clock: () => clock, advance: ms => { clock += ms; }, calls: () => calls,
    options: {
      sessionDir, summaryOut: path.join(root, 'summary.json'),
      evidencePrefix: 'paper-tape/positioning-continuity-v1/test-fixtures',
      now: () => clock, wait: async ms => { clock += ms; },
      captureDivergence: async () => { throw new Error('optional source unavailable'); },
      capture: async () => {
        calls += 1;
        assert.ok(fs.existsSync(path.join(sessionDir, 'protocol.json')), 'protocol registered before observations');
        return snapshot();
      },
      ...change,
    },
  };
}
function json(dir, name) { return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); }
function rows(dir) {
  return fs.readFileSync(path.join(dir, 'positioning.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
}

test('bounded fixture session rebuilds real audits, preserves prior-only deltas and keeps the holdout sealed', async t => {
  const h = harness(t);
  const report = await runPositioningContinuity(h.options);
  const tape = rows(h.sessionDir);
  const study = json(h.sessionDir, 'study.json');
  const quality = json(h.sessionDir, 'quality.json');
  assert.equal(h.calls(), 24);
  assert.equal(report.independentRowCount, 24);
  assert.equal(report.acceptedRowCount, 24);
  assert.equal(report.cohortReadyForResearch, true);
  assert.equal(quality.defects.overlappingWindows, 0);
  assert.equal(tape[0].crossCapture.reason, 'NO_PRIOR_CAPTURE');
  for (let i = 1; i < tape.length; i++) {
    assert.equal(tape[i].crossCapture.priorCapturedAt, tape[i - 1].capturedAt);
    assert.equal(tape[i].crossCapture.available, true);
    assert.ok(Date.parse(tape[i].capturedAt) - Date.parse(tape[i-1].capturedAt) >= 65_000);
  }
  assert.equal(study.methodology.stressedCostBps, 12);
  assert.equal(study.partitions.holdoutOpened, false);
  assert.equal(study.partitions.holdoutMetricsComputed, false);
  assert.equal(study.capitalEligible, false);
  assert.equal(study.executionAuthority, false);
  assert.equal(report.liveOrders, false);
  assert.equal(report.changesRiskGates, false);
  assert.equal(report.stopReason, 'ATTEMPT_BUDGET_COMPLETE');
  assert.equal(report.attempts.every(a => !a.divergenceAvailable), true);
});

test('coverage failures consume the attempt budget and never count as observations', async t => {
  const h = harness(t);
  let calls = 0;
  h.options.capture = async () => {
    calls += 1;
    if (calls <= 5) throw new Error('Fixed-window taker flow unavailable: INSUFFICIENT_WINDOW_COVERAGE');
    return h.snapshot();
  };
  const r = await runPositioningContinuity(h.options);
  assert.equal(calls, 24);
  assert.equal(r.acceptedRowCount, 19);
  assert.equal(r.independentRowCount, 19);
  assert.equal(r.cohortReadyForResearch, false);
  assert.equal(r.researchVerdict, 'DATA_NOT_READY');
  assert.equal(r.attempts.filter(a => a.status === 'DATA_GAP').length, 5);
  assert.equal(r.survivors, 0);
});

test('unexpected capture failure stops new requests and preserves partial causal evidence', async t => {
  const h = harness(t);
  let calls = 0;
  h.options.capture = async () => {
    calls += 1;
    if (calls === 3) throw new Error('HTTP 500');
    return h.snapshot();
  };
  const r = await runPositioningContinuity(h.options);
  assert.equal(calls, 3);
  assert.equal(r.acceptedRowCount, 2);
  assert.equal(r.fatalFailure, true);
  assert.equal(r.stopReason, 'UNEXPECTED_CAPTURE_FAILURE');
  assert.equal(json(h.sessionDir, 'session.json').attemptCount, 3);
  assert.equal(json(h.sessionDir, 'quality.json').independentRowCount, 2);
});

test('a replayed closed bar cannot inflate the independent sample', async t => {
  const h = harness(t);
  const closeTime = h.snapshot().price.closeTime;
  h.options.capture = async () => {
    const row = h.snapshot(); row.price.closeTime = closeTime;
    return row;
  };
  const r = await runPositioningContinuity(h.options);
  assert.equal(r.acceptedRowCount, 1);
  assert.equal(r.cohortReadyForResearch, false);
  assert.ok(r.attempts.some(a => a.reason === 'DUPLICATE_CLOSED_BAR'));
  assert.equal(r.independentRowCount, 1);
});

test('a different capture timestamp cannot hide a replayed exchange taker window', async t => {
  const h = harness(t);
  let priorTaker;
  h.options.capture = async () => {
    const row = h.snapshot();
    if (priorTaker) row.provenance.sourceTimes.taker = priorTaker;
    priorTaker = row.provenance.sourceTimes.taker;
    return row;
  };
  const r = await runPositioningContinuity(h.options);
  assert.equal(r.acceptedRowCount, 1);
  assert.ok(r.attempts.some(a => a.reason === 'OVERLAPPING_OR_REPLAYED_TAKER_WINDOW'));
  assert.equal(r.cohortReadyForResearch, false);
});

test('missing price evidence is rejected rather than coerced into a zero return', async t => {
  const h = harness(t);
  h.options.capture = async () => { const row = h.snapshot(); row.price.close = null; return row; };
  const r = await runPositioningContinuity(h.options);
  assert.equal(r.acceptedRowCount, 0);
  assert.equal(r.independentRowCount, 0);
  assert.equal(r.researchVerdict, 'DATA_NOT_READY');
  assert.equal(r.attempts.every(a => a.reason === 'INCOMPLETE_OBSERVATION'), true);
});

test('future or stale optional divergence cannot enter the study', async t => {
  const h = harness(t);
  let calls = 0;
  h.options.captureDivergence = async () => ({
    schemaVersion: 1, mode: 'RESEARCH_ONLY', provider: 'okx_public_market_data', symbol: 'BTCUSDT',
    capturedAt: new Date(h.clock() + (++calls % 2 ? 1000 : -31_000)).toISOString(),
    provenance: { fixedWindow: true, rawSpotVsPerpSizeComparisonForbidden: true },
    spot: { coverageMs: 59_500 }, perpetual: { coverageMs: 59_500 },
    divergence: { perpMinusSpotNotionalBuyFraction: 0.2 },
  });
  const r = await runPositioningContinuity(h.options);
  assert.equal(r.acceptedRowCount, 24);
  assert.equal(r.attempts.every(a => !a.divergenceAvailable), true);
  assert.equal(fs.existsSync(path.join(h.sessionDir, 'spot-perp-divergence.jsonl')), false);
  const candidate = json(h.sessionDir, 'study.json').candidates
    .find(c => c.family === 'spot_perp_taker_divergence_continuation');
  assert.equal(candidate.train.trades, 0);
});

test('only prior fresh normalized divergence is admitted', async t => {
  const h = harness(t);
  h.options.captureDivergence = async () => ({
    schemaVersion: 1, mode: 'RESEARCH_ONLY', provider: 'okx_public_market_data', symbol: 'BTCUSDT',
    capturedAt: new Date(h.clock() - 1000).toISOString(),
    provenance: { fixedWindow: true, rawSpotVsPerpSizeComparisonForbidden: true },
    spot: { coverageMs: 59_500 }, perpetual: { coverageMs: 59_500 },
    divergence: { perpMinusSpotNotionalBuyFraction: 0.2 },
  });
  const r = await runPositioningContinuity(h.options);
  assert.equal(r.attempts.every(a => a.divergenceAvailable), true);
  assert.equal(json(h.sessionDir, 'study.json').candidates
    .find(c => c.family === 'spot_perp_taker_divergence_continuation').train.trades > 0, true);
});

test('elapsed capture work consumes the wall-clock budget; no unbounded retry loop', async t => {
  const h = harness(t);
  let calls = 0;
  h.options.capture = async () => {
    calls += 1; h.advance(10 * 60_000);
    return h.snapshot();
  };
  const r = await runPositioningContinuity(h.options);
  assert.ok(calls <= 3);
  assert.equal(r.stopReason, 'TIME_BUDGET_EXHAUSTED');
  assert.ok(r.attemptCount < CONTINUITY_PROTOCOL.targetAttempts);
  assert.equal(r.cohortReadyForResearch, false);
});

test('an existing session cannot be silently overwritten or reused as fresh research', async t => {
  const h = harness(t);
  await runPositioningContinuity(h.options);
  const original = fs.readFileSync(path.join(h.sessionDir, 'positioning.jsonl'), 'utf8');
  await assert.rejects(runPositioningContinuity(h.options), /SESSION_ALREADY_EXISTS/);
  assert.equal(fs.readFileSync(path.join(h.sessionDir, 'positioning.jsonl'), 'utf8'), original);
});
test('expired collection budget starts no HTTP request', async () => {
  let calls = 0;
  const request = budgetedFetch(1000, { now: () => 1000, fetchImpl: async () => { calls++; } });
  await assert.rejects(request('https://www.okx.com/api/v5/public/open-interest'), /TIME_BUDGET_EXHAUSTED/);
  assert.equal(calls, 0);
});

test('collection deadline and provider request timeout both constrain HTTP work', async () => {
  const external = new AbortController();
  let receivedSignal;
  const request = budgetedFetch(20, {
    now: () => 0,
    fetchImpl: async (_url, options) => { receivedSignal = options.signal; return { ok: true }; },
  });
  await request('https://www.okx.com/api/v5/market/trades', { signal: external.signal });
  assert.equal(receivedSignal.aborted, false);
  external.abort();
  assert.equal(receivedSignal.aborted, true);
  await request('https://www.okx.com/api/v5/market/trades');
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(receivedSignal.aborted, true);
});
test('real public capture adapters use the supplied bounded fetch instead of an unbounded network path', async () => {
  const { capturePositioning } = await import('../genesis/positioningDynamicsCapture.mjs');
  const { captureSpotPerpTakerDivergence } = await import('../genesis/spotPerpTakerDivergenceCapture.mjs');
  const now = Date.now();
  const barTime = Math.floor(now / 60_000) * 60_000 - 60_000;
  const requests = [];
  const providerFetch = async (url, options) => {
    requests.push({ url, signal: options.signal });
    let data;
    if (url.includes('funding-rate-history')) data = [{ fundingTime: now - 3_600_000, fundingRate: '0.0001' }];
    else if (url.includes('open-interest')) data = [{ ts: now - 1000, oi: '1000', oiUsd: '100000' }];
    else if (url.includes('/candles')) data = [[barTime, '100', '101', '99', '100', '1', '100', '100', '1']];
    else if (url.includes('/trades?')) data = [
      { ts: now - 1000, sz: '1', px: '100', side: 'buy', tradeId: '3' },
      { ts: now - 60_000, sz: '1', px: '100', side: 'sell', tradeId: '2' },
      { ts: now - 62_000, sz: '1', px: '100', side: 'sell', tradeId: '1' },
    ];
    else throw new Error('unexpected fixture endpoint');
    return { ok: true, json: async () => ({ code: '0', data }) };
  };
  const request = budgetedFetch(Date.now() + 30_000, { fetchImpl: providerFetch });
  const row = await capturePositioning({ fetchImpl: request });
  const divergence = await captureSpotPerpTakerDivergence({ fetchImpl: request });
  assert.equal(row.mode, 'RESEARCH_ONLY');
  assert.equal(row.positioning.takerWindowCoverageMs, 59_000);
  assert.equal(divergence.provenance.fixedWindow, true);
  assert.equal(requests.length, 8);
  assert.equal(requests.every(r => r.url.startsWith('https://www.okx.com/api/v5/')), true);
  assert.equal(requests.every(r => r.signal instanceof AbortSignal), true);
});
test('missing core positioning evidence cannot be admitted to a continuity cohort', async t => {
  const h = harness(t);
  let calls = 0;
  h.options.capture = async () => {
    const row = h.snapshot();
    const fields = ['takerBuySellRatioNow', 'fundingRateNow', 'premiumNowBps'];
    row.positioning[fields[calls++ % fields.length]] = null;
    return row;
  };
  const report = await runPositioningContinuity(h.options);
  assert.equal(report.acceptedRowCount, 0);
  assert.equal(report.independentRowCount, 0);
  assert.equal(report.cohortReadyForResearch, false);
  assert.equal(report.attempts.every(a => a.reason === 'INCOMPLETE_OBSERVATION'), true);
});
