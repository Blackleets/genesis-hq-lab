-- Genesis HQ — Core Schema (PostgreSQL / Supabase)
-- Tables used by genesis-runner and genesis-fallback edge functions.
-- ============================================================================

-- ─── AGENTS ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agent_profiles (
  id                      TEXT PRIMARY KEY,
  name                    TEXT NOT NULL,
  role                    TEXT NOT NULL,
  department              TEXT NOT NULL,
  level                   INTEGER NOT NULL DEFAULT 1,
  status                  TEXT NOT NULL DEFAULT 'active',
  budget_pct              DOUBLE PRECISION NOT NULL DEFAULT 0.05,
  skill_market_selection  DOUBLE PRECISION DEFAULT 0.3,
  skill_timing            DOUBLE PRECISION DEFAULT 0.3,
  skill_position_sizing   DOUBLE PRECISION DEFAULT 0.3,
  skill_signal_reading    DOUBLE PRECISION DEFAULT 0.3,
  skill_pattern_recog     DOUBLE PRECISION DEFAULT 0.3,
  total_trades            INTEGER DEFAULT 0,
  wins                    INTEGER DEFAULT 0,
  losses                  INTEGER DEFAULT 0,
  total_pnl               DOUBLE PRECISION DEFAULT 0.0,
  win_streak              INTEGER DEFAULT 0,
  loss_streak             INTEGER DEFAULT 0,
  max_win_streak          INTEGER DEFAULT 0,
  max_loss_streak         INTEGER DEFAULT 0,
  calibration_score       DOUBLE PRECISION DEFAULT 0.5,
  created_at              TEXT NOT NULL,
  last_active             TEXT
);

-- ─── TRADING MEMORY ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS trades (
  id                TEXT PRIMARY KEY,
  agent_id          TEXT REFERENCES agent_profiles(id),
  market_id         TEXT NOT NULL,
  market_source     TEXT NOT NULL,
  market_question   TEXT NOT NULL,
  market_category   TEXT DEFAULT 'general',
  outcome           TEXT NOT NULL,
  entry_price       DOUBLE PRECISION NOT NULL,
  exit_price        DOUBLE PRECISION,
  shares            DOUBLE PRECISION NOT NULL,
  capital_used      DOUBLE PRECISION NOT NULL,
  confidence        DOUBLE PRECISION NOT NULL,
  reason            TEXT NOT NULL,
  evidence          TEXT NOT NULL DEFAULT '[]',
  signals_used      TEXT DEFAULT '[]',
  lessons_applied   TEXT DEFAULT '[]',
  rules_applied     TEXT DEFAULT '[]',
  status            TEXT NOT NULL DEFAULT 'open',
  resolved_outcome  TEXT,
  pnl               DOUBLE PRECISION,
  opened_at         TEXT NOT NULL,
  closed_at         TEXT,
  days_to_close     INTEGER,
  lesson_id         TEXT,
  -- Crypto scalp / futures columns
  asset_pair        TEXT,
  trade_type        TEXT DEFAULT 'prediction',
  target_price      DOUBLE PRECISION,
  stop_price        DOUBLE PRECISION,
  exit_reason       TEXT,
  entry_volume24h   DOUBLE PRECISION,
  instrument_type   TEXT DEFAULT 'spot',
  exchange          TEXT,
  margin_mode       TEXT DEFAULT 'cash',
  leverage          DOUBLE PRECISION DEFAULT 1,
  notional_usd      DOUBLE PRECISION,
  funding_rate      DOUBLE PRECISION DEFAULT 0,
  funding_paid      DOUBLE PRECISION DEFAULT 0,
  liquidation_price DOUBLE PRECISION,
  maintenance_margin DOUBLE PRECISION
);

CREATE INDEX IF NOT EXISTS idx_trades_agent     ON trades(agent_id);
CREATE INDEX IF NOT EXISTS idx_trades_status    ON trades(status);
CREATE INDEX IF NOT EXISTS idx_trades_category  ON trades(market_category);
CREATE INDEX IF NOT EXISTS idx_trades_opened    ON trades(opened_at);
CREATE INDEX IF NOT EXISTS idx_trades_type      ON trades(trade_type);
CREATE INDEX IF NOT EXISTS idx_trades_pair      ON trades(asset_pair);

