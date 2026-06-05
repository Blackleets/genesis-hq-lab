import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import db from '../db/database.mjs';
import { stepQualify } from '../trading/workflow.mjs';
import { checkVeto } from '../memory/mistakePrevention.mjs';
import { getDecisionContext } from '../memory/learningEngine.mjs';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_MARKET = {
  source:      'polymarket',
  id:          'test-pipeline-market-base',
  question:    'Will BTC exceed $100k by end of 2026?',
  category:    'crypto',
  yesPrice:    0.55,
  noPrice:     0.45,
  volume24h:   500,
  volumeTotal: 10000,
  daysToClose: 20,
  liquidity:   5000,
};

// Category unlikely to collide with any real mistake_patterns or lessons in the DB
const BASE_PROPOSAL = {
  marketId:       'test-pipeline-proposal-unit-001',
  marketSource:   'polymarket',
  marketQuestion: 'Test market (unit test)',
  marketCategory: 'unit-test-pipeline-cat',
  outcome:        'YES',
  yesPrice:       0.55,
  noPrice:        0.45,
  volumeTotal:    10000,
  daysToClose:    15,
  confidence:     0.65,
  entryPrice:     0.55,
  agentId:        'market-agent-1',
};

// ─── stepQualify — pure function ──────────────────────────────────────────────

test('stepQualify — market meeting all criteria passes', () => {
  assert.strictEqual(stepQualify([BASE_MARKET]).length, 1);
});

test('stepQualify — empty list returns empty list', () => {
  assert.deepStrictEqual(stepQualify([]), []);
});

test('stepQualify — volumeTotal below 5000 is rejected', () => {
  assert.strictEqual(stepQualify([{ ...BASE_MARKET, volumeTotal: 4999 }]).length, 0);
});

test('stepQualify — volume24h below 200 is rejected', () => {
  assert.strictEqual(stepQualify([{ ...BASE_MARKET, volume24h: 199 }]).length, 0);
});

test('stepQualify — yesPrice below 0.08 is rejected', () => {
  assert.strictEqual(stepQualify([{ ...BASE_MARKET, yesPrice: 0.07 }]).length, 0);
});

test('stepQualify — yesPrice above 0.92 is rejected', () => {
  assert.strictEqual(stepQualify([{ ...BASE_MARKET, yesPrice: 0.93 }]).length, 0);
});

test('stepQualify — daysToClose of 0 is rejected', () => {
  assert.strictEqual(stepQualify([{ ...BASE_MARKET, daysToClose: 0 }]).length, 0);
});

test('stepQualify — daysToClose above 45 is rejected', () => {
  assert.strictEqual(stepQualify([{ ...BASE_MARKET, daysToClose: 46 }]).length, 0);
});

test('stepQualify — boundary values pass (5000 vol, 200 daily, 0.08 price, 1 day)', () => {
  const m = { ...BASE_MARKET, volumeTotal: 5000, volume24h: 200, yesPrice: 0.08, daysToClose: 1 };
  assert.strictEqual(stepQualify([m]).length, 1);
});

test('stepQualify — boundary values pass (0.92 price, 45 days)', () => {
  const m = { ...BASE_MARKET, yesPrice: 0.92, daysToClose: 45 };
  assert.strictEqual(stepQualify([m]).length, 1);
});

test('stepQualify — returns only passing markets from a mixed list', () => {
  const markets = [
    BASE_MARKET,
    { ...BASE_MARKET, id: 'low-vol',    volumeTotal: 100 },
    { ...BASE_MARKET, id: 'high-price', yesPrice: 0.99 },
  ];
  const result = stepQualify(markets);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].id, BASE_MARKET.id);
});

// ─── checkVeto — hardcoded rule violations (no DB patterns required) ──────────

test('checkVeto — clean proposal has no hardcoded rule violations', () => {
  const result = checkVeto(BASE_PROPOSAL);
  const hardRuleVetoes = result.vetoes.filter(v =>
    v.type === 'rule_violation' &&
    (v.reason.includes('too high') || v.reason.includes('too low') ||
     v.reason.includes('exceeds 45-day') || v.reason.includes('Low liquidity'))
  );
  assert.strictEqual(hardRuleVetoes.length, 0,
    `unexpected rule violations: ${JSON.stringify(hardRuleVetoes)}`);
});

test('checkVeto — entry price above 0.92 adds info-severity veto', () => {
  const result = checkVeto({ ...BASE_PROPOSAL, yesPrice: 0.95, entryPrice: 0.95 });
  const v = result.vetoes.find(v => v.reason.includes('too high'));
  assert.ok(v, 'expected high-price veto');
  assert.strictEqual(v.severity, 'info');
});

test('checkVeto — entry price below 0.05 adds info-severity veto', () => {
  const result = checkVeto({ ...BASE_PROPOSAL, yesPrice: 0.03, entryPrice: 0.03 });
  const v = result.vetoes.find(v => v.reason.includes('too low'));
  assert.ok(v, 'expected low-price veto');
  assert.strictEqual(v.severity, 'info');
});

