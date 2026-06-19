-- FASE 1b: Generar outcomes para cada trade cerrado
INSERT INTO trade_outcomes (id, trade_id, agent_id, outcome_type, success, confidence_actual, pnl_actual, created_at)
SELECT
  'outcome-' || trades.id,
  trades.id,
  trades.agent_id,
  'closed_trade',
  trades.pnl > 0,
  CASE WHEN trades.pnl > 0 THEN 0.75 ELSE 0.35 END,
  trades.pnl,
  trades.closed_at
FROM trades
WHERE trades.status = 'closed'
  AND trades.closed_at IS NOT NULL
  AND trades.pnl IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM trade_outcomes
    WHERE trade_outcomes.trade_id = trades.id
  );

-- Verificar: debería haber 163+ outcomes
SELECT COUNT(*) as outcomes_created FROM trade_outcomes;
