import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import db from '../db/database.mjs';
import { saveDecision, resolveDecision } from '../memory/decisionLedger.mjs';
import {
  signalResult,
  OUTCOME_MAP,
  processMarketResolution,
  refreshAgentPerformance,
  getAgentPerformance,
} from '../memory/decisionAccuracyEngine.mjs';

// ── Test namespace — all IDs/tickers prefixed so cleanup is safe ──────────────

const P       = 'test-accuracy-';
const TICKER  = `${P}TICKER-YES`;
const AGENT   = `${P}agent`;

const BASE = {
  id:             `${P}d-001`,
  timestamp:      1_718_000_000_000,
  ticker:         TICKER,
  agentName:      AGENT,
  signal:         'BUY',
  confidence:     0.75,
  reasoning:      ['high liquidity: $15,000', 'price in edge zone: 50%'],
  marketPrice:    0.50,
  marketCategory: 'test',
};

function cleanDecisions() {
  db.prepare(`DELETE FROM agent_decisions WHERE id   LIKE '${P}%'`).run();
}
function cleanPerformance() {
  db.prepare(`DELETE FROM agent_performance WHERE agent_name LIKE '${P}%'`).run();
}
function cleanup() { cleanDecisions(); cleanPerformance(); }

// ─── signalResult — mapping table ────────────────────────────────────────────

describe('signalResult — deterministic mapping', () => {
  test('BUY + YES = WIN', () => assert.strictEqual(signalResult('BUY',  'YES'), 'WIN'));
  test('BUY + NO  = LOSS', () => assert.strictEqual(signalResult('BUY',  'NO'),  'LOSS'));
  test('SELL + YES = LOSS', () => assert.strictEqual(signalResult('SELL', 'YES'), 'LOSS'));
  test('SELL + NO  = WIN', () => assert.strictEqual(signalResult('SELL', 'NO'),  'WIN'));

  test('case-insensitive input — buy/yes → WIN', () =>
    assert.strictEqual(signalResult('buy', 'yes'), 'WIN'));

  test('case-insensitive input — SELL/no → WIN', () =>
    assert.strictEqual(signalResult('SELL', 'no'), 'WIN'));

  test('unknown signal returns NEUTRAL', () =>
    assert.strictEqual(signalResult('HOLD', 'YES'), 'NEUTRAL'));

  test('null outcome returns NEUTRAL', () =>
    assert.strictEqual(signalResult('BUY', null), 'NEUTRAL'));

  test('null signal returns NEUTRAL', () =>
    assert.strictEqual(signalResult(null, 'YES'), 'NEUTRAL'));

  test('OUTCOME_MAP covers all 4 valid combinations', () => {
    assert.strictEqual(Object.keys(OUTCOME_MAP).length, 4);
    for (const key of ['BUY:YES', 'BUY:NO', 'SELL:YES', 'SELL:NO']) {
      assert.ok(key in OUTCOME_MAP, `OUTCOME_MAP must contain key: ${key}`);
    }
  });
});

// ─── processMarketResolution — resolution logic ───────────────────────────────

describe('processMarketResolution — BUY+YES → WIN', () => {
  before(() => { cleanup(); saveDecision({ ...BASE, id: `${P}buy-yes` }); });
  after(cleanup);

  test('returns processed=1 and affected agent', () => {
    const result = processMarketResolution(TICKER, 'YES');
    assert.strictEqual(result.processed, 1);
    assert.ok(result.agents.includes(AGENT));
  });

  test('decision outcome is set to WIN', () => {
    const row = db.prepare(`SELECT outcome FROM agent_decisions WHERE id = ?`).get(`${P}buy-yes`);
    assert.strictEqual(row.outcome, 'WIN');
  });
});

describe('processMarketResolution — BUY+NO → LOSS', () => {
  before(() => { cleanup(); saveDecision({ ...BASE, id: `${P}buy-no` }); });
  after(cleanup);

  test('decision outcome is set to LOSS', () => {
    processMarketResolution(TICKER, 'NO');
    const row = db.prepare(`SELECT outcome FROM agent_decisions WHERE id = ?`).get(`${P}buy-no`);
    assert.strictEqual(row.outcome, 'LOSS');
  });
});

