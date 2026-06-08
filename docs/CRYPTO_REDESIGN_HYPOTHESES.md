# Crypto Redesign Hypotheses

Fecha de referencia: 2026-06-08

Documento padre:

- `docs/CRYPTO_CORE_RECOVERY_PLAN.md`
- `docs/CRYPTO_PHASE1_DECISION_RUNBOOK.md`

## Regla principal

No redisenar "todo".

Probar una sola hipotesis por vez, con:

1. definicion de entrada
2. definicion de salida
3. universo de pares
4. criterio de exito
5. criterio de descarte

## Baseline a superar

El sistema actual no es el baseline aspiracional. Es el baseline a batir:

- `WR`: 18.4%
- `EV`: -0.67
- `PF`: 0.10
- `PnL`: -68.58

Una hipotesis nueva no pasa por "verse mejor". Pasa solo si produce:

- `expectancy > 0`
- `profitFactor > 1.10`
- comportamiento no dependiente de un solo slice toxico

## Hipotesis 1: Pure Trend Continuation

### Tesis

El problema del modelo actual es mezclar continuation y reversal en el mismo loop.
Esta hipotesis opera solo cuando:

- HTF y LTF estan alineados
- momentum confirma
- no hay extension extrema

### Universo inicial

- `BTCUSDT` solo

### Qué debe cambiar

- no usar mean reversion
- no usar entradas contra el sesgo HTF
- no operar cuando RSI ya esta extendido contra continuidad sana

### Exito minimo

- `PF > 1.10`
- `EV > 0`
- al menos 200 trades de backtest

### Señal de descarte

- si mejora solo por quitar horas o slices extremos
- si depende de un solo horario
- si sigue con `PF < 1`

## Hipotesis 2: Pure Mean Reversion

### Tesis

El modelo actual castiga entradas de reversión al evaluarlas con lógica de momentum.
Esta hipotesis opera solo cuando:

- hay extension clara respecto a la media
- RSI confirma extremo
- la entrada busca vuelta a equilibrio, no continuation

### Universo inicial

- `BTCUSDT`
- opcional `ETHUSDT` solo después

### Qué debe cambiar

- separar por completo continuation y reversal
- timeout adaptado a reversión, no al mismo horizonte del scalp actual

### Exito minimo

- `PF > 1.10`
- `EV > 0`
- estabilidad por par

### Señal de descarte

- si necesita demasiados filtros manuales para no perder
- si el edge desaparece fuera de una sola banda de confianza

## Hipotesis 3: Single-Pair Specialization

### Tesis

El problema principal puede no ser la lógica base sino la mezcla de pares con microestructuras
distintas. Esta hipotesis no cambia primero la lógica; cambia primero el universo.

### Universo inicial

- `BTCUSDT` solo

### Qué debe cambiar

- excluir `BNBUSDT`
- excluir pares secundarios hasta ver edge estable en un solo activo

### Exito minimo

- `BTCUSDT` aislado debe producir `EV >= 0`
- `BTCUSDT` aislado debe producir `PF > 1`

### Señal de descarte

- si incluso el mejor par sigue claramente negativo

## Orden recomendado

1. `Single-Pair Specialization`
2. `Pure Trend Continuation`
3. `Pure Mean Reversion`

Motivo:

- reduce variables primero
- obliga a ver si el problema es mezcla de pares o hipótesis de entrada
- evita redisenar demasiadas cosas al mismo tiempo

## Protocolo de experimento

Cada hipotesis debe producir:

1. una configuracion identificable
2. un backtest reproducible
3. resultados IS
4. resultados OOS
5. breakdown por:
   - pair
   - side
   - regime
   - hour
   - confidence band

## Criterio para pasar a live

No pasar a live si falta cualquiera:

1. `expectancy > 0`
2. `profitFactor > 1.10`
3. al menos 200 trades evaluables
4. OOS no peor que IS de forma material

## Criterio para abortar una hipotesis

Abortar sin apego si:

- sigue `EV < 0`
- sigue `PF < 1`
- depende de un solo slice excepcional
- requiere demasiados vetos manuales

## Regla de disciplina

No abrir:

- Phase 4
- mas agentes
- mas UI
- nuevas capas de IA

hasta que una de estas hipotesis gane con evidencia.
