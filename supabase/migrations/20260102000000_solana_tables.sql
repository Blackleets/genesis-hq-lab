-- Genesis HQ — Solana Alpha Tables (PostgreSQL / Supabase)
-- Used by Vercel API routes: /api/solana/*
-- ============================================================================

-- ─── TOKEN FEED ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS solana_tokens (
  mint              TEXT PRIMARY KEY,
  name              TEXT NOT NULL DEFAULT '',
  symbol            TEXT NOT NULL DEFAULT '',
  creator           TEXT,
  created_ts        BIGINT,
  market_cap_sol    DOUBLE PRECISION DEFAULT 0,
  bonding_curve_pct DOUBLE PRECISION DEFAULT 0,
  last_price_sol    DOUBLE PRECISION DEFAULT 0,
  trade_count       INTEGER DEFAULT 0,
  unique_wallets    INTEGER DEFAULT 0,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_solana_tokens_updated ON solana_tokens(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_solana_tokens_mcap    ON solana_tokens(market_cap_sol DESC);

-- ─── SMART WALLETS ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS solana_wallets (
  address          TEXT PRIMARY KEY,
  total_trades     INTEGER DEFAULT 0,
  wins             INTEGER DEFAULT 0,
  losses           INTEGER DEFAULT 0,
  total_volume_sol DOUBLE PRECISION DEFAULT 0,
  avg_profit_x     DOUBLE PRECISION DEFAULT 0,
  score            INTEGER DEFAULT 0,
  label            TEXT DEFAULT '',
  last_active      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_solana_wallets_score ON solana_wallets(score DESC);

-- ─── ALPHA SIGNALS ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS solana_signals (
  id           TEXT PRIMARY KEY,
  token_mint   TEXT NOT NULL REFERENCES solana_tokens(mint),
  token_symbol TEXT NOT NULL DEFAULT '',
  signal_type  TEXT NOT NULL,
  confidence   DOUBLE PRECISION DEFAULT 0,
  reason       TEXT DEFAULT '',
  wallet_count INTEGER DEFAULT 0,
  risk_score   DOUBLE PRECISION DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acted_on     INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_solana_signals_created    ON solana_signals(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_solana_signals_token      ON solana_signals(token_mint);
CREATE INDEX IF NOT EXISTS idx_solana_signals_confidence ON solana_signals(confidence DESC);

-- ─── PAPER TRADES ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS solana_paper_trades (
  id                TEXT PRIMARY KEY,
  token_mint        TEXT NOT NULL,
  token_symbol      TEXT NOT NULL DEFAULT '',
  side              TEXT NOT NULL DEFAULT 'long',
  entry_price_sol   DOUBLE PRECISION NOT NULL,
  current_price_sol DOUBLE PRECISION DEFAULT 0,
  exit_price_sol    DOUBLE PRECISION,
  size_sol          DOUBLE PRECISION NOT NULL,
  tokens            DOUBLE PRECISION NOT NULL,
  remaining_tokens  DOUBLE PRECISION,
  peak_price_sol    DOUBLE PRECISION,
  tp1_hit           INTEGER DEFAULT 0,
  tp2_hit           INTEGER DEFAULT 0,
  tp3_hit           INTEGER DEFAULT 0,
  realized_sol      DOUBLE PRECISION DEFAULT 0,
  pnl_sol           DOUBLE PRECISION,
  pnl_pct           DOUBLE PRECISION,
  signal_reason     TEXT DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'open',
  opened_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_solana_paper_trades_status    ON solana_paper_trades(status);
CREATE INDEX IF NOT EXISTS idx_solana_paper_trades_opened    ON solana_paper_trades(opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_solana_paper_trades_closed    ON solana_paper_trades(closed_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_solana_paper_trades_token     ON solana_paper_trades(token_mint);

-- ─── EQUITY SNAPSHOTS ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS solana_equity_snapshots (
  id            BIGSERIAL PRIMARY KEY,
  ts            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  balance_sol   DOUBLE PRECISION NOT NULL,
  open_value_sol DOUBLE PRECISION NOT NULL DEFAULT 0,
  total_sol     DOUBLE PRECISION NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_solana_equity_ts ON solana_equity_snapshots(ts ASC);

-- ─── ORG STATE (ensure key exists — shared with core migration) ───────────────

-- Initialize paper balance if not already set
INSERT INTO org_state (key, value, updated_at)
VALUES ('solana_paper_balance', '100', NOW()::TEXT)
ON CONFLICT (key) DO NOTHING;
