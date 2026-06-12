import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { getWfCache, setWfCache, isWfCacheStale, clearWfCache } from '../quant/wfCache.mjs';

// wfCache uses org_state (key-value table in the shared test DB).
// We clear the WF key before/after each suite to avoid cross-test pollution.

describe('wfCache — read/write/stale', () => {
  before(() => clearWfCache());
  after(() => clearWfCache());

  test('getWfCache returns null when no entry exists', () => {
    const result = getWfCache();
    assert.equal(result, null);
  });

  test('isWfCacheStale returns true when no entry exists', () => {
    assert.equal(isWfCacheStale(24), true);
  });

  test('setWfCache stores and getWfCache retrieves the result', () => {
    const payload = {
      summary: { robustShort: true, robustCombined: false, positiveWindows: 3, totalJudged: 4 },
      completedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      durationMs: 1500,
    };
    setWfCache(payload);
    const cached = getWfCache();
    assert.ok(cached, 'should return cached object');
    assert.deepEqual(cached.summary, payload.summary);
    assert.ok(typeof cached.cachedAt === 'string', 'cachedAt injected from updated_at');
  });

  test('isWfCacheStale returns false immediately after write', () => {
    assert.equal(isWfCacheStale(24), false);
  });

  test('isWfCacheStale returns true when maxAgeHours is 0', () => {
    // Any cached entry is "stale" if maxAge is 0
    assert.equal(isWfCacheStale(0), true);
  });

  test('clearWfCache removes the entry', () => {
    clearWfCache();
    assert.equal(getWfCache(), null);
    assert.equal(isWfCacheStale(24), true);
  });

  test('setWfCache overwrites previous entry', () => {
    setWfCache({ summary: { robustCombined: false }, completedAt: 'v1' });
    setWfCache({ summary: { robustCombined: true }, completedAt: 'v2' });
    const cached = getWfCache();
    assert.equal(cached.completedAt, 'v2');
    assert.equal(cached.summary.robustCombined, true);
  });

  test('getWfCache is resilient to corrupted JSON — returns null', () => {
    // Write bad JSON directly to org_state via DB
    import('../db/database.mjs').then(({ default: db }) => {
      db.prepare(`INSERT OR REPLACE INTO org_state (key, value, updated_at) VALUES ('quant_wf_latest', 'not-valid-json{{{', datetime('now'))`).run();
      const result = getWfCache();
      assert.equal(result, null);
      clearWfCache();
    });
  });
});

describe('wfCache — summary shape tolerance', () => {
  before(() => clearWfCache());
  after(() => clearWfCache());

  test('handles missing summary gracefully', () => {
    setWfCache({ completedAt: new Date().toISOString(), startedAt: new Date().toISOString() });
    const cached = getWfCache();
    assert.ok(cached);
    assert.equal(cached.summary, undefined);
  });

  test('handles null fields in summary without throwing', () => {
    setWfCache({
      summary: { robustShort: null, robustCombined: null, positiveWindows: null, totalJudged: null },
      completedAt: new Date().toISOString(),
    });
    const cached = getWfCache();
    assert.equal(cached.summary.robustShort, null);
  });
});
