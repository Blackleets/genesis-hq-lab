import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeMevShadowRows } from '../genesis/mevShadowLedger.mjs';

test('shadow ledger summary never presents opportunity PnL as realized balance', () => {
  const summary = summarizeMevShadowRows([
    { verdict: 'SHADOW_CANDIDATE', netPnlUsd: 5, expectedNetPnlUsd: 4, stressNetPnlUsd: 2, netEdgeBps: 12 },
    { verdict: 'NO_GO', netPnlUsd: -3, expectedNetPnlUsd: -2, stressNetPnlUsd: -5, netEdgeBps: -7 },
    { verdict: 'SHADOW_CANDIDATE', netPnlUsd: 7, expectedNetPnlUsd: 6, stressNetPnlUsd: 3, netEdgeBps: 18 },
  ]);

  assert.equal(summary.evaluated, 3);
  assert.equal(summary.candidates, 2);
  assert.equal(summary.noGo, 1);
  assert.equal(summary.theoreticalCandidateNetPnlUsd, 12);
  assert.equal(summary.theoreticalExpectedNetPnlUsd, 10);
  assert.equal(summary.theoreticalStressNetPnlUsd, 5);
  assert.equal(summary.medianCandidateNetEdgeBps, 15);
  assert.match(summary.note, /not realized/i);
  assert.equal(summary.executionAuthority, false);
});
