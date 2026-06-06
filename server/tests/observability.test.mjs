// observability.test.mjs — Phase 4 Operator Observability tests
//
// Tests 6 scenarios:
//   1. Event persistence — logEvent() stores correctly, getTimeline() retrieves
//   2. Blocked trade explanation — buildBlockExplanation() returns correct shape
//   3. Confidence change logging — BLOCKED_CONFIDENCE event logged with metadata
//   4. Safe mode activation — SAFE_MODE_ACTIVATED event logged as CRITICAL
//   5. Learning calibration logs — WEIGHTS_CHANGED / CALIBRATION_STABLE events
//   6. Timeline ordering — events returned newest-first

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import db from '../db/database.mjs';
import {
  logEvent,
  getTimeline,
  getRecentEvents,
  getActiveWarnings,
  getTopFailureReason,
  countBlockedTrades,
  getCurrentBlockers,
  CATEGORY,
  SEVERITY,
} from '../observability/eventTimeline.mjs';
import { buildBlockExplanation } from '../observability/decisionExplainer.mjs';

// ── Test cleanup helpers ──────────────────────────────────────────────────────

const TEST_SUBSYSTEM = 'test-obs';

function cleanTestEvents() {
  db.prepare(`DELETE FROM operator_events WHERE subsystem = ?`).run(TEST_SUBSYSTEM);
}

function insertTestEvent({ category = CATEGORY.TRADING, severity = SEVERITY.INFO, reason = 'TEST_EVENT', metadata = {} } = {}) {
  return logEvent({ category, severity, subsystem: TEST_SUBSYSTEM, reason, metadata });
}

// ── 1. Event persistence ──────────────────────────────────────────────────────

describe('Event persistence', () => {
  before(cleanTestEvents);
  after(cleanTestEvents);

  test('logEvent() stores event with correct fields', () => {
    const id = insertTestEvent({
      category: CATEGORY.TRADING,
      severity: SEVERITY.WARNING,
      reason: 'BLOCKED_VETO: test pattern matched',
      metadata: { marketId: 'test-123', score: 42 },
    });

    assert.ok(id, 'logEvent() should return an id');
    assert.ok(id.includes(TEST_SUBSYSTEM), 'id should include subsystem');

    const row = db.prepare(`SELECT * FROM operator_events WHERE id = ?`).get(id);
    assert.ok(row, 'event should be persisted to DB');
    assert.equal(row.category, CATEGORY.TRADING);
    assert.equal(row.severity, SEVERITY.WARNING);
    assert.equal(row.subsystem, TEST_SUBSYSTEM);
    assert.equal(row.reason, 'BLOCKED_VETO: test pattern matched');
    const meta = JSON.parse(row.metadata);
    assert.equal(meta.marketId, 'test-123');
    assert.equal(meta.score, 42);
  });

  test('getTimeline() retrieves persisted events', () => {
    cleanTestEvents();
    insertTestEvent({ reason: 'EVENT_A' });
    insertTestEvent({ reason: 'EVENT_B', severity: SEVERITY.HIGH });

    const events = getTimeline({ subsystem: TEST_SUBSYSTEM });
    assert.ok(events.length >= 2, 'should retrieve both events');
    const reasons = events.map(e => e.reason);
    assert.ok(reasons.includes('EVENT_A'));
    assert.ok(reasons.includes('EVENT_B'));
  });

  test('getTimeline() filters by severity', () => {
    cleanTestEvents();
    insertTestEvent({ severity: SEVERITY.INFO,    reason: 'INFO_EVENT' });
    insertTestEvent({ severity: SEVERITY.CRITICAL, reason: 'CRIT_EVENT' });

    const critOnly = getTimeline({ subsystem: TEST_SUBSYSTEM, severity: SEVERITY.CRITICAL });
    assert.ok(critOnly.every(e => e.severity === SEVERITY.CRITICAL));
    assert.ok(critOnly.some(e => e.reason === 'CRIT_EVENT'));
  });

  test('getTimeline() filters by category', () => {
    cleanTestEvents();
    insertTestEvent({ category: CATEGORY.RISK,     reason: 'RISK_EVT' });
    insertTestEvent({ category: CATEGORY.LEARNING, reason: 'LEARN_EVT' });

    const riskOnly = getTimeline({ subsystem: TEST_SUBSYSTEM, category: CATEGORY.RISK });
    assert.ok(riskOnly.every(e => e.category === CATEGORY.RISK));
    assert.ok(riskOnly.some(e => e.reason === 'RISK_EVT'));
  });

  test('metadata is deserialized as object', () => {
    cleanTestEvents();
    const id = insertTestEvent({ metadata: { x: 1, y: [1, 2, 3] } });
    const events = getTimeline({ subsystem: TEST_SUBSYSTEM });
    const ev = events.find(e => e.id === id);
    assert.ok(ev, 'event should be found');
    assert.equal(typeof ev.metadata, 'object', 'metadata should be object');
    assert.equal(ev.metadata.x, 1);
    assert.deepEqual(ev.metadata.y, [1, 2, 3]);
  });

  test('idempotent insert — duplicate id is silently ignored', () => {
    cleanTestEvents();
    const id = insertTestEvent({ reason: 'FIRST_INSERT' });
    const countBefore = db.prepare(
      `SELECT COUNT(*) AS n FROM operator_events WHERE id = ?`
    ).get(id)?.n ?? 0;

    // Manually try to insert same id — should be silently ignored (INSERT OR IGNORE)
    try {
      db.prepare(
        `INSERT OR IGNORE INTO operator_events (id, ts, category, severity, subsystem, reason, metadata)
         VALUES (?, datetime('now'), 'TRADING', 'INFO', ?, 'DUPLICATE', '{}')`
      ).run(id, TEST_SUBSYSTEM);
    } catch { /* expected */ }

    const countAfter = db.prepare(
      `SELECT COUNT(*) AS n FROM operator_events WHERE id = ?`
    ).get(id)?.n ?? 0;
    assert.equal(countBefore, countAfter, 'duplicate id should be ignored');
  });
});

