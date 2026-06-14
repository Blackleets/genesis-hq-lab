// dbReplicator.mjs — Hybrid persistence: SQLite stays the execution DB; Supabase
// Postgres is durable memory. A background diff-based replicator polls changed rows
// from SQLite and upserts them to Postgres. The hot path (better-sqlite3, sync) is
// never touched and never blocks on Postgres.
//
// Modes (DB_MODE): 'sqlite' (off) | 'hybrid' (default) | 'postgres' (authoritative restore).
// Everything no-ops unless mode ≠ sqlite AND DATABASE_URL is set → safe locally + in tests.

import db from '../db/database.mjs';

const REPLICATE_INTERVAL_MS = 5000;
const BATCH = 200;

// ── Durable table replication config ──────────────────────────────────────────
// mode: 'cursor' (watermark on a timestamp expr — catches inserts AND updates),
//       'rowid'  (watermark on rowid — append-only inserts),
//       'full'   (small/mutable — re-upsert every cycle).
const DURABLE = [
  { table: 'trades',           pk: 'id',  mode: 'cursor', cursorExpr: "COALESCE(closed_at, opened_at)" },
  { table: 'operator_events',  pk: 'id',  mode: 'cursor', cursorExpr: 'ts' },
  { table: 'capital_history',  pk: 'id',  mode: 'rowid'  },
  { table: 'lessons',          pk: 'id',  mode: 'rowid'  },
  { table: 'signals',          pk: 'id',  mode: 'rowid'  },
  { table: 'mistake_patterns', pk: 'id',  mode: 'full'   },
  { table: 'agent_profiles',   pk: 'id',  mode: 'full'   },
  { table: 'skill_versions',   pk: 'id',  mode: 'full'   },
  { table: 'intelligence_runs', pk: 'id', mode: 'cursor', cursorExpr: 'created_at' },
  { table: 'org_state',        pk: 'key', mode: 'full'   },
  { table: 'solana_tokens',     pk: 'mint', mode: 'cursor', cursorExpr: 'updated_at' },
  { table: 'solana_wallets',    pk: 'address', mode: 'cursor', cursorExpr: 'last_active' },
  { table: 'solana_signals',    pk: 'id', mode: 'cursor', cursorExpr: 'created_at' },
  { table: 'solana_paper_trades', pk: 'id', mode: 'cursor', cursorExpr: "COALESCE(closed_at, opened_at)" },
  { table: 'solana_equity_snapshots', pk: 'id', mode: 'rowid' },
];

// ── Mode + enablement ─────────────────────────────────────────────────────────

export function getDbMode() {
  const m = (process.env.DB_MODE ?? 'hybrid').toLowerCase();
  return ['sqlite', 'hybrid', 'postgres'].includes(m) ? m : 'hybrid';
}

// Accept the common Supabase/Render Postgres connection-string env var names so the
// integration works regardless of which one the platform injected.
export function getDatabaseUrl() {
  return (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.SUPABASE_DB_URL ||
    process.env.SUPABASE_DATABASE_URL ||
    ''
  );
}

export function isReplicationEnabled() {
  return getDbMode() !== 'sqlite' && !!getDatabaseUrl();
}

// ── Health stats (in-memory) ──────────────────────────────────────────────────

const _stats = {
  pgConnected: false,
  rowsSynced: 0,
  failedSyncs: 0,
  lastSyncAt: null,
  lastError: null,
  perTable: {},      // table → rows synced
  schemaReady: false,
};

// Auth-failure backoff: a bad/missing credential must NOT hammer Supabase every 5s
// (that trips its connection circuit-breaker). On auth-type errors we back off
// exponentially (cap 10 min) and reset the pool so a corrected credential reconnects.
let _backoffUntil = 0;
let _backoffMs = 0;
const _BACKOFF_MAX = 10 * 60_000;

function isAuthError(msg = '') {
  const m = msg.toLowerCase();
  return m.includes('auth') || m.includes('password') || m.includes('circuitbreaker') || m.includes('circuit breaker');
}

async function applyAuthBackoff(msg) {
  _backoffMs = _backoffMs === 0 ? 30_000 : Math.min(_BACKOFF_MAX, _backoffMs * 2);
  _backoffUntil = Date.now() + _backoffMs;
  _stats.pgConnected = false;
  // Drop the pool so the next (post-backoff) attempt reconnects with fresh config.
  try { if (_pool) await _pool.end(); } catch { /* ignore */ }
  _pool = null;
  _stats.schemaReady = false;
  console.warn(`[dbReplicator] auth failure — backing off ${_backoffMs / 1000}s. Check DATABASE_URL. (${msg})`);
}

function resetBackoff() { _backoffMs = 0; _backoffUntil = 0; }

