import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const {
  classifyEvent, narrate, deterministicSummary, getCommentary,
} = await import('../ai/commentaryEngine.mjs');

// ── classifyEvent ─────────────────────────────────────────────────────────────

describe('classifyEvent', () => {
  it('classifies a trade open', () => {
    assert.equal(classifyEvent({ reason: 'LONG OPENED · BTC', metadata: { type: 'open' } }), 'TRADE_OPENED');
  });
  it('classifies take_profit close as TP_HIT', () => {
    assert.equal(classifyEvent({ reason: 'TP HIT', metadata: { type: 'close', exitReason: 'take_profit' } }), 'TP_HIT');
  });
  it('classifies stop_loss close as SL_HIT', () => {
    assert.equal(classifyEvent({ reason: 'SL HIT', metadata: { type: 'close', exitReason: 'stop_loss' } }), 'SL_HIT');
  });
  it('classifies confidence_collapse close as EARLY_EXIT', () => {
    assert.equal(classifyEvent({ reason: 'EARLY EXIT', metadata: { type: 'close', exitReason: 'confidence_collapse' } }), 'EARLY_EXIT');
  });
  it('classifies a rejection', () => {
    assert.equal(classifyEvent({ reason: 'BLOCKED: EV insufficient' }), 'TRADE_REJECTED');
  });
  it('classifies a signal', () => {
    assert.equal(classifyEvent({ reason: 'SIGNAL: BTC long setup' }), 'SIGNAL_FOUND');
  });
  it('classifies safe mode', () => {
    assert.equal(classifyEvent({ reason: 'SAFE_MODE_ACTIVATED', severity: 'CRITICAL' }), 'SAFE_MODE');
  });
  it('classifies learning category', () => {
    assert.equal(classifyEvent({ reason: 'Lesson logged', category: 'LEARNING' }), 'LEARNING_UPDATE');
  });
  it('classifies scanning', () => {
    assert.equal(classifyEvent({ reason: 'SCANNING 4 pairs', category: 'SCAN' }), 'SCANNING');
  });
  it('defaults to ANALYZING', () => {
    assert.equal(classifyEvent({ reason: 'something neutral' }), 'ANALYZING');
  });
});

// ── narrate ───────────────────────────────────────────────────────────────────

describe('narrate', () => {
  it('produces a TP_HIT line with pnl', () => {
    const item = narrate({ id: 'x1', ts: '2026-06-07T10:00:00Z', reason: 'TP HIT', metadata: { type: 'close', exitReason: 'take_profit', pair: 'BTCUSDT', pnl: 2.4 } });
    assert.equal(item.type, 'TP_HIT');
    assert.match(item.text, /TP hit · BTC \+\$2\.40/);
    assert.equal(item.source, 'deterministic');
  });
  it('produces an SL_HIT line with negative pnl', () => {
    const item = narrate({ id: 'x2', ts: '2026-06-07T10:00:00Z', reason: 'SL HIT', metadata: { type: 'close', exitReason: 'stop_loss', pair: 'ETHUSDT', pnl: -1.8 } });
    assert.match(item.text, /SL hit · ETH -\$1\.80/);
  });
  it('produces a TRADE_OPENED line with entry and confidence', () => {
    const item = narrate({ id: 'x3', ts: '2026-06-07T10:00:00Z', reason: 'LONG OPENED', metadata: { type: 'open', side: 'LONG', pair: 'BTCUSDT', entry: 62840, confidence: 0.74 } });
    assert.equal(item.type, 'TRADE_OPENED');
    assert.match(item.text, /LONG BTC opened/);
    assert.match(item.text, /conf 74%/);
  });
  it('shortens very long reasons', () => {
    const long = 'X'.repeat(200);
    const item = narrate({ id: 'x4', ts: '2026-06-07T10:00:00Z', reason: long });
    assert.ok(item.text.length <= 90, `expected <=90, got ${item.text.length}`);
  });
});

// ── deterministicSummary ──────────────────────────────────────────────────────

describe('deterministicSummary', () => {
  it('always returns a non-empty desk line', () => {
    const s = deterministicSummary();
    assert.ok(typeof s === 'string' && s.length > 0);
    assert.match(s, /^Desk:/);
  });
});

// ── getCommentary (integration; no API key in test env) ───────────────────────

describe('getCommentary', () => {
  it('returns an array including a DESK_SUMMARY', async () => {
    const items = await getCommentary({ limit: 20 });
    assert.ok(Array.isArray(items));
    const summary = items.find(i => i.type === 'DESK_SUMMARY');
    assert.ok(summary, 'expected a DESK_SUMMARY item');
    assert.equal(summary.source, 'deterministic'); // no API key in tests
  });
  it('respects the limit', async () => {
    const items = await getCommentary({ limit: 5 });
    assert.ok(items.length <= 5);
  });
  it('every item has required fields', async () => {
    const items = await getCommentary({ limit: 10 });
    for (const it of items) {
      assert.ok(it.id && it.ts && it.type && typeof it.text === 'string');
      assert.ok(['deterministic', 'llm'].includes(it.source));
    }
  });
});
