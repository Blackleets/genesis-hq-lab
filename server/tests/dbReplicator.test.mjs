import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';

const {
  getDbMode, isReplicationEnabled, replicateOnce, restoreFromPg, getDbHealth, _internal,
} = await import('../persistence/dbReplicator.mjs');

// Ensure a clean env for deterministic assertions.
const savedMode = process.env.DB_MODE;
const savedUrl = process.env.DATABASE_URL;
before(() => { delete process.env.DATABASE_URL; });
after(() => {
  if (savedMode === undefined) delete process.env.DB_MODE; else process.env.DB_MODE = savedMode;
  if (savedUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = savedUrl;
});

describe('getDbMode', () => {
  it('defaults to hybrid', () => { delete process.env.DB_MODE; assert.equal(getDbMode(), 'hybrid'); });
  it('honors sqlite / hybrid / postgres', () => {
    for (const m of ['sqlite', 'hybrid', 'postgres']) { process.env.DB_MODE = m; assert.equal(getDbMode(), m); }
  });
  it('falls back to hybrid on garbage', () => { process.env.DB_MODE = 'banana'; assert.equal(getDbMode(), 'hybrid'); });
});

describe('isReplicationEnabled', () => {
  it('false without DATABASE_URL even in hybrid', () => {
    process.env.DB_MODE = 'hybrid'; delete process.env.DATABASE_URL;
    assert.equal(isReplicationEnabled(), false);
  });
  it('false in sqlite mode even with DATABASE_URL', () => {
    process.env.DB_MODE = 'sqlite'; process.env.DATABASE_URL = 'postgres://x';
    assert.equal(isReplicationEnabled(), false);
    delete process.env.DATABASE_URL;
  });
});

describe('pgType mapping', () => {
  it('maps SQLite types to Postgres types', () => {
    assert.equal(_internal.pgType('INTEGER'), 'BIGINT');
    assert.equal(_internal.pgType('REAL'), 'DOUBLE PRECISION');
    assert.equal(_internal.pgType('TEXT'), 'TEXT');
    assert.equal(_internal.pgType('BLOB'), 'BYTEA');
    assert.equal(_internal.pgType(undefined), 'TEXT');
  });
});

describe('DURABLE config', () => {
  it('every table has a pk and a valid mode', () => {
    for (const c of _internal.DURABLE) {
      assert.ok(c.table && c.pk, `bad config ${JSON.stringify(c)}`);
      assert.ok(['cursor', 'rowid', 'full'].includes(c.mode));
      if (c.mode === 'cursor') assert.ok(c.cursorExpr, `cursor table ${c.table} needs cursorExpr`);
    }
  });
  it('includes the critical durable tables', () => {
    const names = _internal.DURABLE.map(c => c.table);
    for (const t of ['trades', 'operator_events', 'capital_history', 'org_state', 'agent_profiles']) {
      assert.ok(names.includes(t), `missing durable table ${t}`);
    }
  });
});

describe('graceful no-op without DATABASE_URL', () => {
  before(() => { process.env.DB_MODE = 'hybrid'; delete process.env.DATABASE_URL; });
  it('replicateOnce no-ops', async () => {
    const r = await replicateOnce();
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'disabled');
  });
  it('restoreFromPg no-ops', async () => {
    const r = await restoreFromPg();
    assert.equal(r.ok, false);
    assert.equal(r.restored, 0);
  });
  it('getDbHealth returns a well-formed object', () => {
    const h = getDbHealth();
    assert.equal(h.mode, 'hybrid');
    assert.equal(h.enabled, false);
    assert.ok(h.sqlite && typeof h.sqlite.trades === 'number');
    assert.ok(h.postgres && h.replication);
    assert.equal(h.postgres.configured, false);
  });
});
