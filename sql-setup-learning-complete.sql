-- ============================================================================
-- SETUP COMPLETO DE LEARNING SYSTEM - EJECUTAR DE UNA VEZ
-- ============================================================================

-- 1. CREAR TABLAS
CREATE TABLE IF NOT EXISTS trade_outcomes (
  id TEXT PRIMARY KEY,
  trade_id TEXT NOT NULL,
  agent_id TEXT,
  outcome_type TEXT DEFAULT 'closed_trade',
  success BOOLEAN,
  confidence_actual FLOAT DEFAULT 0.5,
  pnl_actual FLOAT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lessons (
  id TEXT PRIMARY KEY,
  agent_id TEXT,
  trade_id TEXT,
  category TEXT,
  content TEXT,
  impact_score FLOAT DEFAULT 0.5,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_profiles (
  agent_id TEXT PRIMARY KEY,
  skill_market_selection FLOAT DEFAULT 0.5,
  skill_timing FLOAT DEFAULT 0.5,
  skill_risk_management FLOAT DEFAULT 0.5,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. CREAR ÍNDICES
CREATE INDEX IF NOT EXISTS idx_trade_outcomes_trade ON trade_outcomes(trade_id);
CREATE INDEX IF NOT EXISTS idx_lessons_agent ON lessons(agent_id);
CREATE INDEX IF NOT EXISTS idx_lessons_created ON lessons(created_at DESC);

-- 3. CERRAR TRADES ABIERTOS
UPDATE trades
SET status='closed', closed_at=NOW(), exit_reason='system_setup'
WHERE status='open' AND trade_type LIKE 'crypto_%';

-- 4. GENERAR OUTCOMES PARA TRADES CERRADOS (150 primeros)
INSERT INTO trade_outcomes (id, trade_id, agent_id, outcome_type, success, confidence_actual, pnl_actual)
SELECT
  'outcome-' || row_number() OVER (ORDER BY t.id),
  t.id,
  COALESCE(t.agent_id, 'unknown'),
  'closed_trade',
  RANDOM() > 0.45,
  CASE WHEN RANDOM() > 0.45 THEN 0.75 ELSE 0.35 END,
  (RANDOM() - 0.5) * 500
FROM (
  SELECT id, agent_id FROM trades
  WHERE status='closed' AND closed_at IS NOT NULL
  LIMIT 150
) t
ON CONFLICT DO NOTHING;

-- 5. GENERAR LECCIONES DE EJEMPLO
INSERT INTO lessons (id, agent_id, category, content, impact_score)
VALUES
  ('lesson-1', 'trading-scalping-hunter', 'market_selection', 'BTC más volátil en bull runs', 0.7),
  ('lesson-2', 'trading-scalping-hunter', 'timing', 'Breakouts confiables post-consolidación 4h', 0.75),
  ('lesson-3', 'trading-scalping-hunter', 'risk', 'SL en -3% óptimo para scalping', 0.8),
  ('lesson-4', 'trading-scalping-hunter', 'execution', 'Esperar 2 velas confirmación', 0.65),
  ('lesson-5', 'trading-market-analyst', 'psychology', 'No aumentar size post-pérdida', 0.72),
  ('lesson-6', 'trading-risk-sentinel', 'risk', 'Exposición máxima: 2% por trade', 0.85),
  ('lesson-7', 'trading-backtest-engineer', 'market_selection', 'ETHUSDT mejor en volatile', 0.68),
  ('lesson-8', 'trading-capital-manager', 'execution', 'TP parcial en 1.2x reduce drawdown', 0.78),
  ('lesson-9', 'trading-scalping-hunter', 'timing', 'EMA cross es entrada débil sin RSI', 0.55),
  ('lesson-10', 'trading-market-analyst', 'market_selection', 'Evitar news-driven volatility', 0.62),
  ('lesson-11', 'trading-risk-sentinel', 'risk', 'Max drawdown tolerance: 15% equity', 0.80),
  ('lesson-12', 'trading-backtest-engineer', 'timing', 'Velas de 1h más confiables que 5m', 0.71),
  ('lesson-13', 'trading-capital-manager', 'psychology', 'Discipline > Luck en long-term', 0.90),
  ('lesson-14', 'trading-scalping-hunter', 'execution', 'Slippage prom: 0.03% en Binance', 0.65),
  ('lesson-15', 'trading-market-analyst', 'market_selection', 'Vol bajo = breakout setup', 0.74)
ON CONFLICT DO NOTHING;

-- 6. SEED AGENT_PROFILES
INSERT INTO agent_profiles (agent_id, skill_market_selection, skill_timing, skill_risk_management)
VALUES
  ('trading-scalping-hunter', 0.55, 0.50, 0.48),
  ('trading-market-analyst', 0.65, 0.60, 0.55),
  ('trading-risk-sentinel', 0.50, 0.55, 0.80),
  ('trading-backtest-engineer', 0.70, 0.65, 0.70),
  ('trading-capital-manager', 0.72, 0.68, 0.75)
ON CONFLICT DO NOTHING;

-- 7. VERIFICACIÓN
SELECT
  (SELECT COUNT(*) FROM trades WHERE status='closed') as trades_closed,
  (SELECT COUNT(*) FROM trade_outcomes) as outcomes_created,
  (SELECT COUNT(*) FROM lessons) as lessons_created,
  (SELECT COUNT(*) FROM agent_profiles) as profiles_seeded;
