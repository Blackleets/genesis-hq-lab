import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNotionalLadder, scanSolanaEdgeMatrix, summarizeMatrixResult } from '../genesis/solanaEdgeMatrix.mjs';

function result({ notional, quotedProfit, netPnl, blockers = ['net_not_positive', 'atomic_simulation_missing', 'capture_evidence_missing'] }) {
  return { ok: true, status: 'BLOCKED', observation: {
    inputUsdc: notional, quoteLatencyMs: 10, slotDrift: 0, blockers,
    economics: {
      quotedRoundTripProfitUsd: quotedProfit, quotedRoundTripEdgeBps: (quotedProfit / notional) * 10_000,
      netPnlUsd: netPnl, netEdgeBps: (netPnl / notional) * 10_000,
      priorityFeeUsd: 0.01, priceImpactBps: 0.1,
    },
  } };
}

test('normalizes a bounded unique notional ladder', () => {
  assert.deepEqual(parseNotionalLadder('100,25,25,0,bad,50000,10'), [10, 25, 100]);
});

test('reports the actual break-even quote edge without weakening cost gates', () => {
  const row = summarizeMatrixResult(result({ notional: 25, quotedProfit: 0.01, netPnl: -0.09 }), 25);
  assert.ok(Math.abs(row.estimatedCostUsd - 0.1) < 1e-12);
  assert.ok(Math.abs(row.breakEvenQuotedEdgeBps - 40) < 1e-12);
  assert.deepEqual(row.preSimulationBlockers, ['net_not_positive']);
});

test('scans every notional, ranks net economics, and remains SHADOW/LIVE_LOCKED', async () => {
  const seen = [];
  const matrix = await scanSolanaEdgeMatrix({
    config: { notionalsUsdc: [10, 100, 250], base: {}, policy: { infraTier: 'FREE_ONLY' } },
    observer: async ({ config }) => {
      seen.push(config.notionalUsdc);
      if (config.notionalUsdc === 100) return result({ notional: 100, quotedProfit: 0.2, netPnl: 0.05, blockers: ['atomic_simulation_missing', 'capture_evidence_missing'] });
      return result({ notional: config.notionalUsdc, quotedProfit: 0.01, netPnl: -0.1 });
    },
  });
  assert.deepEqual(seen, [10, 100, 250]);
  assert.equal(matrix.executionAuthority, false);
  assert.equal(matrix.liveLocked, true);
  assert.equal(matrix.verdict, 'ECONOMIC_CANDIDATE');
  assert.equal(matrix.best.notionalUsdc, 100);
  assert.deepEqual(matrix.funnel, { scanned: 3, quoteSucceeded: 3, quotedPositive: 3, netPositive: 1, economicallyQualified: 1, simulated: 0, paperCaptured: 0 });
});

test('does not claim no edge when every provider request failed', async () => {
  const matrix = await scanSolanaEdgeMatrix({
    config: { notionalsUsdc: [10, 25], base: {}, policy: { infraTier: 'FREE_ONLY' } },
    observer: async () => ({ ok: false, status: 'BLOCKED', error: 'timeout' }),
  });
  assert.equal(matrix.verdict, 'DATA_UNAVAILABLE');
  assert.equal(matrix.funnel.quoteSucceeded, 0);
});