describe('processMarketResolution — SELL+YES → LOSS', () => {
  before(() => {
    cleanup();
    saveDecision({ ...BASE, id: `${P}sell-yes`, signal: 'SELL' });
  });
  after(cleanup);

  test('decision outcome is set to LOSS', () => {
    processMarketResolution(TICKER, 'YES');
    const row = db.prepare(`SELECT outcome FROM agent_decisions WHERE id = ?`).get(`${P}sell-yes`);
    assert.strictEqual(row.outcome, 'LOSS');
  });
});

describe('processMarketResolution — SELL+NO → WIN', () => {
  before(() => {
    cleanup();
    saveDecision({ ...BASE, id: `${P}sell-no`, signal: 'SELL' });
  });
  after(cleanup);

  test('decision outcome is set to WIN', () => {
    processMarketResolution(TICKER, 'NO');
    const row = db.prepare(`SELECT outcome FROM agent_decisions WHERE id = ?`).get(`${P}sell-no`);
    assert.strictEqual(row.outcome, 'WIN');
  });
});

// ─── processMarketResolution — edge cases ────────────────────────────────────

describe('processMarketResolution — edge cases', () => {
  before(cleanup);
  after(cleanup);

  test('returns processed=0 when no decisions exist for ticker', () => {
    const result = processMarketResolution(`${P}UNKNOWN-TICKER`, 'YES');
    assert.strictEqual(result.processed, 0);
    assert.deepStrictEqual(result.agents, []);
  });

  test('unknown outcome returns processed=0 without throwing', () => {
    saveDecision({ ...BASE, id: `${P}unknown-out` });
    assert.doesNotThrow(() => {
      const result = processMarketResolution(TICKER, 'MAYBE');
      assert.strictEqual(result.processed, 0);
    });
  });

  test('null outcome returns processed=0 without throwing', () => {
    assert.doesNotThrow(() => {
      const result = processMarketResolution(TICKER, null);
      assert.strictEqual(result.processed, 0);
    });
  });

  test('already-resolved decisions are not re-processed', () => {
    cleanup();   // isolate from prior tests in this block that left unresolved rows
    const id = `${P}already-resolved`;
    saveDecision({ ...BASE, id });
    resolveDecision(id, 'WIN');              // manually resolve first

    const result = processMarketResolution(TICKER, 'YES');
    assert.strictEqual(result.processed, 0,
      'already-resolved decisions must be skipped (outcome IS NULL guard)');
  });

  test('multiple decisions for the same ticker are all resolved', () => {
    cleanup();
    saveDecision({ ...BASE, id: `${P}multi-1`, signal: 'BUY'  });
    saveDecision({ ...BASE, id: `${P}multi-2`, signal: 'SELL' });
    saveDecision({ ...BASE, id: `${P}multi-3`, signal: 'BUY'  });

    const result = processMarketResolution(TICKER, 'YES');
    assert.strictEqual(result.processed, 3);

    const rows = db.prepare(
      `SELECT outcome FROM agent_decisions WHERE id IN ('${P}multi-1','${P}multi-2','${P}multi-3')`
    ).all();
    const outcomes = rows.map(r => r.outcome).sort();
    assert.deepStrictEqual(outcomes, ['LOSS', 'WIN', 'WIN']);  // SELL+YES=LOSS, BUY+YES×2=WIN
  });
});

// ─── refreshAgentPerformance — metric calculation ────────────────────────────

