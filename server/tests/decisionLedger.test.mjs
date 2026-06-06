import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import db from '../db/database.mjs';
import { saveDecision, resolveDecision, getRecentDecisions, getDecisionStats } from '../memory/decisionLedger.mjs';

// All test IDs are prefixed so cleanup is safe even on a live DB
const P = 'test-ledger-';

const BASE = {
  id:             `${P}001`,
  timestamp:      1_718_000_000_000,  // fixed — deterministic
  ticker:         'LEDGER-TEST-YES',
  agentName:      'market-analyst',
  signal:         'BUY',
  confidence:     0.75,
  reasoning:      ['high liquidity: $15,000', 'price in edge zone: 50%', 'ideal window: 10d', 'volume spike: $8,000/day'],
  marketPrice:    0.50,
  marketCategory: 'economics',
};

function cleanup() {
  db.prepare(`DELETE FROM agent_decisions WHERE id LIKE '${P}%'`).run();
}

// ─── saveDecision ─────────────────────────────────────────────────────────────

describe('saveDecision — basic write', () => {
  before(cleanup);
  after(cleanup);

  test('returns true on first insert', () => {
    assert.strictEqual(saveDecision(BASE), true);
  });

  test('row is readable after insert', () => {
    const row = db.prepare(`SELECT * FROM agent_decisions WHERE id = ?`).get(BASE.id);
    assert.ok(row, 'row must exist');
    assert.strictEqual(row.ticker,      BASE.ticker);
    assert.strictEqual(row.agent_name,  BASE.agentName);
    assert.strictEqual(row.signal,      BASE.signal);
    assert.strictEqual(row.confidence,  BASE.confidence);
    assert.strictEqual(row.timestamp,   BASE.timestamp);
    assert.strictEqual(row.market_price, BASE.marketPrice);
  });

  test('reasoning_json is stored as a valid JSON array', () => {
    const row = db.prepare(`SELECT reasoning_json FROM agent_decisions WHERE id = ?`).get(BASE.id);
    const parsed = JSON.parse(row.reasoning_json);
    assert.deepStrictEqual(parsed, BASE.reasoning);
  });

  test('outcome and resolved_at are NULL on insert', () => {
    const row = db.prepare(`SELECT outcome, resolved_at FROM agent_decisions WHERE id = ?`).get(BASE.id);
    assert.strictEqual(row.outcome,     null);
    assert.strictEqual(row.resolved_at, null);
  });
});

// ─── saveDecision — idempotency ───────────────────────────────────────────────

describe('saveDecision — idempotency (INSERT OR IGNORE)', () => {
  before(() => { cleanup(); saveDecision(BASE); });
  after(cleanup);

  test('returns false on duplicate ID', () => {
    assert.strictEqual(saveDecision(BASE), false);
  });

  test('duplicate does not create extra rows', () => {
    saveDecision(BASE);  // third attempt
    const row = db.prepare(`SELECT COUNT(*) AS cnt FROM agent_decisions WHERE id = ?`).get(BASE.id);
    assert.strictEqual(row.cnt, 1);
  });

  test('duplicate does not mutate existing row', () => {
    const mutated = { ...BASE, confidence: 0.99, marketPrice: 0.99 };
    saveDecision(mutated);  // same id, different values
    const row = db.prepare(`SELECT confidence, market_price FROM agent_decisions WHERE id = ?`).get(BASE.id);
    assert.strictEqual(row.confidence,   BASE.confidence,   'confidence must not change');
    assert.strictEqual(row.market_price, BASE.marketPrice,  'market_price must not change');
  });
});

// ─── saveDecision — nullable fields ──────────────────────────────────────────

