# Genesis Quant — Validation Rules

Reglas que gobiernan si una estrategia puede recibir capital.

## Criterios de Promoción

Un perfil de estrategia debe pasar **todos** los criterios para ser PROMOTED:

| Criterio | Valor mínimo | Fuente |
|---|---|---|
| Trades cerrados | ≥ 30 | DB `trades` (status = 'closed') |
| Profit Factor | ≥ 1.3 | ganancias totales / pérdidas totales |
| Expectancy (EV) | > 0 | avgPnl por trade positivo |
| Max Drawdown | ≤ 15% | drawdown máximo histórico |
| Paused | false | flag de estrategia |

## Por qué estos números

- **30 trades**: mínimo estadístico para distinguir edge real de ruido. Con menos, el PF puede ser alto por suerte.
- **PF 1.3**: margen conservador sobre 1.0 para absorber costos de spread, slippage y días malos.
- **EV > 0**: necesidad básica — cada trade debe tener valor esperado positivo en promedio.
- **Drawdown 15%**: capital preservation. Si el drawdown supera 15%, el sistema se vuelve inestable.

## Bloques de sistema (anulan capital en TODAS las estrategias)

1. **Global Safe Mode** (`CRYPTO_RISK_SCORE ≥ 85`) — riesgo sistémico demasiado alto
2. **Reconciliation Safe Mode** — contabilidad interna inconsistente
3. **Daily Loss Cap** (`CRYPTO_DAILY_LOSS_CAP`, default $300) — pérdida diaria máxima alcanzada

Cuando cualquiera de estos está activo, `computeAllocation()` retorna `{ blocked: true }` con 0% para todo.

## Estrategias permanentemente REJECTED

### `crypto_scalp_v1`
- Razón: `edgeSearch.mjs` confirmó PF~0.47, WR~20% — negative edge en todos los regímenes analizados
- No se rehabilitará sin evidencia de ≥30 trades con PF≥1.3 en datos reales

## Proceso de rehabilitación

Una estrategia REJECTED puede pasar a RESEARCH si:
1. Se cambia el algoritmo de entrada/salida materialmente
2. Se documenta el cambio en CHANGELOG_AI.md
3. Se borra el `note` de negative edge del registry

Una estrategia RESEARCH pasa a PAPER cuando tiene backtests favorables (interno, sin gate automático).

Una estrategia PAPER pasa a PROMOTED **solo** cuando cumple todos los criterios de PROMOTION_CRITERIA con datos reales de la DB.

## Responsabilidad

El Validation Gate no ejecuta trades. Es un checkpoint de lectura. La decisión final de capital es del operador humano basada en la evidencia que muestra el gate.
