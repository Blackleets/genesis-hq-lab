import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const { exitKind, getTradeStories } = await import('../crypto/tradeHistory.mjs');

describe('exitKind', () => {
  it('maps take_profit to TP', () => assert.equal(exitKind('take_profit'), 'TP'));
  it('maps stop_loss to SL', () => assert.equal(exitKind('stop_loss'), 'SL'));
  it('maps timeout to TIMEOUT', () => assert.equal(exitKind('timeout'), 'TIMEOUT'));
  it('maps confidence_collapse to CONFIDENCE', () => assert.equal(exitKind('confidence_collapse'), 'CONFIDENCE'));
  it('maps unknown reason to EXIT', () => assert.equal(exitKind('manual'), 'EXIT'));
  it('maps null/undefined to null (open trade)', () => {
    assert.equal(exitKind(null), null);
    assert.equal(exitKind(undefined), null);
  });
});

describe('getTradeStories', () => {
  it('returns an array', () => {
    const rows = getTradeStories({ limit: 10 });
    assert.ok(Array.isArray(rows));
  });
  it('respects the limit', () => {
    const rows = getTradeStories({ limit: 3 });
    assert.ok(rows.length <= 3);
  });
  it('every row has the story shape', () => {
    const rows = getTradeStories({ limit: 10 });
    for (const r of rows) {
      assert.ok(typeof r.id === 'string');
      assert.ok(r.side === 'LONG' || r.side === 'SHORT');
      assert.ok(Array.isArray(r.evidence));
      assert.ok(typeof r.confidence === 'number');
      assert.ok('exit_kind' in r);
    }
  });
});
