# Genesis Quant Lab — Architecture

## Pregunta central

> ¿Tenemos edge validado para poner capital, sí o no?

Todo el pipeline existe para responder esa pregunta con datos reales, no opinión.

---

## Pipeline (servidor)

```
server/quant/
├── alpha/
│   └── strategyRegistry.mjs      ← catálogo unificado de estrategias
├── validation/
│   └── validationGate.mjs        ← checkpoint: ¿hay edge?
├── portfolio/
│   └── allocationEngine.mjs      ← ¿cuánto capital por estrategia?
├── quantState.mjs                ← snapshot del pipeline completo
├── quantReport.mjs               ← reporte legible con headline
└── index.mjs                     ← re-exports públicos
```

### Flujo de datos

```
DB (trades)
    ↓
alphaValidationEngine.getAlphaReport()   ← métricas reales de edge
futuresGovernor.getFuturesGovernorSnapshot()  ← datos live por perfil
    ↓
strategyRegistry.getStrategyRegistry()   ← catálogo con estados derivados
    ↓
validationGate.runSystemValidation()     ← 7 checks → APPROVED / REJECTED / INSUFFICIENT_DATA / SAFE_MODE
    ↓
allocationEngine.computeAllocation()    ← capital por estrategia
    ↓
quantState.getQuantState()              ← snapshot { registry, validation, allocation, edgeVerdict }
    ↓
quantReport.generateQuantReport()       ← headline + strategies + blockers + metrics
```

### API endpoints

| Endpoint | Función |
|---|---|
| `GET /api/quant/report` | Reporte completo — headline + todo |
| `GET /api/quant/status` | Edge verdict + snapshot rápido |
| `GET /api/quant/strategies` | Catálogo de estrategias con estados |
| `GET /api/quant/validation` | 7 checks de validación con detalle |
| `GET /api/quant/allocation` | Capital recomendado por estrategia |

---

## Strategy Registry

### Estados posibles

| Estado | Significado | Capital |
|---|---|---|
| `RESEARCH` | Idea sin datos suficientes | 0% |
| `BACKTESTING` | En backtest, no live | 0% |
| `PAPER` | Paper trading activo | ≤5% simulado |
| `PROMOTED` | Edge validado, listo para capital | ≤20% real por estrategia |
| `REJECTED` | Edge negativo confirmado | 0% |
| `DISABLED` | Apagado por env flag o manualmente | 0% |

### PROMOTION_CRITERIA (criterios mínimos para PROMOTED)

```js
{
  minTrades:       30,    // mínimo de trades cerrados
  minProfitFactor: 1.3,   // beneficio / pérdida total
  minExpectancy:   0,     // EV por trade > 0
  maxDrawdownPct:  0.15,  // drawdown máximo 15%
}
```

### Estrategias registradas (7)

| ID | Mercado | Estado actual |
|---|---|---|
| `futures_breakout_short_micro` | Futures BTC | PAPER / RESEARCH |
| `futures_breakout_short_core` | Futures BTC | PAPER / RESEARCH |
| `futures_breakout_short_alt` | Futures ETH | PAPER / RESEARCH |
| `futures_breakout_long_probe` | Futures BTC | PAPER / RESEARCH |
| `crypto_scalp_v1` | Spot crypto | REJECTED (PF~0.47) |
| `crypto_swing` | Spot crypto | RESEARCH |
| `breakout_spot_alpha` | Spot BTC | RESEARCH |

---

## Validation Gate

### Checks (7)

1. `SAFE_MODE` — global risk engine ≥85 → bloquea todo
2. `TRADE_COUNT` — mínimo 30 trades cerrados en DB
3. `DATA_MODE` — datos reales (no fixtures)
4. `PROFIT_FACTOR` — PF ≥ 1.3 en trades reales
5. `EXPECTANCY` — EV por trade > 0
6. `DRAWDOWN` — drawdown ≤ 15%
7. `GOVERNOR_PROFILES` — al menos 1 perfil gubernamental activo

### `validateStrategyProfile()` (función pura, sin DB)

Recibe `{ trades, profitFactor, avgPnl, winRate, paused }` y retorna:
```js
{
  approved: boolean,
  checks:   [{ pass, code, detail }],
  reasons:  string[],  // razones de rechazo (vacío si approved)
}
```

---

## Allocation Engine

### Reglas de capital

```
REJECTED / DISABLED / RESEARCH / BACKTESTING → 0%
PAPER    → max 5% simulado (no consume presupuesto real)
PROMOTED → 10% base + hasta 10% por score → cap duro 20% por estrategia
Portfolio total → cap 50%
Buffer mínimo sin asignar → $500
```

### Blocks de sistema (anulan todo)

- `isGlobalSafeMode()` → `GLOBAL_SAFE_MODE`
- `isSafeMode()` → `RECONCILIATION_SAFE_MODE`
- `dailyLossToday >= CRYPTO_DAILY_LOSS_CAP` → `DAILY_LOSS_CAP`

### Score de estrategia (para PROMOTED)

```js
score = winRate * 40 + profitFactor * 10 + avgPnl * 0.5 + min(trades, 100) * 0.1
```

---

## UI

`src/components/crypto/QuantReadinessPanel.tsx` — tab **QUANT** en `RightPanel`.

Muestra:
- Headline de edge verdict (verde/rojo/naranja)
- Lista de blockers con códigos
- Resumen de allocation
- Tabla de estrategias con status badge, trades, PF, WR
- Contadores byStatus
- dataMode (REAL_DATA vs FIXTURE_DATA)

No hay datos inventados. Si el backend no responde, muestra el error.

---

## Regla cardinal

**Ninguna estrategia pasa a PROMOTED sin 30 trades cerrados reales.**

La scalp (`crypto_scalp_v1`) está permanentemente REJECTED: `edgeSearch.mjs` confirmó PF~0.47, WR~20% — edge negativo en todos los regímenes.
