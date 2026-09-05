import assert from 'node:assert/strict';
import { buildFundingScorecard } from '../fundingScorecard.mjs';

const flat = buildFundingScorecard({
  paper: true,
  liveOff: true,
  go: false,
  realizedFundingUsdt: 0.87,
  feesUsdt: 6.25,
  mtmUsdt: 0,
  settledCount: 3,
  holds: [],
});
assert.equal(flat.go, false);
assert.equal(flat.liveOff, true);
assert.equal(flat.verdict, 'INSUFFICIENT_SAMPLE');
assert.equal(flat.productionReadiness.status, 'NOT_READY');
assert.ok(flat.paperPerformance.netAfterFeesUsdt < 0);

const covered = buildFundingScorecard({
  paper: true,
  liveOff: true,
  go: false,
  realizedFundingUsdt: 20,
  feesUsdt: 5,
  mtmUsdt: 1,
  settledCount: 12,
  holds: [{ instId: 'XAU-USDT-SWAP' }],
});
assert.equal(covered.edgeEvidence.feesCovered, true);
assert.equal(covered.verdict, 'PAPER_CANDIDATE_NOT_GO');
assert.equal(covered.go, false);
console.log('fundingScorecard.smoke ok');