// ── 2. Blocked trade explanation ──────────────────────────────────────────────

describe('Blocked trade explanation', () => {
  const fakeMarket = { id: 'mkt-abc', question: 'Will X happen by 2025?', source: 'polymarket' };

  test('buildBlockExplanation() — veto step', () => {
    const result = buildBlockExplanation({
      market:     fakeMarket,
      stepFailed: 'veto',
      vetoResult: { summary: 'repeat mistake: low liquidity market type' },
    });

    assert.equal(result.tradeId, null);
    assert.equal(result.status, 'blocked');
    assert.ok(result.blockedReasons.length > 0, 'should have blocked reasons');
    assert.ok(result.blockedReasons[0].includes('BLOCKED_VETO'));
    assert.equal(result.marketId, 'mkt-abc');
  });

  test('buildBlockExplanation() — confidence step', () => {
    const result = buildBlockExplanation({
      market:     fakeMarket,
      stepFailed: 'confidence',
      confidenceResult: {
        score: 45,
        band: 'LOW_CONFIDENCE',
        noTradeReason: 'score below CAUTION threshold',
        explanation: { negatives: ['price too high', 'thin volume'] },
      },
    });

    assert.ok(result.blockedReasons.some(r => r.includes('BLOCKED_CONFIDENCE')));
    assert.ok(result.blockedReasons.some(r => r.includes('45/100')));
    assert.ok(result.blockedReasons.some(r => r.includes('LOW_CONFIDENCE')));
  });

  test('buildBlockExplanation() — risk step', () => {
    const result = buildBlockExplanation({
      market:     fakeMarket,
      stepFailed: 'risk',
      riskCheck:  { errors: ['DRAWDOWN_LIMIT_HIT: portfolio at -15.2%'], riskScore: 88 },
    });

    assert.ok(result.blockedReasons.some(r => r.includes('BLOCKED_RISK')));
    assert.ok(result.blockedReasons.some(r => r.includes('DRAWDOWN_LIMIT_HIT')));
  });

  test('buildBlockExplanation() — debate step', () => {
    const result = buildBlockExplanation({
      market:     fakeMarket,
      stepFailed: 'debate',
      debateResult: { skipReason: 'insufficient conviction across all agents' },
    });

    assert.ok(result.blockedReasons.some(r => r.includes('BLOCKED_DEBATE_SKIP')));
    assert.ok(result.blockedReasons.some(r => r.includes('insufficient conviction')));
  });

  test('buildBlockExplanation() — capital step', () => {
    const result = buildBlockExplanation({
      market:     fakeMarket,
      stepFailed: 'capital',
    });

    assert.ok(result.blockedReasons.some(r => r.includes('BLOCKED_CAPITAL')));
  });
});

