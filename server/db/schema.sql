-- Genesis HQ Memory Database Schema
-- SQLite via better-sqlite3 — local-first, zero cost, scales to millions of rows
-- ============================================================================

PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;        -- fast enough, safe enough

-- ─── AGENTS ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agent_profiles (
  id              TEXT PRIMARY KEY,          -- 'market-agent-1', 'ceo-agent'
  name            TEXT NOT NULL,
  role            TEXT NOT NULL,             -- 'trader', 'researcher', 'ceo', 'sentinel'
  department      TEXT NOT NULL,             -- 'prediction_markets', 'research', etc.
  level           INTEGER NOT NULL DEFAULT 1,
  status          TEXT NOT NULL DEFAULT 'active', -- 'active', 'paused', 'retrained', 'retired'
  budget_pct      REAL NOT NULL DEFAULT 0.05,     -- % of total capital allowed
  -- Skills (0.0 to 1.0, start at 0.3)
  skill_market_selection  REAL DEFAULT 0.3,
  skill_timing            REAL DEFAULT 0.3,
  skill_position_sizing   REAL DEFAULT 0.3,
  skill_signal_reading    REAL DEFAULT 0.3,
  skill_pattern_recog     REAL DEFAULT 0.3,
  -- Lifetime stats
  total_trades    INTEGER DEFAULT 0,
  wins            INTEGER DEFAULT 0,
  losses          INTEGER DEFAULT 0,
  total_pnl       REAL DEFAULT 0.0,
  win_streak      INTEGER DEFAULT 0,
  loss_streak     INTEGER DEFAULT 0,
  max_win_streak  INTEGER DEFAULT 0,
  max_loss_streak INTEGER DEFAULT 0,
  calibration_score REAL DEFAULT 0.5,        -- accuracy of stated confidence
  created_at      TEXT NOT NULL,
  last_active     TEXT
);

-- ─── TRADING MEMORY ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS trades (
  id              TEXT PRIMARY KEY,
  agent_id        TEXT REFERENCES agent_profiles(id),
  -- Market info
  market_id       TEXT NOT NULL,
  market_source   TEXT NOT NULL,             -- 'polymarket', 'kalshi'
  market_question TEXT NOT NULL,
  market_category TEXT DEFAULT 'general',
  -- Trade parameters
  outcome         TEXT NOT NULL,             -- 'YES', 'NO'
  entry_price     REAL NOT NULL,
  exit_price      REAL,
  shares          REAL NOT NULL,
  capital_used    REAL NOT NULL,
  -- Decision context (what the agent knew when it decided)
  confidence      REAL NOT NULL,
  reason          TEXT NOT NULL,
  evidence        TEXT NOT NULL,             -- JSON array of strings
  signals_used    TEXT DEFAULT '[]',         -- JSON array of signal IDs
  lessons_applied TEXT DEFAULT '[]',         -- JSON array of lesson IDs consulted
  rules_applied   TEXT DEFAULT '[]',         -- JSON array of rule IDs consulted
  -- Resolution
  status          TEXT NOT NULL DEFAULT 'open', -- 'open', 'closed', 'expired', 'vetoed'
  resolved_outcome TEXT,                     -- 'YES', 'NO' (actual result)
  pnl             REAL,
  -- Timestamps
  opened_at       TEXT NOT NULL,
  closed_at       TEXT,
  days_to_close   INTEGER,
  -- Link to lesson
  lesson_id       TEXT,
  -- External exchange order tracking (for real trading)
  external_order_id TEXT UNIQUE,              -- Kalshi orderId, Polymarket order ID, etc.
  trade_type      TEXT DEFAULT 'paper',       -- 'paper', 'real'
  mode            TEXT,                       -- 'real', 'paper', 'real_failed'
  exit_reason     TEXT                        -- Why the trade closed
);

CREATE INDEX IF NOT EXISTS idx_trades_agent    ON trades(agent_id);
CREATE INDEX IF NOT EXISTS idx_trades_status   ON trades(status);
CREATE INDEX IF NOT EXISTS idx_trades_category ON trades(market_category);
CREATE INDEX IF NOT EXISTS idx_trades_opened   ON trades(opened_at);

-- ─── LESSONS — extracted from closed trades ───────────────────────────────────

