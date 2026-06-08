# Crypto Core Recovery Plan

Fecha de referencia: 2026-06-08

## Estado real

Producción, verificado en Render el 2026-06-08:

- `closedTrades`: 103
- `wins`: 19
- `winRate`: 18.4%
- `totalPnl`: -68.58
- `expectancy`: -0.67
- `profitFactor`: 0.10
- `recommendation`: `pause_or_redesign_strategy`

Filtros aditivos activos hoy:

- `SHORT_BEAR`
- hora `16:00-16:59 UTC`
- banda de confianza `80-89`

Conclusión: el edge live sigue roto incluso después de 3 filtros aditivos. No avanzar a agentes autónomos ni a nuevas features sobre este core.

## Objetivo

Volver a producción solo con evidencia de edge no negativo y estable, sin romper:

- execution
- risk
- safe-mode
- Kelly
- TP/SL
- paper
- API síncrona de `better-sqlite3`

## Fase 0: Freeze Operativo

Objetivo: dejar de confundir actividad con progreso.

Acciones:

1. Mantener activos los 3 filtros manuales actuales.
2. Mantener `pause_or_redesign_strategy` como recomendación operativa por defecto mientras `EV < 0` y `PF < 1`.
3. No abrir trabajo de Phase 4 ni agentes autónomos.
4. No meter nuevas fuentes en el hot path. Binance/TickerSage solo observabilidad, no execution.

Criterio de salida:

- El sistema sigue estable.
- `overview`, `diagnostics` y `regime-backtest` siguen contando el mismo universo de trades.

## Fase 1: Medición de Corte Final

Objetivo: decidir si el scalp actual merece otro intento mínimo o cierre completo.

Ventana:

- máximo 72 horas de observación o
- máximo 20 trades cerrados adicionales

Regla:

- Si al final de esa ventana `EV < 0` y `PF < 1`, se desactiva la estrategia actual como línea principal y se pasa a rediseño.

No hacer durante esta fase:

- no agregar más de 1 filtro nuevo
- no tocar sizing
- no tocar TP/SL
- no tocar execution

## Fase 2: Rediseño de Hipótesis

Objetivo: reemplazar la tesis actual por una hipótesis medible.

Regla principal:

- una hipótesis por vez

Hipótesis candidatas permitidas:

1. Trend continuation puro
   Solo operar con sesgo HTF alineado y sin reversión intrabar.
2. Mean reversion puro
   Separado del momentum; no mezclar ambos modelos en el mismo loop.
3. Single-pair specialization
   Empezar por `BTCUSDT` y excluir pares débiles hasta probar edge.

Hipótesis no permitidas:

- “más IA”
- “más agentes”
- “más señales combinadas” sin aislamiento causal

Entregables:

1. dataset limpio de closed crypto trades
2. test offline por hipótesis
3. split IS/OOS
4. métricas por pair, side, regime, hour, confidence band

Criterio mínimo para pasar:

- `profitFactor > 1.10`
- `expectancy > 0`
- al menos 200 trades de backtest evaluables
- sin depender de un solo pair o una sola hora tóxica

## Fase 3: Relanzamiento Controlado

Objetivo: volver a live en modo entrenamiento, pero reducido.

Orden:

1. un solo modelo
2. un solo universo pequeño de pares
3. vetoes activos desde el día 1
4. diagnostics y autopsy como verdad canónica

Defaults recomendados:

- empezar con `BTCUSDT` solo
- mantener bloqueos manuales heredados hasta que la nueva hipótesis pruebe lo contrario
- no reabrir `BNBUSDT` hasta ver edge positivo

Criterio de continuidad live:

- después de 30 trades cerrados: `EV >= 0`
- después de 50 trades cerrados: `PF > 1`
- después de 75 trades cerrados: `WR`, `EV` y `PF` no deben deteriorarse frente al tramo anterior

Si falla cualquiera:

- volver a `pause_or_redesign_strategy`

## Fase 4: Reapertura Gradual

Solo entra si Fase 3 pasa.

Orden:

1. ampliar pares
2. ampliar ventanas horarias
3. evaluar si quitar alguno de los bloqueos manuales
4. recién después considerar automatización extra o agentes

Prohibido en esta fase:

- remover filtros manuales sin evidencia nueva
- ampliar tamaño o frecuencia antes de validar edge

## Scorecard de decisión

### Seguir en freeze

- `EV < 0`
- `PF < 1`
- recommendation crítica

### Apagar estrategia actual

- sigue negativa después de Fase 1
- o necesita demasiados filtros manuales para no perder

### Rediseño exitoso

- pasa OOS
- pasa relanzamiento controlado
- deja de depender de poda manual extrema

## Siguiente paso recomendado

Ejecutar Fase 1 completa y tomar decisión binaria:

1. si la siguiente ventana sigue negativa: apagar `scalp_v2` como estrategia principal y abrir rediseño
2. si sorprendentemente mejora a no negativo: mantener freeze y exigir confirmación hasta 50 trades nuevos

No construir más features hasta que ese punto quede resuelto.
