import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { enrollmentBaseline, forwardGate, forwardMetrics, runResearchForwardShadow } from '../research/runResearchForwardShadow.mjs';

function row(minute, close) {
  return {
    schemaVersion: 4,
    mode: 'RESEARCH_ONLY',
    provider: 'okx_public_market_data',
    symbol: 'BTCUSDT',
    capturedAt: new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString(),
    price: { close },
    positioning: { fundingRateNow: 0.0001, takerWindowMs: 60000 },
    crossCapture: { available: true, perpReturnBps: 10, takerBuySellRatioDelta: 0.2, oiChangePct: 0.2 },
    provenance: { takerWindowMs: 60000 },
  };
}

function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function writeJsonl(file, rows) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, rows.map(x => JSON.stringify(x)).join('\n') + '\n'); }

test('enrollment baseline is always the latest durable observation', () => {
  assert.equal(enrollmentBaseline([row(5, 100), row(10, 101)]), row(10, 101).capturedAt);
});

test('forward metrics do not manufacture evidence from missing returns', () => {
  assert.equal(forwardMetrics([{ netBaseBps: null }]).trades, 0);
  assert.equal(forwardMetrics([]).expectancyBps, null);
});

test('forward gate requires 20 prospective trades plus statistical and stress evidence', () => {
  assert.equal(forwardGate({ trades: 19 }, { trades: 19 }).state, 'FORWARD_SAMPLE_BUILDING');
  const base = { trades: 20, expectancyBps: 8, profitFactor: 1.4, tStat: 1.2, maxDrawdownPct: 2 };
  const stress = { trades: 20, expectancyBps: 2, profitFactor: 1.05, tStat: 0.5, maxDrawdownPct: 3 };
  assert.equal(forwardGate(base, stress).pass, true);
  assert.equal(forwardGate(base, { ...stress, expectancyBps: -1 }).state, 'FORWARD_18BPS_STRESS_FAIL');
});

test('first enrollment performs zero historical backfill and only future rows can create/close PAPER signals', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'genesis-forward-'));
  const tape = path.join(root, 'paper-tape/positioning-dynamics.jsonl');
  const candidateId = 'POSITIONING:BTCUSDT:cohort:funding_price_disagreement';
  writeJson(path.join(root, 'quant-evidence/research-promotion-ledger.json'), {
    version: 'research_promotion_ledger_v1',
    forwardEligibleCandidates: {
      [candidateId]: {
        id: candidateId,
        laneKey: 'POSITIONING:BTCUSDT:cohort',
        laneType: 'POSITIONING',
        symbol: 'BTCUSDT',
        leaderSymbol: null,
        family: 'funding_price_disagreement',
        auditedAt: '2026-01-01T00:11:00.000Z',
        status: 'FORWARD_PAPER_ELIGIBLE',
        liveEligible: false,
        executionAuthority: false,
        capitalEligible: false,
      },
    },
  });
  writeJsonl(tape, [row(0, 100), row(5, 101)]);

  const first = runResearchForwardShadow({ root });
  assert.equal(first.newlyEnrolled, 1);
  assert.equal(first.processedRows, 0);
  assert.equal(first.candidates[0].forwardBase12Bps.trades, 0);
  assert.equal(first.candidates[0].pendingSignal, null);

  writeJsonl(tape, [row(0, 100), row(5, 101), row(10, 102)]);
  const second = runResearchForwardShadow({ root });
  assert.equal(second.processedRows, 1);
  assert.ok(second.candidates[0].pendingSignal);
  assert.equal(second.candidates[0].forwardBase12Bps.trades, 0);

  writeJsonl(tape, [row(0, 100), row(5, 101), row(10, 102), row(15, 101)]);
  const third = runResearchForwardShadow({ root });
  assert.equal(third.processedRows, 1);
  assert.equal(third.candidates[0].forwardBase12Bps.trades, 1);
  assert.ok(third.candidates[0].forwardBase12Bps.expectancyBps > 0);
  assert.equal(third.candidates[0].liveEligible, false);
  assert.equal(third.candidates[0].executionAuthority, false);
  assert.equal(third.candidates[0].capitalEligible, false);
});