CREATE TABLE IF NOT EXISTS lessons (
  id              TEXT PRIMARY KEY,
  -- Source
  trade_id        TEXT REFERENCES trades(id),
  agent_id        TEXT REFERENCES agent_profiles(id),
  source_type     TEXT NOT NULL,             -- 'trade_loss', 'trade_win', 'debate', 'founder', 'self_review'
  -- The 4 mandatory questions (for losses)
  why_failed      TEXT,                      -- "Market resolved on news we didn't have"
  signal_wrong    TEXT,                      -- "Volume was misleading — low liquidity not real volume"
  what_change     TEXT,                      -- "Check liquidity separately from volume"
  new_rule        TEXT,                      -- "Only trade markets with liquidity > $10k"
  -- Summary
  lesson_text     TEXT NOT NULL,             -- Single clear sentence
  category        TEXT NOT NULL,             -- 'market_selection', 'timing', 'confidence', 'signal', 'position'
  severity        TEXT NOT NULL DEFAULT 'info', -- 'info', 'warning', 'critical'
  -- Effectiveness tracking
  times_retrieved INTEGER DEFAULT 0,         -- how many times pulled into a prompt
  times_applied   INTEGER DEFAULT 0,         -- how many times agent acted on it
  times_prevented_loss INTEGER DEFAULT 0,    -- how many times it prevented a repeat mistake
  -- Validation
  validated       INTEGER DEFAULT 0,         -- 1 if founder confirmed it's useful
  deprecated      INTEGER DEFAULT 0,         -- 1 if no longer relevant
  -- Timestamps
  created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lessons_category ON lessons(category);
CREATE INDEX IF NOT EXISTS idx_lessons_severity ON lessons(severity);
CREATE INDEX IF NOT EXISTS idx_lessons_source   ON lessons(source_type);

-- ─── MISTAKE PATTERNS — active veto rules ────────────────────────────────────

CREATE TABLE IF NOT EXISTS mistake_patterns (
  id              TEXT PRIMARY KEY,
  -- Pattern description
  pattern_hash    TEXT UNIQUE NOT NULL,      -- hash of (category + condition_key + range)
  pattern_desc    TEXT NOT NULL,             -- human readable: "Low-liquidity crypto market, price 0.8-0.95"
  category        TEXT NOT NULL,             -- market category where this applies
  -- Conditions that trigger the veto (JSON)
  conditions      TEXT NOT NULL,             -- {"min_price": 0.8, "max_price": 1.0, "min_volume": 0, "max_volume": 5000}
  -- Effectiveness
  triggered_count INTEGER DEFAULT 0,         -- how many times this veto fired
  true_positive   INTEGER DEFAULT 0,         -- times veto was correct (market did go wrong)
  false_positive  INTEGER DEFAULT 0,         -- times veto was wrong (market would have won)
  -- Source lesson
  lesson_id       TEXT REFERENCES lessons(id),
  -- Status
  active          INTEGER DEFAULT 1,
  created_at      TEXT NOT NULL,
  last_triggered  TEXT
);

CREATE INDEX IF NOT EXISTS idx_patterns_category ON mistake_patterns(category);
CREATE INDEX IF NOT EXISTS idx_patterns_active   ON mistake_patterns(active);

-- ─── OPERATING RULES — dynamically generated do/don't rules ──────────────────

CREATE TABLE IF NOT EXISTS operating_rules (
  id              TEXT PRIMARY KEY,
  -- Rule content
  rule_text       TEXT NOT NULL,             -- "Never trade markets with < 10k liquidity"
  rule_type       TEXT NOT NULL,             -- 'hard_constraint', 'soft_preference', 'strategy'
  scope           TEXT NOT NULL,             -- 'all', 'prediction_markets', 'marketing', etc.
  priority        INTEGER DEFAULT 5,         -- 1=highest, 10=lowest
  -- Source
  source          TEXT NOT NULL,             -- 'lesson', 'founder', 'ceo_agent', 'manual'
  source_id       TEXT,                      -- lesson_id or founder_order_id
  -- Effectiveness
  violations_prevented INTEGER DEFAULT 0,
  times_applied   INTEGER DEFAULT 0,
  -- Status
  active          INTEGER DEFAULT 1,
  deprecated_at   TEXT,
  created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rules_scope  ON operating_rules(scope);
CREATE INDEX IF NOT EXISTS idx_rules_active ON operating_rules(active);
CREATE INDEX IF NOT EXISTS idx_rules_type   ON operating_rules(rule_type);

-- ─── SIGNALS — track which signals proved accurate ───────────────────────────

CREATE TABLE IF NOT EXISTS signals (
  id              TEXT PRIMARY KEY,
  source          TEXT NOT NULL,             -- 'polymarket', 'news', 'reddit', 'manual'
  signal_text     TEXT NOT NULL,             -- "BTC volume spike on Polymarket"
  category        TEXT NOT NULL,
  confidence      REAL NOT NULL,
  -- Outcome tracking
  trade_id        TEXT REFERENCES trades(id),
  proved_correct  INTEGER,                   -- NULL=unknown, 1=yes, 0=no
  -- Metadata
  created_at      TEXT NOT NULL
);

-- ─── FOUNDER INSTRUCTIONS ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS founder_orders (
  id              TEXT PRIMARY KEY,
  instruction     TEXT NOT NULL,             -- "Focus only on sports markets this week"
  priority        TEXT NOT NULL DEFAULT 'high', -- 'critical', 'high', 'normal'
  -- Parsing
  parsed_action   TEXT,                      -- JSON: {type:'pause_dept', dept:'markets'}
  -- Execution
  acknowledged    INTEGER DEFAULT 0,
  executed        INTEGER DEFAULT 0,
  execution_notes TEXT,
  outcome         TEXT,                      -- what happened after it was executed
  -- Timestamps
  issued_at       TEXT NOT NULL,
  executed_at     TEXT,
  expires_at      TEXT                       -- NULL = permanent until manually cleared
);

-- ─── BUSINESS MEMORY ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS business_memory (
  id              TEXT PRIMARY KEY,
  opportunity_type TEXT NOT NULL,            -- 'dropshipping', 'affiliate', 'consulting', 'saas'
  description     TEXT NOT NULL,
  source          TEXT,                      -- where the idea came from
  -- Evaluation
  tried           INTEGER DEFAULT 0,
  effort_hours    REAL DEFAULT 0,
  revenue         REAL DEFAULT 0,
  outcome         TEXT,                      -- 'won', 'lost', 'abandoned', 'ongoing'
  lessons         TEXT,                      -- what was learned
  -- Timestamps
  created_at      TEXT NOT NULL,
  last_updated    TEXT
);

-- ─── MARKETING MEMORY ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS marketing_memory (
  id              TEXT PRIMARY KEY,
  content_type    TEXT NOT NULL,             -- 'tweet', 'linkedin', 'thread', 'insight'
  content_text    TEXT NOT NULL,
  channel         TEXT,                      -- 'twitter', 'linkedin', null=not posted yet
  -- Performance
  posted          INTEGER DEFAULT 0,
  impressions     INTEGER DEFAULT 0,
  engagement      INTEGER DEFAULT 0,
  -- Analysis
  what_worked     TEXT,
  what_failed     TEXT,
  agent_id        TEXT REFERENCES agent_profiles(id),
  created_at      TEXT NOT NULL,
  posted_at       TEXT
);

-- ─── TEAM / DEBATE MEMORY ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS team_memory (
  id              TEXT PRIMARY KEY,
  event_type      TEXT NOT NULL,             -- 'debate', 'consensus', 'disagreement', 'review'
  participants    TEXT NOT NULL,             -- JSON array of agent_ids
  topic           TEXT NOT NULL,
  summary         TEXT,
  outcome         TEXT,
  decision_made   TEXT,
  created_at      TEXT NOT NULL
);

-- ─── CAPITAL HISTORY ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS capital_history (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  total           REAL NOT NULL,
  available       REAL NOT NULL,
  in_trades       REAL NOT NULL DEFAULT 0,
  bucket_reserve  REAL DEFAULT 0,
  bucket_upgrade  REAL DEFAULT 0,
  bucket_exp      REAL DEFAULT 0,
  bucket_expand   REAL DEFAULT 0,
  bucket_liquid   REAL DEFAULT 0,
  note            TEXT,
  recorded_at     TEXT NOT NULL
);

-- ─── FTS5 — full-text search across ALL memory ───────────────────────────────
-- Allows: "find all memories about crypto markets where we lost"

CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
  content,          -- the text to search
  category,         -- which memory type
  source_id,        -- ID in the original table
  source_table,     -- which table it came from
  tokenize = 'porter ascii'
);

-- ─── CEO DIRECTIVES ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ceo_directives (
  id              TEXT PRIMARY KEY,
  -- Dept status (active/paused/focused)
  dept_markets    TEXT DEFAULT 'active',
  dept_research   TEXT DEFAULT 'active',
  dept_marketing  TEXT DEFAULT 'active',
  dept_sales      TEXT DEFAULT 'paused',
  -- Strategy
  min_confidence  REAL DEFAULT 0.65,
  max_open_trades INTEGER DEFAULT 5,
  max_risk_pct    REAL DEFAULT 0.05,
  focus_categories TEXT DEFAULT '[]',        -- JSON array of priority categories
  -- Notes
  strategy_notes  TEXT,
  generated_by    TEXT DEFAULT 'ceo_agent',
  created_at      TEXT NOT NULL
);

-- ─── SKILL VERSIONS — SkillOpt deployment + rollback ledger ───────────────────

CREATE TABLE IF NOT EXISTS skill_versions (
  id              TEXT PRIMARY KEY,
  agent           TEXT NOT NULL,             -- 'polymarket_agent', etc.
  version         INTEGER NOT NULL,
  parent_version  INTEGER,
  file_path       TEXT NOT NULL,             -- skills/<agent>/skill_vNNNN.md
  status          TEXT NOT NULL DEFAULT 'candidate', -- 'candidate','deployed','rejected','reverted'
  -- Validation metrics (held-out)
  brier           REAL,
  win_rate        REAL,
  calibration     REAL,
  val_n           INTEGER DEFAULT 0,
  -- Gate result
  gate_passed     INTEGER DEFAULT 0,
  gate_notes      TEXT,
  -- Provenance
  resolves_lessons TEXT DEFAULT '[]',        -- JSON array of lesson_ids this edit addresses
  created_at      TEXT NOT NULL,
  deployed_at     TEXT,
  reverted_at     TEXT,
  reason          TEXT
);

CREATE INDEX IF NOT EXISTS idx_skill_agent  ON skill_versions(agent);
CREATE INDEX IF NOT EXISTS idx_skill_status ON skill_versions(status);

-- Seed default agent profile if not exists
INSERT OR IGNORE INTO agent_profiles (id, name, role, department, level, created_at)
VALUES
  ('market-agent-1',  'Market Scanner',  'trader',     'prediction_markets', 1, datetime('now')),
  ('research-agent-1','Research Intel',  'researcher', 'research',           1, datetime('now')),
  ('ceo-agent',       'Genesis CEO',     'ceo',        'executive',          5, datetime('now')),
  ('sentinel',        'Sentinel',        'guardian',   'operations',         3, datetime('now')),
  ('marketing-agent', 'Marketing Agent', 'marketer',   'marketing',          1, datetime('now')),
  -- Phase 6A paper-training engines. Without these rows the trades.agent_id
  -- FOREIGN KEY fails and EVERY engine execution is silently rejected.
  ('scalping-engine-1', 'Scalping Engine',   'trader', 'crypto_scalping',    1, datetime('now')),
  ('swing-engine-1',    'Swing Engine',      'trader', 'crypto_scalping',    1, datetime('now')),
  ('breakout-engine-1', 'Breakout Engine',   'trader', 'crypto_scalping',    1, datetime('now')),
  ('event-alpha-1',     'Event Alpha Engine','trader', 'prediction_markets', 1, datetime('now')),
  ('futures-breakout-short-0', 'Futures Breakout Micro', 'trader', 'crypto_futures', 1, datetime('now')),
  ('futures-breakout-short-1', 'Futures Breakout Core',  'trader', 'crypto_futures', 1, datetime('now')),
  ('futures-breakout-short-2', 'Futures Breakout Alt',   'trader', 'crypto_futures', 1, datetime('now')),
  ('futures-breakout-long-1',  'Futures Breakout Long',  'trader', 'crypto_futures', 1, datetime('now'));

-- Seed initial operating rules from Constitution
INSERT OR IGNORE INTO operating_rules (id, rule_text, rule_type, scope, priority, source, created_at)
VALUES
  ('rule-survival',    'Never risk more than 5% of available capital on a single trade', 'hard_constraint', 'prediction_markets', 1, 'constitution', datetime('now')),
  ('rule-confidence',  'Never open a trade with confidence below 0.65', 'hard_constraint', 'prediction_markets', 1, 'constitution', datetime('now')),
  ('rule-evidence',    'Require minimum 2 independent signals before any trade', 'hard_constraint', 'prediction_markets', 1, 'constitution', datetime('now')),
  ('rule-max-trades',  'Never hold more than 5 open trades simultaneously', 'hard_constraint', 'prediction_markets', 2, 'constitution', datetime('now')),
  ('rule-paper-only',  'Paper trading only. No real money until 3 months profitable paper record', 'hard_constraint', 'all', 1, 'constitution', datetime('now')),
  ('rule-horizon',     'Avoid markets resolving more than 45 days out', 'soft_preference', 'prediction_markets', 3, 'constitution', datetime('now')),
  ('rule-liquidity',   'Avoid markets with total liquidity below $5000', 'soft_preference', 'prediction_markets', 3, 'constitution', datetime('now')),
  ('rule-repeat',      'Before any trade, check mistake_patterns for similar conditions', 'hard_constraint', 'prediction_markets', 1, 'constitution', datetime('now'));

-- ─── Crypto scalping columns (added 2026-06-04) ──────────────────────────────
-- These are NULL for prediction market trades; populated only for crypto_scalp trades.
ALTER TABLE trades ADD COLUMN asset_pair   TEXT;
ALTER TABLE trades ADD COLUMN trade_type   TEXT DEFAULT 'prediction';
ALTER TABLE trades ADD COLUMN target_price REAL;
ALTER TABLE trades ADD COLUMN stop_price   REAL;
ALTER TABLE trades ADD COLUMN exit_reason  TEXT;

-- 24h quote volume at entry — lets us model realistic exit slippage on close.
ALTER TABLE trades ADD COLUMN entry_volume24h REAL;
ALTER TABLE trades ADD COLUMN instrument_type TEXT DEFAULT 'spot';
ALTER TABLE trades ADD COLUMN exchange TEXT;
ALTER TABLE trades ADD COLUMN margin_mode TEXT DEFAULT 'cash';
ALTER TABLE trades ADD COLUMN leverage REAL DEFAULT 1;
ALTER TABLE trades ADD COLUMN notional_usd REAL;
ALTER TABLE trades ADD COLUMN funding_rate REAL DEFAULT 0;
ALTER TABLE trades ADD COLUMN funding_paid REAL DEFAULT 0;
ALTER TABLE trades ADD COLUMN liquidation_price REAL;
ALTER TABLE trades ADD COLUMN maintenance_margin REAL;

-- ─── ORG STATE — persists org mode, departments, focus, goal across restarts ────
CREATE TABLE IF NOT EXISTS org_state (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- —— INTELLIGENCE SUPERVISOR RUNS — recommendation-only policy packages ——
CREATE TABLE IF NOT EXISTS intelligence_runs (
  id                TEXT PRIMARY KEY,
  mission_id        TEXT NOT NULL,
  source            TEXT NOT NULL,
  scope             TEXT NOT NULL,
  status            TEXT NOT NULL,          -- 'draft' | 'recommended' | 'archived' | 'rejected' | 'degraded' | 'failed'
  advisory_only     INTEGER NOT NULL DEFAULT 1,
  provider_status   TEXT NOT NULL DEFAULT 'unknown',
  mission           TEXT NOT NULL,          -- JSON mission snapshot
  candidate_summary TEXT,                   -- JSON best candidate summary
  recommended_prompt TEXT,
  recommended_rules TEXT,                   -- JSON string[]
  score             REAL,
  risk_notes        TEXT,                   -- JSON string[]
  justification     TEXT,                   -- JSON string[]
  proposed_changes  TEXT,                   -- JSON proposed runtime changes
  artifacts         TEXT,                   -- JSON provider artifacts
  created_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_intelligence_runs_scope_created
  ON intelligence_runs(scope, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_intelligence_runs_scope_status_created
  ON intelligence_runs(scope, status, created_at DESC);

CREATE TABLE IF NOT EXISTS intelligence_policy_applies (
  id                TEXT PRIMARY KEY,
  run_id            TEXT NOT NULL,
  scope             TEXT NOT NULL,
  status            TEXT NOT NULL,          -- 'applied'
  applied_overrides TEXT NOT NULL,          -- JSON changes applied
  applied_by        TEXT NOT NULL DEFAULT 'operator',
  created_at        TEXT NOT NULL,
  expires_at        TEXT
);

CREATE INDEX IF NOT EXISTS idx_intelligence_policy_applies_scope_created
  ON intelligence_policy_applies(scope, created_at DESC);

-- ─── AGENT DECISIONS — full audit trail of every signal emitted ───────────────
-- Populated by MarketAnalystAgent (and future agents) on every BUY/SELL signal.
-- outcome / resolved_at set when the linked trade closes.
-- Idempotency: INSERT OR IGNORE + deterministic ID (agent:ticker:signal:window).

CREATE TABLE IF NOT EXISTS agent_decisions (
  id               TEXT    PRIMARY KEY,
  timestamp        INTEGER NOT NULL,
  ticker           TEXT    NOT NULL,
  agent_name       TEXT    NOT NULL,
  signal           TEXT    NOT NULL,   -- 'BUY' | 'SELL'
  confidence       REAL    NOT NULL,
  reasoning_json   TEXT    NOT NULL,   -- JSON array of strings
  market_price     REAL,               -- yesPrice at decision time
  market_category  TEXT,
  outcome          TEXT,               -- NULL until resolved: 'WIN' | 'LOSS' | 'NEUTRAL'
  resolved_at      INTEGER             -- Unix ms, NULL until resolved
);

CREATE INDEX IF NOT EXISTS idx_decisions_ticker  ON agent_decisions(ticker);
CREATE INDEX IF NOT EXISTS idx_decisions_agent   ON agent_decisions(agent_name);
CREATE INDEX IF NOT EXISTS idx_decisions_ts      ON agent_decisions(timestamp);
CREATE INDEX IF NOT EXISTS idx_decisions_signal  ON agent_decisions(signal);
CREATE INDEX IF NOT EXISTS idx_decisions_outcome ON agent_decisions(outcome);

-- ─── AGENT PERFORMANCE — rolling accuracy per agent ──────────────────────────
-- Recalculated from agent_decisions ground truth after every market resolution.
-- Never incremented — always a full recomputation (no counter drift).
--
-- brier_score: mean((confidence - actual)²) — lower = better calibration
--              0.25 = random, 0.0 = perfect. Added to the user-specified fields.

CREATE TABLE IF NOT EXISTS agent_performance (
  agent_name           TEXT    PRIMARY KEY,
  total_predictions    INTEGER NOT NULL DEFAULT 0,
  correct_predictions  INTEGER NOT NULL DEFAULT 0,
  accuracy_score       REAL    NOT NULL DEFAULT 0.0,   -- correct / total  (0.0–1.0)
  avg_confidence       REAL    NOT NULL DEFAULT 0.0,   -- mean stated confidence
  brier_score          REAL    NOT NULL DEFAULT 0.25,  -- calibration score (lower = better)
  updated_at           INTEGER NOT NULL                -- Unix ms
);

-- ─── CONSENSUS DECISIONS — multi-agent aggregated signal ──────────────────────
-- One row per ticker per 15-min window. INSERT OR REPLACE so the decision is
-- refreshed if resolveConsensus is called again within the same window.
-- vetoed = 1 when a BLOCK signal above the threshold overrides all scoring.

CREATE TABLE IF NOT EXISTS consensus_decisions (
  id             TEXT    PRIMARY KEY,          -- '{ticker}:{windowBucket}'
  ticker         TEXT    NOT NULL,
  timestamp      INTEGER NOT NULL,             -- Unix ms
  decision       TEXT    NOT NULL,             -- 'BUY' | 'SELL' | 'HOLD'
  buy_score      REAL    NOT NULL DEFAULT 0.0, -- total weighted BUY contribution
  sell_score     REAL    NOT NULL DEFAULT 0.0, -- total weighted SELL contribution
  hold_score     REAL    NOT NULL DEFAULT 0.0, -- total weighted HOLD contribution
  vetoed         INTEGER NOT NULL DEFAULT 0,   -- 1 if any agent vetoed
  veto_by        TEXT,                         -- agent_name that fired the veto
  signal_count   INTEGER NOT NULL DEFAULT 0,   -- how many signals were aggregated
  breakdown_json TEXT    NOT NULL DEFAULT '[]',-- [{agentName, signal, confidence, weight, contribution}]
  explanation    TEXT    NOT NULL DEFAULT ''   -- human-readable decision rationale
);

-- ─── TRADE OUTCOMES — closed-loop learning records ────────────────────────────
-- Append-only. One row per resolved trade. Never updated after insert.
-- Primary key = 'outcome-{tradeId}' prevents duplicate recording.

CREATE TABLE IF NOT EXISTS trade_outcomes (
  id               TEXT PRIMARY KEY,           -- 'outcome-{tradeId}'
  trade_id         TEXT NOT NULL UNIQUE,
  agent_source     TEXT NOT NULL DEFAULT 'market-agent-1',
  market_source    TEXT NOT NULL DEFAULT 'unknown',
  market_category  TEXT NOT NULL DEFAULT 'general',
  recorded_at      TEXT NOT NULL,              -- ISO 8601
  entry_confidence REAL NOT NULL,              -- arbiter float 0.0-1.0
  confidence_band  TEXT NOT NULL DEFAULT 'UNKNOWN', -- BLOCK/LOW_CONFIDENCE/CAUTION/GOOD_SETUP/HIGH_CONVICTION
  pnl_realized     REAL NOT NULL DEFAULT 0,    -- USD
  pnl_pct          REAL NOT NULL DEFAULT 0,    -- fraction of capital used
  duration_hours   REAL NOT NULL DEFAULT 0,
  outcome_result   TEXT NOT NULL,              -- 'WIN' | 'LOSS' | 'NEUTRAL'
  market_snapshot  TEXT NOT NULL DEFAULT '{}'  -- JSON: source, category, entryPrice
);

CREATE INDEX IF NOT EXISTS idx_outcomes_agent  ON trade_outcomes (agent_source, recorded_at);
CREATE INDEX IF NOT EXISTS idx_outcomes_band   ON trade_outcomes (confidence_band, recorded_at);
CREATE INDEX IF NOT EXISTS idx_outcomes_result ON trade_outcomes (outcome_result, recorded_at);

CREATE INDEX IF NOT EXISTS idx_consensus_ticker    ON consensus_decisions(ticker);
CREATE INDEX IF NOT EXISTS idx_consensus_timestamp ON consensus_decisions(timestamp);
CREATE INDEX IF NOT EXISTS idx_consensus_decision  ON consensus_decisions(decision);

-- ─── OPERATOR EVENTS — append-only observability timeline ─────────────────────
-- Every meaningful system decision is logged here so operators can answer WHY.
-- Append-only. Prune after 30 days if needed.

CREATE TABLE IF NOT EXISTS operator_events (
  id         TEXT PRIMARY KEY,
  ts         TEXT NOT NULL,
  category   TEXT NOT NULL,
  severity   TEXT NOT NULL,
  subsystem  TEXT NOT NULL,
  reason     TEXT NOT NULL,
  metadata   TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_opevents_ts       ON operator_events(ts);
CREATE INDEX IF NOT EXISTS idx_opevents_category ON operator_events(category);
CREATE INDEX IF NOT EXISTS idx_opevents_severity ON operator_events(severity);

-- Product foundation: wallet-first identity, owner console, billing hooks,
-- paper sandbox accounts, and global learning consent. These tables do not
-- enable fees, live trading, or custody; they only create audited structure.

CREATE TABLE IF NOT EXISTS users (
  id                TEXT PRIMARY KEY,
  display_name      TEXT,
  status            TEXT NOT NULL DEFAULT 'active',
  role              TEXT NOT NULL DEFAULT 'user',
  primary_wallet_id TEXT,
  created_at        TEXT NOT NULL,
  last_seen_at      TEXT,
  metadata          TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_role   ON users(role);

CREATE TABLE IF NOT EXISTS user_wallets (
  id                    TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL REFERENCES users(id),
  chain                 TEXT NOT NULL,
  address               TEXT NOT NULL,
  address_normalized    TEXT NOT NULL,
  label                 TEXT,
  verified_by_signature INTEGER NOT NULL DEFAULT 0,
  verified_at           TEXT,
  last_seen_at          TEXT,
  revoked_at            TEXT,
  metadata              TEXT NOT NULL DEFAULT '{}',
  UNIQUE(chain, address_normalized)
);

CREATE INDEX IF NOT EXISTS idx_user_wallets_user  ON user_wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_user_wallets_chain ON user_wallets(chain, address_normalized);

CREATE TABLE IF NOT EXISTS wallet_sessions (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id),
  wallet_id       TEXT NOT NULL REFERENCES user_wallets(id),
  nonce_hash      TEXT NOT NULL,
  issued_at       TEXT NOT NULL,
  expires_at      TEXT NOT NULL,
  revoked_at      TEXT,
  ip_hash         TEXT,
  user_agent_hash TEXT,
  metadata        TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_wallet_sessions_user_expires ON wallet_sessions(user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_wallet_sessions_wallet       ON wallet_sessions(wallet_id);

CREATE TABLE IF NOT EXISTS admin_users (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  role       TEXT NOT NULL DEFAULT 'owner',
  status     TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_admin_users_status ON admin_users(status);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id              TEXT PRIMARY KEY,
  admin_user_id   TEXT NOT NULL REFERENCES admin_users(id),
  target_user_id  TEXT REFERENCES users(id),
  action          TEXT NOT NULL,
  reason          TEXT NOT NULL,
  metadata        TEXT NOT NULL DEFAULT '{}',
  created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_admin_audit_target  ON admin_audit_logs(target_user_id, created_at);

CREATE TABLE IF NOT EXISTS user_entitlements (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  plan          TEXT NOT NULL DEFAULT 'free',
  status        TEXT NOT NULL DEFAULT 'active',
  features      TEXT NOT NULL DEFAULT '[]',
  limits_json   TEXT NOT NULL DEFAULT '{}',
  billing_mode  TEXT NOT NULL DEFAULT 'free',
  fee_policy    TEXT NOT NULL DEFAULT 'disabled',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_entitlements_user ON user_entitlements(user_id, status);

CREATE TABLE IF NOT EXISTS billing_events (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id),
  wallet_id        TEXT REFERENCES user_wallets(id),
  event_type       TEXT NOT NULL,
  billing_mode     TEXT NOT NULL DEFAULT 'free',
  fee_policy       TEXT NOT NULL DEFAULT 'disabled',
  amount_usd       REAL NOT NULL DEFAULT 0,
  currency         TEXT NOT NULL DEFAULT 'USD',
  status           TEXT NOT NULL DEFAULT 'recorded',
  external_ref     TEXT,
  metadata         TEXT NOT NULL DEFAULT '{}',
  created_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_billing_events_user_created ON billing_events(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_billing_events_status       ON billing_events(status);

CREATE TABLE IF NOT EXISTS operation_intents (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES users(id),
  wallet_id           TEXT REFERENCES user_wallets(id),
  mode                TEXT NOT NULL DEFAULT 'paper',
  operation_type      TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'draft',
  requested_amount_usd REAL,
  max_loss_usd        REAL,
  fee_quote_json      TEXT NOT NULL DEFAULT '{}',
  consent_required    INTEGER NOT NULL DEFAULT 1,
  consented_at        TEXT,
  executed_at         TEXT,
  metadata            TEXT NOT NULL DEFAULT '{}',
  created_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_operation_intents_user_created ON operation_intents(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_operation_intents_mode_status  ON operation_intents(mode, status);

CREATE TABLE IF NOT EXISTS support_cases (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id),
  status         TEXT NOT NULL DEFAULT 'open',
  severity       TEXT NOT NULL DEFAULT 'normal',
  subject        TEXT NOT NULL,
  notes          TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  resolved_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_support_cases_user_status ON support_cases(user_id, status);

CREATE TABLE IF NOT EXISTS risk_flags (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id),
  wallet_id      TEXT REFERENCES user_wallets(id),
  flag_type      TEXT NOT NULL,
  severity       TEXT NOT NULL DEFAULT 'info',
  status         TEXT NOT NULL DEFAULT 'active',
  reason         TEXT NOT NULL,
  metadata       TEXT NOT NULL DEFAULT '{}',
  created_at     TEXT NOT NULL,
  resolved_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_risk_flags_user_status ON risk_flags(user_id, status);
CREATE INDEX IF NOT EXISTS idx_risk_flags_severity    ON risk_flags(severity, status);

CREATE TABLE IF NOT EXISTS wallet_snapshots (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id),
  wallet_id      TEXT NOT NULL REFERENCES user_wallets(id),
  chain          TEXT NOT NULL,
  source         TEXT NOT NULL,
  balances_json  TEXT NOT NULL DEFAULT '[]',
  total_usd      REAL,
  captured_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wallet_snapshots_wallet_time ON wallet_snapshots(wallet_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS memory_consent (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id),
  consent_type   TEXT NOT NULL DEFAULT 'global_learning',
  status         TEXT NOT NULL DEFAULT 'opt_out',
  scope          TEXT NOT NULL DEFAULT 'anonymous_aggregate',
  granted_at     TEXT,
  revoked_at     TEXT,
  metadata       TEXT NOT NULL DEFAULT '{}',
  UNIQUE(user_id, consent_type)
);

CREATE TABLE IF NOT EXISTS user_memory (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id),
  source_id      TEXT,
  source_type    TEXT NOT NULL,
  memory_type    TEXT NOT NULL,
  summary        TEXT NOT NULL,
  metrics_json   TEXT NOT NULL DEFAULT '{}',
  visibility     TEXT NOT NULL DEFAULT 'private',
  created_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_memory_user_created ON user_memory(user_id, created_at);

CREATE TABLE IF NOT EXISTS global_memory_candidates (
  id               TEXT PRIMARY KEY,
  source_user_id   TEXT REFERENCES users(id),
  source_memory_id TEXT REFERENCES user_memory(id),
  anonymized_key   TEXT NOT NULL,
  setup_key        TEXT NOT NULL,
  sample_size      INTEGER NOT NULL DEFAULT 0,
  expectancy       REAL,
  profit_factor    REAL,
  max_drawdown     REAL,
  score            REAL NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'candidate',
  reasons_json     TEXT NOT NULL DEFAULT '[]',
  created_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_global_memory_candidates_status_score ON global_memory_candidates(status, score DESC);

CREATE TABLE IF NOT EXISTS global_memory (
  id              TEXT PRIMARY KEY,
  candidate_id    TEXT REFERENCES global_memory_candidates(id),
  setup_key       TEXT NOT NULL,
  rule_text       TEXT NOT NULL,
  evidence_json   TEXT NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'active',
  created_at      TEXT NOT NULL,
  deprecated_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_global_memory_setup_status ON global_memory(setup_key, status);

CREATE TABLE IF NOT EXISTS paper_accounts (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id),
  wallet_id         TEXT REFERENCES user_wallets(id),
  label             TEXT,
  currency          TEXT NOT NULL DEFAULT 'USDT',
  start_balance     REAL NOT NULL DEFAULT 10000,
  current_equity    REAL NOT NULL DEFAULT 10000,
  max_balance       REAL NOT NULL DEFAULT 1000000,
  status            TEXT NOT NULL DEFAULT 'active',
  mode              TEXT NOT NULL DEFAULT 'paper',
  settings_json     TEXT NOT NULL DEFAULT '{}',
  created_at        TEXT NOT NULL,
  reset_at          TEXT
);

CREATE INDEX IF NOT EXISTS idx_paper_accounts_user_status ON paper_accounts(user_id, status);

CREATE TABLE IF NOT EXISTS paper_universe (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id),
  paper_account_id TEXT NOT NULL REFERENCES paper_accounts(id),
  symbol           TEXT NOT NULL,
  exchange         TEXT NOT NULL DEFAULT 'binance',
  enabled          INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL,
  UNIQUE(paper_account_id, exchange, symbol)
);

CREATE TABLE IF NOT EXISTS paper_agent_runs (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id),
  paper_account_id TEXT NOT NULL REFERENCES paper_accounts(id),
  agent_id         TEXT,
  status           TEXT NOT NULL DEFAULT 'queued',
  mode             TEXT NOT NULL DEFAULT 'paper',
  summary_json     TEXT NOT NULL DEFAULT '{}',
  started_at       TEXT,
  finished_at      TEXT,
  created_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_paper_agent_runs_user_created ON paper_agent_runs(user_id, created_at);

-- ─── STRATEGY PARAMETERS — per-venue trading configuration ───────────────────
-- One row per venue. Updated via /api/strategy-params API.

CREATE TABLE IF NOT EXISTS strategy_params (
  id                 TEXT PRIMARY KEY,
  venue              TEXT NOT NULL UNIQUE,   -- 'kalshi', 'polymarket', 'crypto'
  is_active          INTEGER NOT NULL DEFAULT 0, -- only one venue active at a time
  -- Entry criteria
  min_confidence     REAL NOT NULL DEFAULT 0.65,
  max_entry_price    REAL NOT NULL DEFAULT 0.90,
  min_entry_price    REAL NOT NULL DEFAULT 0.10,
  -- Position sizing
  max_position_usd   REAL NOT NULL DEFAULT 500,
  max_position_pct   REAL NOT NULL DEFAULT 0.05,
  max_open_trades    INTEGER NOT NULL DEFAULT 5,
  -- Exit rules
  stop_loss_pct      REAL NOT NULL DEFAULT 0.20, -- 20% loss = close
  take_profit_pct    REAL NOT NULL DEFAULT 0.50, -- 50% profit = close
  trailing_stop_pct  REAL,                        -- optional: trailing stop
  -- Holding time
  max_hold_days      INTEGER NOT NULL DEFAULT 45,
  -- Market criteria
  min_liquidity_usd  REAL NOT NULL DEFAULT 5000,
  min_volume_24h     REAL,                        -- optional volume check
  -- Venue-specific
  settings_json      TEXT NOT NULL DEFAULT '{}', -- {retryBackoffMs, maxRetries, ...}
  -- Metadata
  activated_at       TEXT,
  deactivated_at     TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_strategy_active ON strategy_params(venue, is_active);
