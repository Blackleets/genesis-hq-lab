# Crypto Phase 1 Decision Runbook

Fecha de referencia: 2026-06-08

Este runbook existe para ejecutar la Fase 1 del recovery plan sin improvisar.

Documento padre:

- `docs/CRYPTO_CORE_RECOVERY_PLAN.md`

## Objetivo

Tomar una decision binaria sobre `scalp_v2`:

1. sigue en freeze por una ventana final corta
2. se apaga como estrategia principal y pasa a rediseno

## Baseline de partida

Numeros live verificados antes de iniciar esta fase:

- `closedTrades`: 103
- `wins`: 19
- `winRate`: 18.4%
- `totalPnl`: -68.58
- `expectancy`: -0.67
- `profitFactor`: 0.10
- `recommendation`: `pause_or_redesign_strategy`

Filtros aditivos activos:

- `SHORT_BEAR`
- hora `16`
- banda `80-89`

## Duracion maxima

Cerrar Fase 1 cuando ocurra lo primero:

1. pasen 72 horas o
2. se acumulen 20 trades cerrados nuevos

## Que no se puede hacer

- no tocar execution
- no tocar risk
- no tocar safe mode
- no tocar Kelly
- no tocar TP/SL
- no tocar sizing
- no abrir trabajo de agentes autonomos
- no meter mas de 1 filtro aditivo nuevo

## Comandos de verificacion

Chequeo resumido automatizado:

```powershell
node scripts/cryptoPhase1Check.mjs
```

Ese script consulta prod y devuelve:

- consistencia entre endpoints
- metricas clave
- filtros activos
- recomendacion live
- veredicto binario de Fase 1
- siguiente paso sugerido

### Salud

```powershell
curl https://genesis-hq-backend.onrender.com/api/db/health
```

Esperado:

- `connected: true`

### Truth check

```powershell
curl https://genesis-hq-backend.onrender.com/api/crypto/overview
curl https://genesis-hq-backend.onrender.com/api/crypto/diagnostics
curl https://genesis-hq-backend.onrender.com/api/crypto/regime-backtest
```

Registrar en cada medicion:

- `overview.pnl.closed.total`
- `overview.pnl.closed.wins`
- `overview.pnl.closed.winRate`
- `overview.pnl.closed.totalPnl`
- `overview.pnl.closed.avgPnl`
- `diagnostics.autopsy.totalSamples`
- `diagnostics.autopsy.edgeSummary.profitFactor`
- `diagnostics.autopsy.recommendation.action`
- `diagnostics.autopsy.manualFiltersActive`
- `regimeBacktest.before.trades`
- `regimeBacktest.before.expectancy`
- `regimeBacktest.before.profitFactor`

## Regla de consistencia

En toda medicion:

- `overview.pnl.closed.total == diagnostics.autopsy.totalSamples`
- `overview.pnl.closed.total == regimeBacktest.before.trades`

Si esto falla, primero se repara truth, no se decide edge.

## Regla de decision

### Caso A: apagar estrategia actual

Apagar `scalp_v2` como estrategia principal si al cierre de la ventana:

- `expectancy < 0`
- `profitFactor < 1`

No hace falta esperar otra excusa. Con esos dos criterios, la tesis actual se considera fallida.

### Caso B: mantener freeze corto

Solo mantener freeze temporal si:

- `expectancy >= 0`
- `profitFactor >= 1`
- la mejora no depende de un solo slice aislado

En ese caso:

- no quitar filtros manuales
- exigir confirmacion hasta 50 trades nuevos

### Caso C: ultimo filtro permitido

Solo si el operador decide una ultima prueba controlada, el siguiente slice candidato es:

- `BNBUSDT`

Motivo live ya observado:

- `EV -0.77`
- `PF 0.04`

Si se activa este filtro:

- debe ser el unico cambio del ciclo
- se vuelve a medir
- si sigue negativo, se cierra Fase 1 con apagado

## Salidas permitidas de la fase

### Salida 1: freeze extendido

Permitida solo si el edge deja de ser negativo.

### Salida 2: pause or redesign

Salida por defecto si el edge sigue negativo.

Accion siguiente:

- abrir una sola hipotesis de rediseno
- no reactivar el scalp actual por inercia

## Plantilla de reporte

Usar este formato al cerrar la fase:

```text
Fecha:
Trades baseline:
Trades finales:
Delta trades:
WR final:
EV final:
PF final:
PnL final:
Recommendation final:
Decision:
Reason:
Next step:
```

## Resultado esperado

Fase 1 no existe para “mejorar sentimiento”.
Existe para cerrar la ambiguedad.

Si los numeros siguen malos, la salida correcta es:

- apagar como estrategia principal
- pasar a rediseno
