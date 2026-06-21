// database.mjs — SQLite connection, migration, and shared db instance.
// Uses better-sqlite3 (synchronous) — no async/await complexity.
// Single file at data/genesis.db — portable, zero infra.

import Database from 'better-sqlite3';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dir, '..', '..', 'data', 'genesis.db');
const SCHEMA_PATH = join(__dir, 'schema.sql');

// Ensure data directory exists
const dataDir = join(__dir, '..', '..', 'data');
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

// Open (or create) the database
const db = new Database(DB_PATH, { verbose: process.env.DB_VERBOSE ? console.log : undefined });

// WAL mode must be set outside of transactions
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');
// Concurrency: server + agent runner are separate processes sharing this DB.
// WAL allows many readers + one writer; busy_timeout makes writers retry instead
// of throwing "database is locked" when they briefly contend.
db.pragma('busy_timeout = 5000');
db.pragma('wal_autocheckpoint = 1000');

// Apply schema (idempotent — CREATE TABLE IF NOT EXISTS)
function migrate() {
  const schema = readFileSync(SCHEMA_PATH, 'utf8');
  // Split on semicolons but respect string literals
  const statements = schema
    .replace(/--[^\n]*/g, '')          // remove single-line comments
    .split(/;\s*\n/)
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .filter(s => !s.toUpperCase().startsWith('PRAGMA')); // pragmas run outside tx

  const migration = db.transaction(() => {
    for (const stmt of statements) {
      try {
        db.prepare(stmt + ';').run();
      } catch (e) {
        // Ignore idempotent migration errors
        if (!e.message.includes('already exists') && !e.message.includes('duplicate column name')) {
          console.error('[db] Migration error:', e.message.slice(0, 100), 'in:', stmt.slice(0, 60));
          throw e;
        }
      }
    }
  });
  migration();
}

migrate();

function migrateIndexes() {
  const stmts = [
    `CREATE INDEX IF NOT EXISTS idx_trades_type_status ON trades(trade_type, status)`,
    `CREATE INDEX IF NOT EXISTS idx_trades_instrument_status ON trades(instrument_type, status)`,
    `CREATE INDEX IF NOT EXISTS idx_trades_market_status ON trades(market_id, status)`,
    `CREATE TABLE IF NOT EXISTS price_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trade_id TEXT NOT NULL,
      yes_price REAL NOT NULL,
      no_price  REAL NOT NULL,
      recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_snapshots_trade ON price_snapshots(trade_id, recorded_at)`,
  ];
  for (const s of stmts) {
    try { db.prepare(s).run(); } catch { /* idempotent */ }
  }
}

migrateIndexes();

function migrateObservability() {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS operator_events (
      id TEXT PRIMARY KEY, ts TEXT NOT NULL, category TEXT NOT NULL,
      severity TEXT NOT NULL, subsystem TEXT NOT NULL,
      reason TEXT NOT NULL, metadata TEXT NOT NULL DEFAULT '{}'
    )`,
    `CREATE INDEX IF NOT EXISTS idx_opevents_ts       ON operator_events(ts)`,
    `CREATE INDEX IF NOT EXISTS idx_opevents_category ON operator_events(category)`,
    `CREATE INDEX IF NOT EXISTS idx_opevents_severity ON operator_events(severity)`,
  ];
  for (const s of stmts) {
    try { db.prepare(s).run(); } catch { /* idempotent */ }
  }
}

migrateObservability();

function migrateIntelligenceSupervisor() {
  const stmts = [
    `ALTER TABLE intelligence_runs ADD COLUMN proposed_changes TEXT`,
    `ALTER TABLE intelligence_policy_applies ADD COLUMN expires_at TEXT`,
    `CREATE TABLE IF NOT EXISTS intelligence_policy_applies (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      status TEXT NOT NULL,
      applied_overrides TEXT NOT NULL,
      applied_by TEXT NOT NULL DEFAULT 'operator',
      created_at TEXT NOT NULL,
      expires_at TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_intelligence_policy_applies_scope_created
      ON intelligence_policy_applies(scope, created_at DESC)`,
  ];
  for (const stmt of stmts) {
    try { db.prepare(stmt).run(); } catch { /* idempotent */ }
  }
}

migrateIntelligenceSupervisor();

// ─── Kalshi real trading columns ──────────────────────────────────────────────

function migrateTradingKalshi() {
  const stmts = [
    // SQLite: cannot add UNIQUE to existing table, so use INDEX instead for migration
    `ALTER TABLE trades ADD COLUMN external_order_id TEXT`,
    `ALTER TABLE trades ADD COLUMN trade_type TEXT DEFAULT 'paper'`,
    `ALTER TABLE trades ADD COLUMN mode TEXT`,
    `ALTER TABLE trades ADD COLUMN exit_reason TEXT`,
    // Use INDEX for existing tables (new tables have UNIQUE in schema.sql)
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_trades_external_order_uniq ON trades(external_order_id) WHERE external_order_id IS NOT NULL`,
  ];
  for (const stmt of stmts) {
    try {
      db.prepare(stmt).run();
    } catch (e) {
      // Idempotent: column might already exist
      if (!e.message.includes('duplicate column name') && !e.message.includes('already exists')) {
        // Silent fail for migration
      }
    }
  }
}

migrateTradingKalshi();

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Execute a write operation in a transaction */
export function tx(fn) {
  return db.transaction(fn)();
}

/** Run raw SQL (for debugging) */
export function raw(sql, params = []) {
  return db.prepare(sql).all(params);
}

export default db;
