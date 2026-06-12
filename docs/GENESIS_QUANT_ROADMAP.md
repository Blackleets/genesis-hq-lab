# Genesis Quant Lab — Roadmap

Estado actual y próximos pasos para llegar a capital real.

## Estado actual (2026-06-11)

| Componente | Estado |
|---|---|
| Strategy Registry | ✅ Operativo |
| Validation Gate (puro) | ✅ Operativo |
| Validation Gate (DB) | ✅ Operativo |
| Allocation Engine | ✅ Operativo |
| Quant Report API | ✅ Operativo |
| UI Panel (QUANT tab) | ✅ Operativo |
| Edge Answer | ❌ NO — sin trades suficientes |

### Por qué el edge answer es NO

`alphaValidationEngine` requiere ≥30 trades cerrados reales.
Los futuros breakout profiles están en PAPER con pocas muestras (<8 en governor).
La scalp está REJECTED por edge negativo confirmado.

**Nada está roto.** El sistema funciona correctamente — simplemente no hay suficientes datos todavía.

---

## Para llegar a edge answer = YES

### Paso 1: Acumular trades (sin acción de código)
- Los perfiles de `futures_breakout_short_*` deben acumular ≥30 trades cerrados en la DB
- El governor tick corre en Supabase Edge Function (`genesis-runner`)
- Tiempo estimado: semanas / meses dependiendo de frecuencia de setups

### Paso 2: Walk-forward validation
- `server/crypto/backtest/breakoutWalkForward.mjs` existe pero no está wired al quant gate
- Conexión pendiente: leer los resultados de WF y usarlos como evidencia adicional en `runSystemValidation()`

### Paso 3: Live proof
- Primera vez que una estrategia alcance PROMOTED, ejecutar un paper trade documentado
- Resultado en CHANGELOG_AI.md como "Live Proof"

---

## Lo que NO está en el roadmap

- Prediction Markets nuevas (FROZEN — la integración de 5 módulos está completa)
- NautilusTrader o ejecución institucional completa
- SaaS o dashboards decorativos
- Datos inventados o backtests sin OOS validation

---

## Métricas de progreso

Consultar en tiempo real:
```
GET /api/quant/report
GET /api/quant/validation
GET /api/quant/strategies
```

O ver en UI: `RightPanel → tab QUANT`