describe('refreshAgentPerformance — accuracy_score', () => {
  before(() => {
    cleanup();
    // Insert 4 decisions, resolve 3 manually:
    //   WIN  @ 0.80   correct=1
    //   WIN  @ 0.70   correct=2
    //   LOSS @ 0.60   correct=2
    //   (1 unresolved — not counted)
    const ts = Date.now();
    saveDecision({ ...BASE, id: `${P}perf-1`, confidence: 0.80, timestamp: ts     });
    saveDecision({ ...BASE, id: `${P}perf-2`, confidence: 0.70, timestamp: ts + 1 });
    saveDecision({ ...BASE, id: `${P}perf-3`, confidence: 0.60, timestamp: ts + 2 });
    saveDecision({ ...BASE, id: `${P}perf-4`, confidence: 0.55, timestamp: ts + 3 });  // unresolved

    resolveDecision(`${P}perf-1`, 'WIN');
    resolveDecision(`${P}perf-2`, 'WIN');
    resolveDecision(`${P}perf-3`, 'LOSS');
    // perf-4 intentionally left unresolved
  });
  after(cleanup);

  test('creates agent_performance row', () => {
    refreshAgentPerformance(AGENT);
    const row = db.prepare(`SELECT * FROM agent_performance WHERE agent_name = ?`).get(AGENT);
    assert.ok(row, 'agent_performance row must exist after refresh');
  });

  test('total_predictions = 3 (only resolved WIN/LOSS rows counted)', () => {
    const row = db.prepare(`SELECT total_predictions FROM agent_performance WHERE agent_name = ?`).get(AGENT);
    assert.strictEqual(row.total_predictions, 3);
  });

  test('correct_predictions = 2', () => {
    const row = db.prepare(`SELECT correct_predictions FROM agent_performance WHERE agent_name = ?`).get(AGENT);
    assert.strictEqual(row.correct_predictions, 2);
  });

  test('accuracy_score = 0.6667 (2/3, rounded to 4 dp)', () => {
    const row = db.prepare(`SELECT accuracy_score FROM agent_performance WHERE agent_name = ?`).get(AGENT);
    // 2/3 = 0.666... rounded to 4 dp = 0.6667
    assert.ok(
      Math.abs(row.accuracy_score - (2/3)) < 0.001,
      `accuracy_score ${row.accuracy_score} should be ~0.6667`
    );
  });

  test('avg_confidence = mean of 0.80, 0.70, 0.60 = 0.7', () => {
    const row = db.prepare(`SELECT avg_confidence FROM agent_performance WHERE agent_name = ?`).get(AGENT);
    assert.ok(
      Math.abs(row.avg_confidence - 0.70) < 0.001,
      `avg_confidence ${row.avg_confidence} should be ~0.70`
    );
  });

  test('brier_score is between 0.0 and 1.0', () => {
    const row = db.prepare(`SELECT brier_score FROM agent_performance WHERE agent_name = ?`).get(AGENT);
    assert.ok(row.brier_score >= 0.0 && row.brier_score <= 1.0,
      `brier_score ${row.brier_score} must be in [0, 1]`);
  });

  test('brier_score is correct for WIN@0.80, WIN@0.70, LOSS@0.60', () => {
    // WIN:  (confidence − 1)²
    // LOSS: (confidence − 0)²
    const expected = (
      (0.80 - 1.0) ** 2 +   // WIN  → 0.04
      (0.70 - 1.0) ** 2 +   // WIN  → 0.09
      (0.60 - 0.0) ** 2     // LOSS → 0.36
    ) / 3;                  // → 0.49/3 = 0.1633...

    const row = db.prepare(`SELECT brier_score FROM agent_performance WHERE agent_name = ?`).get(AGENT);
    assert.ok(
      Math.abs(row.brier_score - expected) < 0.001,
      `brier_score ${row.brier_score} should be ~${expected.toFixed(4)}`
    );
  });

  test('updated_at is a recent timestamp (Unix ms)', () => {
    const before = Date.now();
    refreshAgentPerformance(AGENT);
    const row = db.prepare(`SELECT updated_at FROM agent_performance WHERE agent_name = ?`).get(AGENT);
    assert.ok(row.updated_at >= before - 1000, 'updated_at must be recent');
    assert.ok(row.updated_at <= Date.now() + 1000);
  });
});

// ─── refreshAgentPerformance — idempotency ────────────────────────────────────

