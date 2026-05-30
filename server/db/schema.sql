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
  lesson_id       TEXT
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
  ('marketing-agent', 'Marketing Agent', 'marketer',   'marketing',          1, datetime('now'));

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