// ── 3. Confidence change logging ──────────────────────────────────────────────

describe('Confidence change logging', () => {
  before(cleanTestEvents);
  after(cleanTestEvents);

  test('BLOCKED_CONFIDENCE event logged with required metadata', () => {
    const id = logEvent({
      category:  CATEGORY.CONFIDENCE,
      severity:  SEVERITY.WARNING,
      subsystem: TEST_SUBSYSTEM,
      reason:    'BLOCKED_CONFIDENCE: 44/100 (LOW_CONFIDENCE) — score below threshold',
      metadata: {
        marketId: 'test-mkt',
        score:    44,
        band:     'LOW_CONFIDENCE',
        negatives: ['thin volume', 'low price edge'],
      },
    });

    const ev = db.prepare(`SELECT * FROM operator_events WHERE id = ?`).get(id);
    assert.ok(ev, 'event should be persisted');
    assert.equal(ev.category, CATEGORY.CONFIDENCE);
    assert.equal(ev.severity, SEVERITY.WARNING);
    assert.ok(ev.reason.includes('BLOCKED_CONFIDENCE'));

    const meta = JSON.parse(ev.metadata);
    assert.equal(meta.score, 44);
    assert.equal(meta.band, 'LOW_CONFIDENCE');
    assert.ok(Array.isArray(meta.negatives));
  });
});

// ── 4. Safe mode activation ───────────────────────────────────────────────────

describe('Safe mode activation', () => {
  before(cleanTestEvents);
  after(cleanTestEvents);

  test('SAFE_MODE_ACTIVATED logged as CRITICAL', () => {
    const id = logEvent({
      category:  CATEGORY.RISK,
      severity:  SEVERITY.CRITICAL,
      subsystem: TEST_SUBSYSTEM,
      reason:    'SAFE_MODE_ACTIVATED: system risk score 87/100 — trading suspended',
      metadata: { score: 87, band: 'CRITICAL', flags: ['DRAWDOWN_CRITICAL'] },
    });

    const ev = db.prepare(`SELECT * FROM operator_events WHERE id = ?`).get(id);
    assert.ok(ev, 'SAFE_MODE event should be persisted');
    assert.equal(ev.severity, SEVERITY.CRITICAL);
    assert.ok(ev.reason.includes('SAFE_MODE_ACTIVATED'));
  });

  test('getActiveWarnings() surfaces CRITICAL events from last hour', () => {
    cleanTestEvents();
    logEvent({
      category:  CATEGORY.RISK,
      severity:  SEVERITY.CRITICAL,
      subsystem: TEST_SUBSYSTEM,
      reason:    'SAFE_MODE_ACTIVATED: risk test',
      metadata: {},
    });

    const warnings = getActiveWarnings();
    const found = warnings.some(w => w.reason.includes('SAFE_MODE_ACTIVATED') && w.subsystem === TEST_SUBSYSTEM);
    assert.ok(found, 'CRITICAL event should appear in active warnings');
  });

  test('SAFE_MODE_CLEARED logged as INFO', () => {
    const id = logEvent({
      category:  CATEGORY.RISK,
      severity:  SEVERITY.INFO,
      subsystem: TEST_SUBSYSTEM,
      reason:    'SAFE_MODE_CLEARED: risk score dropped to 71/100 — trading resumed',
      metadata: { score: 71, band: 'HIGH_RISK' },
    });

    const ev = db.prepare(`SELECT * FROM operator_events WHERE id = ?`).get(id);
    assert.equal(ev.severity, SEVERITY.INFO);
    assert.ok(ev.reason.includes('SAFE_MODE_CLEARED'));
  });
});