describe('saveDecision — nullable fields', () => {
  before(cleanup);
  after(cleanup);

  test('null marketPrice stores as NULL', () => {
    saveDecision({ ...BASE, id: `${P}null-price`, marketPrice: null });
    const row = db.prepare(`SELECT market_price FROM agent_decisions WHERE id = ?`).get(`${P}null-price`);
    assert.strictEqual(row.market_price, null);
  });

  test('null marketCategory stores as NULL', () => {
    saveDecision({ ...BASE, id: `${P}null-cat`, marketCategory: null });
    const row = db.prepare(`SELECT market_category FROM agent_decisions WHERE id = ?`).get(`${P}null-cat`);
    assert.strictEqual(row.market_category, null);
  });

  test('undefined marketPrice stores as NULL', () => {
    const entry = { ...BASE, id: `${P}undef-price` };
    delete entry.marketPrice;
    saveDecision(entry);
    const row = db.prepare(`SELECT market_price FROM agent_decisions WHERE id = ?`).get(`${P}undef-price`);
    assert.strictEqual(row.market_price, null);
  });
});

// ─── saveDecision — crash safety ─────────────────────────────────────────────

describe('saveDecision — crash safety (never throws)', () => {
  before(cleanup);
  after(cleanup);

  test('does not throw when reasoning is an empty array', () => {
    assert.doesNotThrow(() => saveDecision({ ...BASE, id: `${P}empty-r`, reasoning: [] }));
    const row = db.prepare(`SELECT reasoning_json FROM agent_decisions WHERE id = ?`).get(`${P}empty-r`);
    assert.deepStrictEqual(JSON.parse(row.reasoning_json), []);
  });

  test('does not throw when reasoning is missing (stores as [])', () => {
    const entry = { ...BASE, id: `${P}no-r` };
    delete entry.reasoning;
    assert.doesNotThrow(() => saveDecision(entry));
    const row = db.prepare(`SELECT reasoning_json FROM agent_decisions WHERE id = ?`).get(`${P}no-r`);
    assert.deepStrictEqual(JSON.parse(row.reasoning_json), []);
  });

  test('stored reasoning_json is always parseable JSON', () => {
    const ids = [`${P}empty-r`, `${P}no-r`];
    for (const id of ids) {
      const row = db.prepare(`SELECT reasoning_json FROM agent_decisions WHERE id = ?`).get(id);
      assert.doesNotThrow(() => JSON.parse(row.reasoning_json), `reasoning_json must be valid JSON for ${id}`);
    }
  });
});

// ─── resolveDecision ─────────────────────────────────────────────────────────

describe('resolveDecision', () => {
  const ID = `${P}resolve-001`;

  before(() => { cleanup(); saveDecision({ ...BASE, id: ID }); });
  after(cleanup);

  test('returns true and sets outcome + resolved_at', () => {
    const before = Date.now();
    assert.strictEqual(resolveDecision(ID, 'WIN'), true);

    const row = db.prepare(`SELECT outcome, resolved_at FROM agent_decisions WHERE id = ?`).get(ID);
    assert.strictEqual(row.outcome, 'WIN');
    assert.ok(
      row.resolved_at >= before,
      `resolved_at ${row.resolved_at} must be >= call time ${before}`
    );
  });

  test('second resolve call returns false (outcome already set)', () => {
    assert.strictEqual(resolveDecision(ID, 'LOSS'), false);
  });

  test('outcome remains WIN after duplicate resolve attempt', () => {
    const row = db.prepare(`SELECT outcome FROM agent_decisions WHERE id = ?`).get(ID);
    assert.strictEqual(row.outcome, 'WIN');
  });

  test('resolving non-existent ID returns false', () => {
    assert.strictEqual(resolveDecision(`${P}does-not-exist`, 'WIN'), false);
  });

  test('LOSS outcome stores correctly', () => {
    const lossId = `${P}resolve-loss`;
    saveDecision({ ...BASE, id: lossId });
    resolveDecision(lossId, 'LOSS');
    const row = db.prepare(`SELECT outcome FROM agent_decisions WHERE id = ?`).get(lossId);
    assert.strictEqual(row.outcome, 'LOSS');
  });

  test('NEUTRAL outcome stores correctly', () => {
    const neutralId = `${P}resolve-neutral`;
    saveDecision({ ...BASE, id: neutralId });
    resolveDecision(neutralId, 'NEUTRAL');
    const row = db.prepare(`SELECT outcome FROM agent_decisions WHERE id = ?`).get(neutralId);
    assert.strictEqual(row.outcome, 'NEUTRAL');
  });
});

