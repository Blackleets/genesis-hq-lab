import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateForwardEvidence,
  governHypothesisQueue,
} from '../genesis/edgeDiscoveryGovernor.mjs';

const boundary = {
  paperOnly: true,
  liveOrders: false,
  executionAuthority: false,
  capitalEligible: false,
};

function item(id, hypothesisKey) {
  return { id, hypothesisKey, role: id.includes('control') ? 'CONTROL' : 'MUTATION' };
}

function sources(overrides = {}) {
  return {
    edge: { ...boundary, verdict: 'PAPER_CANDIDATE_FOUND', tested: 100, paperCandidates: 3, researchPoolSize: 20 },
    rawHypotheses: {
      ...boundary,
      completedAt: '2026-09-12T10:00:00.000Z',
      queue: [
        item('a-control', 'family:a'),
        item('a-1', 'family:a'),
        item('a-2', 'family:a'),
        item('a-3', 'family:a'),
        item('a-4', 'family:a'),
        item('a-5', 'family:a'),
        item('b-control', 'family:b'),
        item('b-1', 'family:b'),
        item('c-control', 'family:c'),
      ],
    },
    adaptive: { ...boundary, verdict: 'NO_ADAPTIVE_EDGE_FOUND', promotableToAudit: 0 },
    audit: { ...boundary, verdict: 'NO_NEW_AUDIT_CANDIDATES', totalPassedRegistered: 0, exhaustedFamilies: [] },
    forward: { ...boundary, families: [] },
    deepLedger: { ...boundary, killed: {} },
    ...overrides,
  };
}

test('fast candidate vs failed deep retest is treated as contradiction, not proof', () => {
  const { report } = governHypothesisQueue(sources());
  assert.equal(report.discoveryStatus, 'SEARCHING_FOR_EDGE');
  assert.equal(report.fastResearch.proofStatus, 'HYPOTHESIS_ONLY');
  assert.equal(report.contradictions[0].type, 'SHORT_WINDOW_VS_DEEP_RETEST');
  assert.equal(report.forward.provenCount, 0);
});

test('deep rejected, forward-enrolled and exhausted families are removed from next learning queue', () => {
  const input = sources({
    deepLedger: { ...boundary, killed: { 'family:a': { reason: 'deep reject' } } },
    forward: { ...boundary, families: [{ familyKey: 'family:b', championForward: { trades: 0 } }] },
    audit: { ...boundary, totalPassedRegistered: 0, exhaustedFamilies: ['family:c'] },
  });
  const { governedHypotheses, report } = governHypothesisQueue(input);
  assert.equal(governedHypotheses.queueSize, 0);
  assert.equal(report.hypothesisGovernance.suppressedCount, 9);
  assert.ok(report.hypothesisGovernance.suppressed.some((x) => x.reason === 'DEEP_REJECTED'));
  assert.ok(report.hypothesisGovernance.suppressed.some((x) => x.reason === 'FORWARD_ALREADY_ENROLLED'));
  assert.ok(report.hypothesisGovernance.suppressed.some((x) => x.reason === 'AUDIT_BUDGET_EXHAUSTED'));
});

test('queue is diversity-governed and capped per hypothesis', () => {
  const { governedHypotheses } = governHypothesisQueue(sources());
  const a = governedHypotheses.queue.filter((x) => x.hypothesisKey === 'family:a');
  assert.equal(a.length, 5);
  assert.equal(governedHypotheses.methodology.diversityRoundRobin, true);
  assert.ok(governedHypotheses.queue.length <= 24);
  assert.equal(governedHypotheses.executionAuthority, false);
  assert.equal(governedHypotheses.liveOrders, false);
});

test('deep control rejection vetoes that family even before durable ledger catches up', () => {
  const adaptive = {
    ...boundary,
    verdict: 'NO_ADAPTIVE_EDGE_FOUND',
    control: {
      hypothesisKey: 'family:a',
      researchStatus: 'REJECT',
      train: { expectancyBps: -4 },
      walkForward: { pass: false },
    },
  };
  const { governedHypotheses, report } = governHypothesisQueue(sources({ adaptive }));
  assert.equal(report.deepResearch.currentDeepRejectedFamily, 'family:a');
  assert.equal(governedHypotheses.queue.some((x) => x.hypothesisKey === 'family:a'), false);
});

test('forward edge is only proven after all net economic gates pass', () => {
  const evidence = evaluateForwardEvidence({
    families: [{
      familyKey: 'opening_range_breakout:BNBUSDT:4h:ASIA',
      championId: 'candidate-1',
      championForward: {
        trades: 25,
        expectancyBps: 18,
        profitFactor: 1.31,
        tStat: 1.25,
        maxDrawdownPct: 7,
      },
    }],
  });
  assert.equal(evidence[0].proven, true);
  assert.equal(evidence[0].status, 'EDGE_PROVEN_FORWARD');
  assert.equal(evidence[0].liveEligible, false);
});

test('forward evidence remains building below sample gate even if early metrics look excellent', () => {
  const evidence = evaluateForwardEvidence({
    families: [{
      familyKey: 'family:x',
      championForward: {
        trades: 7,
        expectancyBps: 100,
        profitFactor: 3,
        tStat: 2,
        maxDrawdownPct: 1,
      },
    }],
  });
  assert.equal(evidence[0].proven, false);
  assert.equal(evidence[0].status, 'FORWARD_SAMPLE_BUILDING');
});

test('unsafe source boundary fails closed', () => {
  assert.throws(() => governHypothesisQueue(sources({
    edge: { ...boundary, liveOrders: true },
  })), /edge_discovery_boundary_failed:edge/);
});
