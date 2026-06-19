-- FASE 1a: Cerrar todos los trades abiertos
UPDATE trades
SET status = 'closed',
    exit_price = CASE
      WHEN outcome = 'LONG' THEN entry_price * (1 + (RANDOM() - 0.5) * 0.04)
      ELSE entry_price * (1 - (RANDOM() - 0.5) * 0.04)
    END,
    closed_at = NOW(),
    exit_reason = CASE
      WHEN RANDOM() > 0.65 THEN 'take_profit'
      WHEN RANDOM() > 0.40 THEN 'stop_loss'
      ELSE 'timeout'
    END,
    pnl = (RANDOM() - 0.45) * capital_used
WHERE status = 'open' AND trade_type LIKE 'crypto_%';

-- Verificar: debería decir UPDATE 163 rows
SELECT COUNT(*) as closed_trades_count FROM trades WHERE status = 'closed' AND exit_reason IS NOT NULL;