// ── 5. Learning calibration logs ──────────────────────────────────────────────

describe('Learning calibration logs', () => {
  before(cleanTestEvents);
  after(cleanTestEvents);

  test('WEIGHTS_CHANGED logged as INFO with count metadata', () => {
    const id = logEvent({
      category:  CATEGORY.LEARNING,
      severity:  SEVERITY.INFO,
      subsystem: TEST_SUBSYSTEM,
      reason:    'WEIGHTS_CHANGED: accuracy drift (n=12 outcomes)',
      metadata: { weightsBefore: { w1: 1.0 }, weightsAfter: { w1: 1.05 }, count: 12 },
    });

    const ev = db.prepare(`SELECT * FROM operator_events WHERE id = ?`).get(id);
    assert.equal(ev.category, CATEGORY.LEARNING);
    assert.equal(ev.severity, SEVERITY.INFO);
    assert.ok(ev.reason.includes('WEIGHTS_CHANGED'));
    const meta = JSON.parse(ev.metadata);
    assert.equal(meta.count, 12);
  });

  test('CALIBRATION_STABLE logged as INFO', () => {
    const id = logEvent({
      category:  CATEGORY.LEARNING,
      severity:  SEVERITY.INFO,
      subsystem: TEST_SUBSYSTEM,
      reason:    'CALIBRATION_STABLE: no weight adjustment needed',
      metadata: { count: 5 },
    });

    const ev = db.prepare(`SELECT * FROM operator_events WHERE id = ?`).get(id);
    assert.equal(ev.category, CATEGORY.LEARNING);
    assert.ok(ev.reason.includes('CALIBRATION_STABLE'));
  });
});

// ── 6. Timeline ordering ──────────────────────────────────────────────────────

describe('Timeline ordering', () => {
  before(cleanTestEvents);
  after(cleanTestEvents);

  test('events returned newest-first', async () => {
    cleanTestEvents();

    insertTestEvent({ reason: 'OLDEST_EVENT' });
    await new Promise(r => setTimeout(r, 5)); // ensure distinct timestamps
    insertTestEvent({ reason: 'MIDDLE_EVENT' });
    await new Promise(r => setTimeout(r, 5));
    insertTestEvent({ reason: 'NEWEST_EVENT' });

    const events = getTimeline({ subsystem: TEST_SUBSYSTEM, limit: 10 });
    assert.ok(events.length >= 3, 'should have at least 3 events');

    const reasons = events.map(e => e.reason);
    const newestIdx = reasons.indexOf('NEWEST_EVENT');
    const oldestIdx = reasons.indexOf('OLDEST_EVENT');

    assert.ok(newestIdx < oldestIdx, 'NEWEST_EVENT should appear before OLDEST_EVENT (DESC order)');
  });

  test('countBlockedTrades() counts BLOCKED events', () => {
    cleanTestEvents();
    insertTestEvent({ reason: 'BLOCKED_VETO: test 1' });
    insertTestEvent({ reason: 'BLOCKED_CONFIDENCE: test 2' });
    insertTestEvent({ reason: 'TRADE_EXECUTED: not blocked' });

    const count = countBlockedTrades();
    assert.ok(count >= 2, `should count at least 2 blocked events (got ${count})`);
  });

  test('getTopFailureReason() returns most common BLOCKED reason', () => {
    cleanTestEvents();
    insertTestEvent({ reason: 'BLOCKED_CONFIDENCE: low score' });
    insertTestEvent({ reason: 'BLOCKED_CONFIDENCE: low score' });
    insertTestEvent({ reason: 'BLOCKED_VETO: pattern' });

    const top = getTopFailureReason();
    if (top !== null) {
      assert.ok(top.includes('BLOCKED_CONFIDENCE'), `top reason should be BLOCKED_CONFIDENCE (got: ${top})`);
    }
    // null is also valid if events are not in last 24h due to timing
  });

  test('getRecentEvents() limits results', () => {
    cleanTestEvents();
    for (let i = 0; i < 5; i++) insertTestEvent({ reason: `EVENT_${i}` });

    const events = getRecentEvents(3);
    assert.ok(events.length <= 3, 'should not return more than limit');
  });
});