test('checkVeto — daysToClose above 45 adds warning-severity veto', () => {
  const result = checkVeto({ ...BASE_PROPOSAL, daysToClose: 60 });
  const v = result.vetoes.find(v => v.reason.includes('exceeds 45-day'));
  assert.ok(v, 'expected horizon veto');
  assert.strictEqual(v.severity, 'warning');
  assert.strictEqual(result.flagged, true);
});

test('checkVeto — volumeTotal below 5000 adds warning-severity veto', () => {
  const result = checkVeto({ ...BASE_PROPOSAL, volumeTotal: 2000 });
  const v = result.vetoes.find(v => v.reason.includes('Low liquidity'));
  assert.ok(v, 'expected liquidity veto');
  assert.strictEqual(v.severity, 'warning');
});

// ─── checkVeto — duplicate detection (DB integration) ────────────────────────

describe('checkVeto — duplicate open trade is hard-vetoed', () => {
  const TRADE_ID  = 'test-pipeline-dup-trade-001';
  const MARKET_ID = 'test-pipeline-dup-market-001';

  before(() => {
    db.prepare(`DELETE FROM trades WHERE id = ?`).run(TRADE_ID);
    db.prepare(`
      INSERT INTO trades
        (id, agent_id, market_id, market_source, market_question, market_category,
         outcome, entry_price, shares, capital_used, confidence, reason, evidence,
         status, opened_at)
      VALUES (?, 'market-agent-1', ?, 'polymarket', 'Test dup market', 'unit-test-pipeline-cat',
              'YES', 0.55, 1, 5, 0.65, 'test', '[]', 'open', datetime('now'))
    `).run(TRADE_ID, MARKET_ID);
  });

  after(() => {
    db.prepare(`DELETE FROM trades WHERE id = ?`).run(TRADE_ID);
    db.prepare(`DELETE FROM trades WHERE market_id = ? AND status = 'vetoed'`).run(MARKET_ID);
  });

  test('duplicate market triggers critical veto', () => {
    const result = checkVeto({ ...BASE_PROPOSAL, marketId: MARKET_ID });
    const v = result.vetoes.find(v => v.type === 'duplicate');
    assert.ok(v, 'expected duplicate veto');
    assert.strictEqual(v.severity, 'critical');
    assert.strictEqual(result.vetoed, true);
  });
});

// ─── checkVeto — pattern match + times_prevented_loss counter (DB integration)─

describe('checkVeto — pattern match increments times_prevented_loss', () => {
  const LESSON_ID  = 'test-pipeline-lesson-pattern-001';
  const PATTERN_ID = 'test-pipeline-mp-001';
  const HASH       = 'unit-test-pipeline-cat_0.5_0.7';
  const CONDITIONS = JSON.stringify({
    category:           'unit-test-pipeline-cat',
    min_price:          0.5,
    max_price:          0.7,
    signal_description: 'test signal',
  });

  before(() => {
    // Clean up any leftover state from aborted test runs before inserting
    db.prepare(`DELETE FROM mistake_patterns WHERE id = ?`).run(PATTERN_ID);
    db.prepare(`DELETE FROM lessons WHERE id = ?`).run(LESSON_ID);

    // Use agent_id = NULL to avoid FK dependency on agent_profiles being seeded
    db.prepare(`
      INSERT INTO lessons
        (id, agent_id, source_type, lesson_text, new_rule, category, severity, created_at)
      VALUES (?, NULL, 'trade_loss',
              'Avoid unit-test-pipeline-cat at 0.5-0.7',
              'Avoid mid-range unit-test-pipeline-cat',
              'unit-test-pipeline-cat', 'warning', datetime('now'))
    `).run(LESSON_ID);

    db.prepare(`
      INSERT INTO mistake_patterns
        (id, pattern_hash, pattern_desc, category, conditions, lesson_id, active, created_at)
      VALUES (?, ?, 'Test: unit-test-pipeline-cat at 0.5-0.7', 'unit-test-pipeline-cat', ?, ?, 1, datetime('now'))
    `).run(PATTERN_ID, HASH, CONDITIONS, LESSON_ID);
  });

  after(() => {
    db.prepare(`DELETE FROM mistake_patterns WHERE id = ?`).run(PATTERN_ID);
    db.prepare(`DELETE FROM lessons WHERE id = ?`).run(LESSON_ID);
    db.prepare(`DELETE FROM trades WHERE market_id = ? AND status = 'vetoed'`).run(BASE_PROPOSAL.marketId);
  });

  test('proposal in pattern category+price range is flagged', () => {
    // BASE_PROPOSAL: entryPrice=0.55 is within 0.5-0.7 range
    const result = checkVeto(BASE_PROPOSAL);
    const v = result.vetoes.find(v => v.type === 'mistake_pattern');
    assert.ok(v, 'expected mistake_pattern veto');
    assert.strictEqual(result.flagged, true);
  });

  test('pattern match increments times_prevented_loss on linked lesson', () => {
    const before = db.prepare(
      `SELECT times_prevented_loss FROM lessons WHERE id = ?`
    ).get(LESSON_ID);
    const initial = before?.times_prevented_loss ?? 0;

    checkVeto(BASE_PROPOSAL);

    const after = db.prepare(
      `SELECT times_prevented_loss FROM lessons WHERE id = ?`
    ).get(LESSON_ID);
    assert.strictEqual(after.times_prevented_loss, initial + 1);
  });

  test('proposal with price outside pattern range does not match', () => {
    // entryPrice=0.3 is outside 0.5-0.7 range
    const result = checkVeto({ ...BASE_PROPOSAL, yesPrice: 0.3, entryPrice: 0.3 });
    const v = result.vetoes.find(v => v.type === 'mistake_pattern');
    assert.ok(!v, 'price 0.3 is outside pattern range — should not match');
  });

  // ── Regression: marketCategory field must be used, not category ──────────────
  // Bug: checkVeto() was destructuring proposal.category which is always undefined
  // in normal pipeline flow. Proposals use marketCategory. Fixed by reading
  // proposal.marketCategory ?? proposal.category.
  test('REGRESSION: proposal using marketCategory (not category) still matches patterns', () => {
    // Verify proposal has marketCategory but NOT category — same shape the pipeline sends
    assert.ok('marketCategory' in BASE_PROPOSAL, 'fixture must have marketCategory');
    assert.ok(!('category' in BASE_PROPOSAL), 'fixture must NOT have category');

    const result = checkVeto(BASE_PROPOSAL);
    const v = result.vetoes.find(v => v.type === 'mistake_pattern');
    assert.ok(v, 'pattern must fire even when proposal only has marketCategory');
  });

  // ── Regression: last_triggered must be written with datetime('now') ───────────
  // Bug: datetime("now") (double-quotes) caused SQLite to interpret "now" as a
  // column name, so last_triggered was never written. Fixed to datetime('now').
  test('REGRESSION: last_triggered is set after pattern fires', () => {
    const before = db.prepare(
      `SELECT last_triggered FROM mistake_patterns WHERE id = ?`
    ).get(PATTERN_ID);

    checkVeto(BASE_PROPOSAL);

    const after = db.prepare(
      `SELECT last_triggered FROM mistake_patterns WHERE id = ?`
    ).get(PATTERN_ID);
    assert.ok(after.last_triggered !== null, 'last_triggered must be set after pattern fires');
    // Verify it looks like a datetime string (not the literal string "now" or NULL)
    assert.match(after.last_triggered, /^\d{4}-\d{2}-\d{2}/, 'last_triggered must be a valid date string');
  });
});

