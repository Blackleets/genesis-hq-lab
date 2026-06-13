// migrations.mjs — create Solana Alpha Lab tables.
// Isolated from all existing tables (trades, lessons, etc.).

import db from '../db/database.mjs';

export function runSolanaAlphaMigrations() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS solana_tokens (
      mint          TEXT PRIMARY KEY,
      name          TEXT,
      symbol        TEXT,
      creator       TEXT,
      created_ts    INTEGER,
      market_cap_sol REAL DEFAULT 0,
      bonding_curve_pct REAL DEFAULT 0,
      volume_sol_1h REAL DEFAULT 0,
      trade_count   INTEGER DEFAULT 0,
      unique_wallets INTEGER DEFAULT 0,
      risk_score    INTEGER DEFAULT 50,
      risk_flags    TEXT DEFAULT '[]',
      status        TEXT DEFAULT 'active',
      last_price_sol REAL DEFAULT 0,
      first_seen    TEXT DEFAULT (datetime('now')),
      updated_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS solana_wallets (
      address       TEXT PRIMARY KEY,
      label         TEXT DEFAULT 'unknown',
      score         INTEGER DEFAULT 50,
      total_trades  INTEGER DEFAULT 0,
      wins          INTEGER DEFAULT 0,
      losses        INTEGER DEFAULT 0,
      avg_entry_bonding_pct REAL DEFAULT 0,
      avg_profit_x  REAL DEFAULT 1,
      total_volume_sol REAL DEFAULT 0,
      first_seen    TEXT DEFAULT (datetime('now')),
      last_active   TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS solana_paper_trades (
      id            TEXT PRIMARY KEY,
      token_mint    TEXT NOT NULL,
      token_symbol  TEXT DEFAULT '???',
      side          TEXT DEFAULT 'LONG',
      entry_price_sol REAL NOT NULL,
      current_price_sol REAL,
      exit_price_sol REAL,
      size_sol      REAL NOT NULL,
      tokens        REAL NOT NULL,
      status        TEXT DEFAULT 'open',
      sl_pct        REAL DEFAULT 0.10,
      tp1_pct       REAL DEFAULT 0.25,
      tp2_pct       REAL DEFAULT 0.50,
      tp3_pct       REAL DEFAULT 1.00,
      tp1_hit       INTEGER DEFAULT 0,
      tp2_hit       INTEGER DEFAULT 0,
      tp3_hit       INTEGER DEFAULT 0,
      trailing_stop_pct REAL DEFAULT 0.15,
      peak_price_sol REAL,
      remaining_tokens REAL,
      realized_sol  REAL DEFAULT 0,
      signal_reason TEXT,
      opened_at     TEXT DEFAULT (datetime('now')),
      closed_at     TEXT,
      pnl_sol       REAL,
      pnl_pct       REAL
    );

    CREATE TABLE IF NOT EXISTS solana_signals (
      id            TEXT PRIMARY KEY,
      token_mint    TEXT NOT NULL,
      token_symbol  TEXT DEFAULT '???',
      signal_type   TEXT NOT NULL,
      confidence    INTEGER DEFAULT 50,
      reason        TEXT,
      wallet_count  INTEGER DEFAULT 0,
      risk_score    INTEGER DEFAULT 50,
      acted_on      INTEGER DEFAULT 0,
      trade_id      TEXT,
      created_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS solana_equity_snapshots (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      balance_sol   REAL NOT NULL,
      open_value_sol REAL DEFAULT 0,
      total_sol     REAL NOT NULL,
      ts            TEXT DEFAULT (datetime('now'))
    );
  `);

  // Seed initial equity snapshot if none exists
  const count = db.prepare(`SELECT COUNT(*) as n FROM solana_equity_snapshots`).get();
  if (count.n === 0) {
    db.prepare(`INSERT INTO solana_equity_snapshots (balance_sol, open_value_sol, total_sol) VALUES (100, 0, 100)`).run();
  }

  console.log('[solana-alpha] DB migrations applied');
}