// ─── getRecentDecisions ───────────────────────────────────────────────────────

describe('getRecentDecisions', () => {
  before(() => {
    cleanup();
    // Three decisions with distinct timestamps — inserted out of order
    saveDecision({ ...BASE, id: `${P}r-a`, timestamp: 1_000 });
    saveDecision({ ...BASE, id: `${P}r-b`, timestamp: 3_000 });
    saveDecision({ ...BASE, id: `${P}r-c`, timestamp: 2_000 });
  });
  after(cleanup);

  test('returns an array', () => {
    assert.ok(Array.isArray(getRecentDecisions(50)));
  });

  test('returned rows include all 3 test entries', () => {
    const ids = new Set(getRecentDecisions(50).map(r => r.id));
    assert.ok(ids.has(`${P}r-a`), 'must include r-a');
    assert.ok(ids.has(`${P}r-b`), 'must include r-b');
    assert.ok(ids.has(`${P}r-c`), 'must include r-c');
  });

  test('test entries are ordered newest-first (timestamp DESC)', () => {
    const rows = getRecentDecisions(200).filter(r => r.id.startsWith(`${P}r-`));
    for (let i = 0; i < rows.length - 1; i++) {
      assert.ok(
        rows[i].timestamp >= rows[i + 1].timestamp,
        `Row ${i} ts ${rows[i].timestamp} should be >= ${rows[i + 1].timestamp}`
      );
    }
  });

  test('limit is respected — returns at most N rows total', () => {
    assert.ok(getRecentDecisions(2).length <= 2);
    assert.ok(getRecentDecisions(1).length <= 1);
  });

  test('default limit is 50 — returns at most 50 rows', () => {
    assert.ok(getRecentDecisions().length <= 50);
  });
});

// ─── getDecisionStats ─────────────────────────────────────────────────────────

describe('getDecisionStats', () => {
  const STATS_AGENT = 'stats-test-agent';

  before(() => {
    cleanup();
    const ts = Date.now();
    saveDecision({ ...BASE, id: `${P}s-1`, agentName: STATS_AGENT, signal: 'BUY',  timestamp: ts });
    saveDecision({ ...BASE, id: `${P}s-2`, agentName: STATS_AGENT, signal: 'BUY',  timestamp: ts + 1 });
    saveDecision({ ...BASE, id: `${P}s-3`, agentName: STATS_AGENT, signal: 'SELL', timestamp: ts + 2 });
    resolveDecision(`${P}s-1`, 'WIN');
    resolveDecision(`${P}s-2`, 'LOSS');
  });
  after(cleanup);

  test('returns an array', () => {
    assert.ok(Array.isArray(getDecisionStats()));
  });

  test('stats row for test agent BUY counts 2 total', () => {
    const stats = getDecisionStats();
    const buyRow = stats.find(r => r.agent_name === STATS_AGENT && r.signal === 'BUY');
    assert.ok(buyRow, 'must have a BUY stats row for the test agent');
    assert.strictEqual(buyRow.total,    2);
    assert.strictEqual(buyRow.wins,     1);
    assert.strictEqual(buyRow.losses,   1);
    assert.strictEqual(buyRow.pending,  0);
  });

  test('stats row for test agent SELL counts 1 pending', () => {
    const stats = getDecisionStats();
    const sellRow = stats.find(r => r.agent_name === STATS_AGENT && r.signal === 'SELL');
    assert.ok(sellRow, 'must have a SELL stats row for the test agent');
    assert.strictEqual(sellRow.total,   1);
    assert.strictEqual(sellRow.pending, 1);
    assert.strictEqual(sellRow.wins,    0);
  });
});
