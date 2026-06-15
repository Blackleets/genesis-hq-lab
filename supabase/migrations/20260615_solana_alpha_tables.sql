-- Solana Alpha (PumpFun) tables on Supabase Postgres.
-- Ported from server/solana-alpha/migrations.mjs (SQLite) so the serverless
-- feeder (genesis-runner) can write and the read fallback (genesis-fallback) +
-- api/_lib/solanaFallback.js can read the same shape the frontend already expects.
-- Idempotent: safe to run multiple times.

CREATE TABLE IF NOT EXISTS solana_tokens (
  mint              text PRIMARY KEY,
  name              text,
  symbol            text,
  creator           text,
  created_ts        bigint,
  market_cap_sol    double precision DEFAULT 0,
  bonding_curve_pct double precision DEFAULT 0,
  volume_sol_1h     double precision DEFAULT 0,
  trade_count       integer DEFAULT 0,
  unique_wallets    integer DEFAULT 0,
  risk_score        integer DEFAULT 50,
  risk_flags        text DEFAULT '[]',
  status            text DEFAULT 'active',
  last_price_sol    double precision DEFAULT 0,
  first_seen        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS solana_wallets (
  address               text PRIMARY KEY,
  label                 text DEFAULT 'unknown',
  score                 integer DEFAULT 50,
  total_trades          integer DEFAULT 0,
  wins                  integer DEFAULT 0,
  losses                integer DEFAULT 0,
  avg_entry_bonding_pct double precision DEFAULT 0,
  avg_profit_x          double precision DEFAULT 1,
  total_volume_sol      double precision DEFAULT 0,
  first_seen            timestamptz DEFAULT now(),
  last_active           timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS solana_paper_trades (
  id                text PRIMARY KEY,
  token_mint        text NOT NULL,
  token_symbol      text DEFAULT '???',
  side              text DEFAULT 'LONG',
  entry_price_sol   double precision NOT NULL,
  current_price_sol double precision,
  exit_price_sol    double precision,
  size_sol          double precision NOT NULL,
  tokens            double precision NOT NULL,
  status            text DEFAULT 'open',
  sl_pct            double precision DEFAULT 0.10,
  tp1_pct           double precision DEFAULT 0.25,
  tp2_pct           double precision DEFAULT 0.50,
  tp3_pct           double precision DEFAULT 1.00,
  tp1_hit           integer DEFAULT 0,
  tp2_hit           integer DEFAULT 0,
  tp3_hit           integer DEFAULT 0,
  trailing_stop_pct double precision DEFAULT 0.15,
  peak_price_sol    double precision,
  remaining_tokens  double precision,
  realized_sol      double precision DEFAULT 0,
  signal_reason     text,
  opened_at         timestamptz DEFAULT now(),
  closed_at         timestamptz,
  pnl_sol           double precision,
  pnl_pct           double precision
);

CREATE TABLE IF NOT EXISTS solana_signals (
  id           text PRIMARY KEY,
  token_mint   text NOT NULL,
  token_symbol text DEFAULT '???',
  signal_type  text NOT NULL,
  confidence   integer DEFAULT 50,
  reason       text,
  wallet_count integer DEFAULT 0,
  risk_score   integer DEFAULT 50,
  acted_on     integer DEFAULT 0,
  trade_id     text,
  created_at   timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS solana_equity_snapshots (
  id             bigserial PRIMARY KEY,
  balance_sol    double precision NOT NULL,
  open_value_sol double precision DEFAULT 0,
  total_sol      double precision NOT NULL,
  ts             timestamptz DEFAULT now()
);

-- Helpful indexes for the read queries (ORDER BY updated_at / created_at).
CREATE INDEX IF NOT EXISTS idx_solana_tokens_updated   ON solana_tokens (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_solana_signals_created   ON solana_signals (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_solana_paper_status      ON solana_paper_trades (status);
CREATE INDEX IF NOT EXISTS idx_solana_paper_closed      ON solana_paper_trades (closed_at DESC);
CREATE INDEX IF NOT EXISTS idx_solana_equity_ts         ON solana_equity_snapshots (ts DESC);

-- Seed an initial equity snapshot (100 SOL) so the equity curve is never empty.
INSERT INTO solana_equity_snapshots (balance_sol, open_value_sol, total_sol)
SELECT 100, 0, 100
WHERE NOT EXISTS (SELECT 1 FROM solana_equity_snapshots);