// ─── getDecisionContext — times_retrieved counter (DB integration) ────────────

describe('getDecisionContext — times_retrieved counter', () => {
  const LESSON_ID = 'test-pipeline-lesson-retrieved-001';
  const CATEGORY  = 'unit-test-context-retrieved-cat';

  before(() => {
    db.prepare(`DELETE FROM lessons WHERE id = ?`).run(LESSON_ID);
    db.prepare(`
      INSERT INTO lessons
        (id, agent_id, source_type, lesson_text, new_rule, category, severity, created_at)
      VALUES (?, NULL, 'trade_loss',
              'Test retrieved lesson text',
              'Test rule for context tests',
              ?, 'warning', datetime('now'))
    `).run(LESSON_ID, CATEGORY);
  });

  after(() => {
    db.prepare(`DELETE FROM lessons WHERE id = ?`).run(LESSON_ID);
  });

  test('returns expected data structure', () => {
    const ctx = getDecisionContext(CATEGORY, 0.4, 0.6);
    assert.ok(Array.isArray(ctx.lessons),  'ctx.lessons should be an array');
    assert.ok(Array.isArray(ctx.rules),    'ctx.rules should be an array');
    assert.ok(Array.isArray(ctx.patterns), 'ctx.patterns should be an array');
    const ourLesson = ctx.lessons.find(l => l.id === LESSON_ID);
    assert.ok(ourLesson, 'inserted lesson should appear in context results');
  });

  test('each call increments times_retrieved by 1', () => {
    const before = db.prepare(
      `SELECT times_retrieved FROM lessons WHERE id = ?`
    ).get(LESSON_ID);
    const initial = before?.times_retrieved ?? 0;

    getDecisionContext(CATEGORY, 0.4, 0.6);

    const after = db.prepare(
      `SELECT times_retrieved FROM lessons WHERE id = ?`
    ).get(LESSON_ID);
    assert.strictEqual(after.times_retrieved, initial + 1);
  });

  test('two consecutive calls increment times_retrieved by 2', () => {
    const before = db.prepare(
      `SELECT times_retrieved FROM lessons WHERE id = ?`
    ).get(LESSON_ID);
    const initial = before?.times_retrieved ?? 0;

    getDecisionContext(CATEGORY, 0.4, 0.6);
    getDecisionContext(CATEGORY, 0.4, 0.6);

    const after = db.prepare(
      `SELECT times_retrieved FROM lessons WHERE id = ?`
    ).get(LESSON_ID);
    assert.strictEqual(after.times_retrieved, initial + 2);
  });
});