// ── Lazy pg pool ──────────────────────────────────────────────────────────────

// Parse a postgres connection string into discrete fields WITHOUT new URL(), so
// passwords containing special characters (#, $, &, etc. — common in Supabase) don't
// break URL parsing ("Invalid URL"). Splits creds on the LAST '@'.
export function parseDbUrl(url) {
  if (!url) return null;
  url = String(url).trim();   // strip stray whitespace/newlines from the env var (a pasted
  if (!url) return null;      // value often has a trailing \n → 'postgres\n' database error)
  const noProto = url.replace(/^postgres(?:ql)?:\/\//i, '');
  const at = noProto.lastIndexOf('@');
  if (at < 0) return null;
  const creds = noProto.slice(0, at);
  const hostPart = noProto.slice(at + 1);
  const colon = creds.indexOf(':');
  const user = colon >= 0 ? creds.slice(0, colon) : creds;
  const password = colon >= 0 ? creds.slice(colon + 1) : '';
  const slash = hostPart.indexOf('/');
  const hostPort = slash >= 0 ? hostPart.slice(0, slash) : hostPart;
  const database = ((slash >= 0 ? hostPart.slice(slash + 1) : 'postgres').split('?')[0] || 'postgres').trim();
  const [host, portStr] = hostPort.split(':');
  return {
    host,
    port: portStr ? parseInt(portStr, 10) : 5432,
    user: decodeURIComponent(user),
    password,                       // used as-is (no URL decoding) → special chars safe
    database,
  };
}

let _pool = null;
async function getPool() {
  if (!isReplicationEnabled()) return null;
  if (_pool) return _pool;
  const { default: pg } = await import('pg');
  const parsed = parseDbUrl(getDatabaseUrl());
  if (!parsed || !parsed.host) { _stats.lastError = 'could not parse DATABASE_URL'; return null; }
  _pool = new pg.Pool({
    ...parsed,
    ssl: { rejectUnauthorized: false },   // Supabase requires SSL
    max: 3,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 8_000,
  });
  _pool.on('error', () => { _stats.pgConnected = false; });
  return _pool;
}

// ── SQLite type → Postgres type ───────────────────────────────────────────────

function pgType(sqliteType) {
  const t = (sqliteType ?? '').toUpperCase();
  if (t.includes('INT'))  return 'BIGINT';
  if (t.includes('REAL') || t.includes('FLOA') || t.includes('DOUB')) return 'DOUBLE PRECISION';
  if (t.includes('BLOB')) return 'BYTEA';
  return 'TEXT';
}

// Columns of a SQLite table (cached).
const _colsCache = {};
function tableColumns(table) {
  if (_colsCache[table]) return _colsCache[table];
  const info = db.prepare(`PRAGMA table_info(${table})`).all();
  const cols = info.map(c => ({ name: c.name, type: c.type }));
  _colsCache[table] = cols;
  return cols;
}

// ── Cursor persistence (in SQLite, isolated internal table) ───────────────────

function ensureCursorTable() {
  db.prepare(`CREATE TABLE IF NOT EXISTS _repl_cursors (table_name TEXT PRIMARY KEY, cursor_value TEXT, updated_at TEXT)`).run();
}
function getCursor(table) {
  try { return db.prepare(`SELECT cursor_value FROM _repl_cursors WHERE table_name = ?`).get(table)?.cursor_value ?? null; }
  catch { return null; }
}
function setCursor(table, value) {
  try {
    db.prepare(`INSERT INTO _repl_cursors (table_name, cursor_value, updated_at) VALUES (?, ?, ?)
                ON CONFLICT(table_name) DO UPDATE SET cursor_value = excluded.cursor_value, updated_at = excluded.updated_at`)
      .run(table, String(value), new Date().toISOString());
  } catch { /* non-fatal */ }
}

// ── Postgres schema mirror (idempotent) ───────────────────────────────────────

export async function ensurePgSchema() {
  const pool = await getPool();
  if (!pool) return false;
  for (const cfg of DURABLE) {
    const cols = tableColumns(cfg.table);
    if (cols.length === 0) continue;
    const defs = cols.map(c => `"${c.name}" ${pgType(c.type)}`).join(', ');
    const sql = `CREATE TABLE IF NOT EXISTS "${cfg.table}" (${defs}, PRIMARY KEY ("${cfg.pk}"))`;
    await pool.query(sql);
    const existingColsRes = await pool.query(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1`,
      [cfg.table],
    );
    const existingCols = new Set(existingColsRes.rows.map((row) => row.column_name));
    for (const col of cols) {
      if (existingCols.has(col.name)) continue;
      await pool.query(`ALTER TABLE "${cfg.table}" ADD COLUMN "${col.name}" ${pgType(col.type)}`);
    }
  }
  _stats.schemaReady = true;
  _stats.pgConnected = true;
  return true;
}

// ── Upsert a batch of rows into Postgres ──────────────────────────────────────

async function upsertBatch(pool, cfg, rows) {
  if (rows.length === 0) return 0;
  const cols = tableColumns(cfg.table).map(c => c.name);
  const colList = cols.map(c => `"${c}"`).join(', ');
  const updates = cols.filter(c => c !== cfg.pk).map(c => `"${c}" = EXCLUDED."${c}"`).join(', ');

  let synced = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const params = [];
    const tuples = chunk.map((row) => {
      const ph = cols.map((c) => { params.push(row[c] ?? null); return `$${params.length}`; });
      return `(${ph.join(', ')})`;
    });
    const sql = `INSERT INTO "${cfg.table}" (${colList}) VALUES ${tuples.join(', ')}
                 ON CONFLICT ("${cfg.pk}") DO UPDATE SET ${updates}`;
    await pool.query(sql, params);
    synced += chunk.length;
  }
  return synced;
}

// ── Replicate one table ───────────────────────────────────────────────────────

async function replicateTable(pool, cfg) {
  let rows, newCursor = null;
  if (cfg.mode === 'cursor') {
    const wm = getCursor(cfg.table) ?? '';
    rows = db.prepare(`SELECT *, ${cfg.cursorExpr} AS _cur FROM "${cfg.table}" WHERE ${cfg.cursorExpr} > ? ORDER BY ${cfg.cursorExpr} ASC LIMIT 1000`).all(wm);
    if (rows.length) newCursor = rows[rows.length - 1]._cur;
    rows = rows.map(({ _cur, ...r }) => r);
  } else if (cfg.mode === 'rowid') {
    const wm = parseInt(getCursor(cfg.table) ?? '0', 10) || 0;
    rows = db.prepare(`SELECT *, rowid AS _rid FROM "${cfg.table}" WHERE rowid > ? ORDER BY rowid ASC LIMIT 1000`).all(wm);
    if (rows.length) newCursor = rows[rows.length - 1]._rid;
    rows = rows.map(({ _rid, ...r }) => r);
  } else { // full
    rows = db.prepare(`SELECT * FROM "${cfg.table}"`).all();
  }

  if (rows.length === 0) return 0;
  const synced = await upsertBatch(pool, cfg, rows);
  if (newCursor != null) setCursor(cfg.table, newCursor);
  _stats.perTable[cfg.table] = (_stats.perTable[cfg.table] ?? 0) + synced;
  return synced;
}

// ── One replication pass over all durable tables ──────────────────────────────

export async function replicateOnce() {
  if (!isReplicationEnabled()) return { ok: false, reason: 'disabled' };
  if (Date.now() < _backoffUntil) return { ok: false, reason: 'auth_backoff' };
  let pool;
  try {
    pool = await getPool();
  } catch (e) {
    if (isAuthError(e.message)) await applyAuthBackoff(e.message);
    _stats.failedSyncs++; _stats.lastError = e.message;
    return { ok: false, reason: e.message };
  }
  if (!pool) return { ok: false, reason: 'no_pool' };
  try {
    if (!_stats.schemaReady) await ensurePgSchema();
    let total = 0;
    let authErr = null;
    for (const cfg of DURABLE) {
      try { total += await replicateTable(pool, cfg); }
      catch (e) { _stats.failedSyncs++; _stats.lastError = `${cfg.table}: ${e.message}`; if (isAuthError(e.message)) authErr = e.message; }
    }
    if (authErr) { await applyAuthBackoff(authErr); return { ok: false, reason: authErr }; }
    _stats.rowsSynced += total;
    _stats.lastSyncAt = new Date().toISOString();
    _stats.pgConnected = true;
    resetBackoff();
    return { ok: true, synced: total };
  } catch (e) {
    _stats.failedSyncs++;
    _stats.lastError = e.message;
    _stats.pgConnected = false;
    if (isAuthError(e.message)) await applyAuthBackoff(e.message);
    return { ok: false, reason: e.message };
  }
}

// ── Restore SQLite from Postgres (boot recovery) ──────────────────────────────

/** Pull every durable table from Postgres into SQLite (INSERT OR IGNORE). */
export async function restoreFromPg({ force = false } = {}) {
  if (!isReplicationEnabled()) return { ok: false, reason: 'disabled', restored: 0 };
  const pool = await getPool();
  if (!pool) return { ok: false, reason: 'no_pool', restored: 0 };

  try {
    await ensurePgSchema();
    // Stale check: SQLite trades empty while PG has trades (or forced / postgres mode).
    const localTrades = db.prepare(`SELECT COUNT(*) AS n FROM trades`).get()?.n ?? 0;
    const pgTrades = (await pool.query(`SELECT COUNT(*)::int AS n FROM "trades"`)).rows[0]?.n ?? 0;
    const shouldRestore = force || getDbMode() === 'postgres' || (localTrades === 0 && pgTrades > 0);
    if (!shouldRestore) return { ok: true, restored: 0, reason: 'fresh_local', localTrades, pgTrades };

    let restored = 0;
    for (const cfg of DURABLE) {
      const cols = tableColumns(cfg.table);
      if (cols.length === 0) continue;
      let pgRows;
      try { pgRows = (await pool.query(`SELECT * FROM "${cfg.table}"`)).rows; }
      catch { continue; }
      if (!pgRows?.length) continue;
      const colList = cols.map(c => `"${c.name}"`).join(', ');
      const ph = cols.map((_, i) => `@p${i}`).join(', ');
      const stmt = db.prepare(`INSERT OR IGNORE INTO "${cfg.table}" (${colList}) VALUES (${ph})`);
      const insertMany = db.transaction((rows) => {
        for (const r of rows) {
          const o = {};
          cols.forEach((c, i) => { o[`p${i}`] = r[c.name] ?? null; });
          stmt.run(o);
        }
      });
      insertMany(pgRows);
      restored += pgRows.length;
    }
    return { ok: true, restored, localTrades, pgTrades };
  } catch (e) {
    return { ok: false, reason: e.message, restored: 0 };
  }
}

// ── Background loop ───────────────────────────────────────────────────────────

let _timer = null;
export function startReplication() {
  if (!isReplicationEnabled()) {
    console.log(`[dbReplicator] mode=${getDbMode()} — replication off (no DATABASE_URL or sqlite mode)`);
    return;
  }
  ensureCursorTable();
  console.log(`[dbReplicator] mode=${getDbMode()} — async replication to Supabase every ${REPLICATE_INTERVAL_MS / 1000}s`);
  // First pass shortly after boot, then on interval.
  setTimeout(() => { void replicateOnce(); }, 3000);
  _timer = setInterval(() => { void replicateOnce(); }, REPLICATE_INTERVAL_MS);

  const finalFlush = () => { try { void replicateOnce(); } catch { /* best effort */ } };
  process.once('SIGTERM', finalFlush);
  process.once('SIGINT', finalFlush);
}

export function stopReplication() {
  if (_timer) clearInterval(_timer);
  _timer = null;
}

// ── Health for /api/db/health ─────────────────────────────────────────────────

export function getDbHealth() {
  const mode = getDbMode();
  const enabled = isReplicationEnabled();
  let sqlite = { ok: false, trades: 0, events: 0 };
  try {
    sqlite = {
      ok: true,
      trades: db.prepare(`SELECT COUNT(*) AS n FROM trades`).get()?.n ?? 0,
      events: db.prepare(`SELECT COUNT(*) AS n FROM operator_events`).get()?.n ?? 0,
    };
  } catch { /* sqlite unreadable */ }

  const lagMs = _stats.lastSyncAt ? Date.now() - new Date(_stats.lastSyncAt).getTime() : null;

  return {
    mode,
    enabled,
    sqlite,
    postgres: {
      configured: !!getDatabaseUrl(),
      connected: _stats.pgConnected,
      schemaReady: _stats.schemaReady,
    },
    replication: {
      rowsSynced: _stats.rowsSynced,
      failedSyncs: _stats.failedSyncs,
      lastSyncAt: _stats.lastSyncAt,
      syncLagMs: lagMs,
      queuePending: estimatePending(),
      perTable: { ..._stats.perTable },
      lastError: _stats.lastError,
      authBackoff: Date.now() < _backoffUntil,
      nextAttemptInMs: Math.max(0, _backoffUntil - Date.now()),
    },
  };
}

// Rough "pending to replicate" estimate: rows past the watermark, summed over cursor/rowid tables.
function estimatePending() {
  if (!isReplicationEnabled()) return 0;
  let pending = 0;
  for (const cfg of DURABLE) {
    try {
      if (cfg.mode === 'cursor') {
        const wm = getCursor(cfg.table) ?? '';
        pending += db.prepare(`SELECT COUNT(*) AS n FROM "${cfg.table}" WHERE ${cfg.cursorExpr} > ?`).get(wm)?.n ?? 0;
      } else if (cfg.mode === 'rowid') {
        const wm = parseInt(getCursor(cfg.table) ?? '0', 10) || 0;
        pending += db.prepare(`SELECT COUNT(*) AS n FROM "${cfg.table}" WHERE rowid > ?`).get(wm)?.n ?? 0;
      }
    } catch { /* skip */ }
  }
  return pending;
}

// Exposed for tests.
export const _internal = { DURABLE, pgType, getDbMode };