describe('refreshAgentPerformance — idempotency', () => {
  before(() => {
    cleanup();
    saveDecision({ ...BASE, id: `${P}idem-1`, confidence: 0.80 });
    resolveDecision(`${P}idem-1`, 'WIN');
  });
  after(cleanup);

  test('calling twice produces the same accuracy_score', () => {
    refreshAgentPerformance(AGENT);
    const first = db.prepare(`SELECT accuracy_score FROM agent_performance WHERE agent_name = ?`).get(AGENT);
    refreshAgentPerformance(AGENT);
    const second = db.prepare(`SELECT accuracy_score FROM agent_performance WHERE agent_name = ?`).get(AGENT);
    assert.strictEqual(first.accuracy_score, second.accuracy_score);
  });

  test('no-op when agent has zero resolved decisions', () => {
    const rowBefore = db.prepare(`SELECT * FROM agent_performance WHERE agent_name = ?`).get(`${P}nonexistent`);
    refreshAgentPerformance(`${P}nonexistent`);
    const rowAfter  = db.prepare(`SELECT * FROM agent_performance WHERE agent_name = ?`).get(`${P}nonexistent`);
    // If no row existed before, none should exist after (no phantom rows)
    if (!rowBefore) assert.strictEqual(rowAfter, undefined);
  });
});

// ─── processMarketResolution → refreshAgentPerformance (integration) ──────────

describe('processMarketResolution — auto-refreshes performance after resolution', () => {
  before(() => {
    cleanup();
    saveDecision({ ...BASE, id: `${P}auto-1`, confidence: 0.90, signal: 'BUY' });
    saveDecision({ ...BASE, id: `${P}auto-2`, confidence: 0.65, signal: 'BUY' });
  });
  after(cleanup);

  test('agent_performance is created/updated after processMarketResolution', () => {
    // Before: no performance row
    const before = db.prepare(
      `SELECT * FROM agent_performance WHERE agent_name = ?`
    ).get(AGENT);
    // May or may not exist from prior test runs on same agent name — just verify update
    const prevTotal = before?.total_predictions ?? 0;

    processMarketResolution(TICKER, 'YES');   // BUY + YES = WIN × 2

    const after = db.prepare(
      `SELECT * FROM agent_performance WHERE agent_name = ?`
    ).get(AGENT);
    assert.ok(after, 'agent_performance row must exist after resolution');
    assert.ok(
      after.total_predictions >= prevTotal + 2,
      `total_predictions should grow by 2 after processing 2 decisions`
    );
    assert.strictEqual(after.accuracy_score, 1.0,  // 2 WIN, 0 LOSS → 100%
      'two correct BUY+YES predictions should give accuracy=1.0');
  });
});

// ─── getAgentPerformance ──────────────────────────────────────────────────────

describe('getAgentPerformance', () => {
  before(() => {
    cleanPerformance();
    // Insert two agents with different accuracy scores
    const ts = Date.now();
    db.prepare(`
      INSERT OR REPLACE INTO agent_performance
        (agent_name, total_predictions, correct_predictions, accuracy_score,
         avg_confidence, brier_score, updated_at)
      VALUES
        ('${P}agent-a', 10, 8, 0.80, 0.75, 0.15, ${ts}),
        ('${P}agent-b', 10, 5, 0.50, 0.60, 0.25, ${ts})
    `).run();
  });
  after(cleanPerformance);

  test('returns an array', () => {
    assert.ok(Array.isArray(getAgentPerformance()));
  });

  test('results include both test agents', () => {
    const names = new Set(getAgentPerformance().map(r => r.agent_name));
    assert.ok(names.has(`${P}agent-a`));
    assert.ok(names.has(`${P}agent-b`));
  });

  test('results are sorted by accuracy_score DESC', () => {
    const rows = getAgentPerformance().filter(r => r.agent_name.startsWith(P));
    assert.ok(rows.length >= 2);
    for (let i = 0; i < rows.length - 1; i++) {
      assert.ok(
        rows[i].accuracy_score >= rows[i + 1].accuracy_score,
        `Row ${i} accuracy ${rows[i].accuracy_score} should be >= ${rows[i + 1].accuracy_score}`
      );
    }
  });
});