-- ─── LESSONS ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lessons (
  id                    TEXT PRIMARY KEY,
  trade_id              TEXT REFERENCES trades(id),
  agent_id              TEXT REFERENCES agent_profiles(id),
  source_type           TEXT NOT NULL,
  why_failed            TEXT,
  signal_wrong          TEXT,
  what_change           TEXT,
  new_rule              TEXT,
  lesson_text           TEXT NOT NULL,
  category              TEXT NOT NULL,
  severity              TEXT NOT NULL DEFAULT 'info',
  times_retrieved       INTEGER DEFAULT 0,
  times_applied         INTEGER DEFAULT 0,
  times_prevented_loss  INTEGER DEFAULT 0,
  validated             INTEGER DEFAULT 0,
  deprecated            INTEGER DEFAULT 0,
  created_at            TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lessons_category ON lessons(category);
CREATE INDEX IF NOT EXISTS idx_lessons_severity ON lessons(severity);

-- ─── OPERATING RULES ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS operating_rules (
  id                    TEXT PRIMARY KEY,
  rule_text             TEXT NOT NULL,
  rule_type             TEXT NOT NULL,
  scope                 TEXT NOT NULL,
  priority              INTEGER DEFAULT 5,
  source                TEXT NOT NULL,
  source_id             TEXT,
  violations_prevented  INTEGER DEFAULT 0,
  times_applied         INTEGER DEFAULT 0,
  active                INTEGER DEFAULT 1,
  deprecated_at         TEXT,
  created_at            TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rules_scope  ON operating_rules(scope);
CREATE INDEX IF NOT EXISTS idx_rules_active ON operating_rules(active);

-- ─── ORG STATE ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS org_state (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ─── OPERATOR EVENTS ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS operator_events (
  id         TEXT PRIMARY KEY,
  ts         TEXT NOT NULL,
  category   TEXT NOT NULL,
  severity   TEXT NOT NULL,
  subsystem  TEXT NOT NULL,
  reason     TEXT NOT NULL,
  metadata   TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_opevents_ts       ON operator_events(ts DESC);
CREATE INDEX IF NOT EXISTS idx_opevents_category ON operator_events(category);
CREATE INDEX IF NOT EXISTS idx_opevents_severity ON operator_events(severity);

-- ─── INTELLIGENCE SUPERVISOR ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS intelligence_runs (
  id                  TEXT PRIMARY KEY,
  mission_id          TEXT NOT NULL,
  source              TEXT NOT NULL,
  scope               TEXT NOT NULL,
  status              TEXT NOT NULL,
  advisory_only       INTEGER NOT NULL DEFAULT 1,
  provider_status     TEXT NOT NULL DEFAULT 'unknown',
  mission             TEXT NOT NULL,
  candidate_summary   TEXT,
  recommended_prompt  TEXT,
  recommended_rules   TEXT,
  score               DOUBLE PRECISION,
  risk_notes          TEXT,
  justification       TEXT,
  proposed_changes    TEXT,
  artifacts           TEXT,
  created_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_intelligence_runs_scope_created
  ON intelligence_runs(scope, created_at DESC);

CREATE TABLE IF NOT EXISTS intelligence_policy_applies (
  id                TEXT PRIMARY KEY,
  run_id            TEXT NOT NULL,
  scope             TEXT NOT NULL,
  status            TEXT NOT NULL,
  applied_overrides TEXT NOT NULL,
  applied_by        TEXT NOT NULL DEFAULT 'operator',
  created_at        TEXT NOT NULL,
  expires_at        TEXT
);

CREATE INDEX IF NOT EXISTS idx_intelligence_policy_applies_scope_created
  ON intelligence_policy_applies(scope, created_at DESC);

-- ─── AGENT DECISIONS ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agent_decisions (
  id              TEXT PRIMARY KEY,
  timestamp       BIGINT NOT NULL,
  ticker          TEXT NOT NULL,
  agent_name      TEXT NOT NULL,
  signal          TEXT NOT NULL,
  confidence      DOUBLE PRECISION NOT NULL,
  reasoning_json  TEXT NOT NULL,
  market_price    DOUBLE PRECISION,
  market_category TEXT,
  outcome         TEXT,
  resolved_at     BIGINT
);

CREATE INDEX IF NOT EXISTS idx_decisions_ticker  ON agent_decisions(ticker);
CREATE INDEX IF NOT EXISTS idx_decisions_agent   ON agent_decisions(agent_name);
CREATE INDEX IF NOT EXISTS idx_decisions_ts      ON agent_decisions(timestamp);

-- ─── AGENT PERFORMANCE ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agent_performance (
  agent_name           TEXT PRIMARY KEY,
  total_predictions    INTEGER NOT NULL DEFAULT 0,
  correct_predictions  INTEGER NOT NULL DEFAULT 0,
  accuracy_score       DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  avg_confidence       DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  brier_score          DOUBLE PRECISION NOT NULL DEFAULT 0.25,
  updated_at           BIGINT NOT NULL
);

-- ─── TRADE OUTCOMES ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS trade_outcomes (
  id                TEXT PRIMARY KEY,
  trade_id          TEXT NOT NULL UNIQUE,
  agent_source      TEXT NOT NULL DEFAULT 'market-agent-1',
  market_source     TEXT NOT NULL DEFAULT 'unknown',
  market_category   TEXT NOT NULL DEFAULT 'general',
  recorded_at       TEXT NOT NULL,
  entry_confidence  DOUBLE PRECISION NOT NULL,
  confidence_band   TEXT NOT NULL DEFAULT 'UNKNOWN',
  pnl_realized      DOUBLE PRECISION NOT NULL DEFAULT 0,
  pnl_pct           DOUBLE PRECISION NOT NULL DEFAULT 0,
  duration_hours    DOUBLE PRECISION NOT NULL DEFAULT 0,
  outcome_result    TEXT NOT NULL,
  market_snapshot   TEXT NOT NULL DEFAULT '{}'
);

-- ─── SEEDS ───────────────────────────────────────────────────────────────────

INSERT INTO agent_profiles (id, name, role, department, level, created_at)
VALUES
  ('market-agent-1',              'Market Scanner',         'trader',     'prediction_markets', 1, NOW()::TEXT),
  ('research-agent-1',            'Research Intel',         'researcher', 'research',           1, NOW()::TEXT),
  ('ceo-agent',                   'Genesis CEO',            'ceo',        'executive',          5, NOW()::TEXT),
  ('sentinel',                    'Sentinel',               'guardian',   'operations',         3, NOW()::TEXT),
  ('marketing-agent',             'Marketing Agent',        'marketer',   'marketing',          1, NOW()::TEXT),
  ('scalping-engine-1',           'Scalping Engine',        'trader',     'crypto_scalping',    1, NOW()::TEXT),
  ('swing-engine-1',              'Swing Engine',           'trader',     'crypto_scalping',    1, NOW()::TEXT),
  ('breakout-engine-1',           'Breakout Engine',        'trader',     'crypto_scalping',    1, NOW()::TEXT),
  ('event-alpha-1',               'Event Alpha Engine',     'trader',     'prediction_markets', 1, NOW()::TEXT),
  ('futures-breakout-short-0',    'Futures Breakout Micro', 'trader',     'crypto_futures',     1, NOW()::TEXT),
  ('futures-breakout-short-1',    'Futures Breakout Core',  'trader',     'crypto_futures',     1, NOW()::TEXT),
  ('futures-breakout-short-2',    'Futures Breakout Alt',   'trader',     'crypto_futures',     1, NOW()::TEXT),
  ('futures-breakout-long-1',     'Futures Breakout Long',  'trader',     'crypto_futures',     1, NOW()::TEXT)
ON CONFLICT (id) DO NOTHING;

INSERT INTO operating_rules (id, rule_text, rule_type, scope, priority, source, created_at)
VALUES
  ('rule-survival',   'Never risk more than 5% of available capital on a single trade', 'hard_constraint', 'prediction_markets', 1, 'constitution', NOW()::TEXT),
  ('rule-confidence', 'Never open a trade with confidence below 0.65',                  'hard_constraint', 'prediction_markets', 1, 'constitution', NOW()::TEXT),
  ('rule-evidence',   'Require minimum 2 independent signals before any trade',          'hard_constraint', 'prediction_markets', 1, 'constitution', NOW()::TEXT),
  ('rule-max-trades', 'Never hold more than 5 open trades simultaneously',               'hard_constraint', 'prediction_markets', 2, 'constitution', NOW()::TEXT),
  ('rule-paper-only', 'Paper trading only. No real money until 3 months profitable',     'hard_constraint', 'all',                1, 'constitution', NOW()::TEXT),
  ('rule-horizon',    'Avoid markets resolving more than 45 days out',                   'soft_preference', 'prediction_markets', 3, 'constitution', NOW()::TEXT),
  ('rule-liquidity',  'Avoid markets with total liquidity below $5000',                  'soft_preference', 'prediction_markets', 3, 'constitution', NOW()::TEXT),
  ('rule-repeat',     'Before any trade, check mistake_patterns for similar conditions', 'hard_constraint', 'prediction_markets', 1, 'constitution', NOW()::TEXT)
ON CONFLICT (id) DO NOTHING;
