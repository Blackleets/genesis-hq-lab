# Genesis HQ Lab — Plan de Mejora (verificado)

**Fecha:** 2026-08-21
**Autor del análisis:** Ganador De Dinero (agente `aragan`)
**Rama:** `feat/genesis-improvement-plan` (nunca `main`)
**Base:** `feat/genesis-life-os` @ `e013a97` "fix: single source of truth for capital — unify to $10,000"

---

## 0. Contexto: hay DOS realidades en un mismo repo

Tu GitHub `Blackleets/genesis-hq-lab` contiene dos estados que NO se parecen:

| Rama / carpeta | Qué es | Estado verificado |
|---|---|---|
| `main` → `genesis-hq-lab` | "Visual Lab" seguro | Frontend puro (React/Vite/TS). Cero backend, cero trading. Gates OK: typecheck ✅ · lint ✅ · build ✅ · tests 16/16 ✅ |
| `feat/genesis-life-os` → `genesis-hq-lab-real` | Sistema REAL | Backend Node (~47k LOC), 5 agentes Claude Haiku, optimizador walk-forward, bot funding arbitrage, prediction markets, wallet read-only. Por defecto **PAPER** (`REAL_TRADING_MODE` default `false`). Auth API existe (`requireAuth` en `server/index.mjs`, 16 call-sites, gated por `API_SECRET`). Deploy Vercel + Railway/Render |

---

## 1. Hallazgos verificados (con prueba, no fe)

1. **Docs contradictorios en el repo real.**
   - `PROYECTO_ESTADO_COMPLETO.md` (2026-06-19): *"8 blockers impiden REAL_TRADING; crypto edge NEGATIVO (PF=0.10, EV=-$0.67/trade, WR=18.4% en 103 trades)"*.
   - `HITO1_COMPLETADO.md` (2026-06-21): *"SEGURO PARA REAL_TRADING=true; 8/8 blockers COMPLETADOS"*.
   - Mismo repo, 2 días después, afirmaciones opuestas. **No se puede confiar en el estado declarado.**

2. **Lo "live" es PAPER de verdad.** `data/executions.json` → `mode: "funding-paper"`, todos los trades `live: false`, equity ~$208 partiendo de $10k. Cero dinero real. Bien por el contrato de seguridad; mal para la promesa "listo para dinero real".

3. **Backtest winners parecen overfit.** `fund_winners.jsonl` (20 estrategias, todas PF>1.3): la "mejor" COTIUSDT **PF=7055, WR=99.2%** sobre solo `t=500` velas y `thr=0.0001`. Clásico sweep overfit. No es dinero bancable hasta validación OOS honesta.

4. **Los 6 gates del README — su estado real es DESCONOCIDO.** Nadie los ha corrido y reportado contra datos vivos recientes. Son la verdadera barra GO/NO-GO:
   1. Muestra ≥ 50 trades
   2. Win rate ≥ 45%
   3. Profit factor ≥ 1.30
   4. Expectativa > 0.05%/trade
   5. Significancia t-stat ≥ 2.0
   6. Drawdown ≤ 25%
   Todos netos de costos, sobre datos reales out-of-sample.

5. **Auth API sí existe** (`server/index.mjs:185` `requireAuth`, 16 sitios). El claim de HITO1 de auth cubierto es REAL.

---

## 2. Plan de mejora (secuencial, por riesgo)

### P0-A — Reconciliar la verdad (NO negociable, primero)
**Por qué:** sin saber si los 6 gates pasan de verdad, cualquier "listo para real" es humo.
- [ ] Actualizar `PROYECTO_ESTADO_COMPLETO.md` y `HITO1_COMPLETADO.md` para que dejen de contradecirse; marcar cuál es el estado real hoy.
- [ ] Crear `docs/GATES_REPORT.md` y **correr los 6 gates contra datos reales OOS** (no in-sample). Reportar pass/fail por gate con números.
- [ ] Si algún gate falla, el sistema se queda en PAPER y se documenta qué falta.

### P0-B — Cerrar gaps de seguridad reales (aunque HITO1 diga lo contrario)
**Por qué:** si el breaker se resetea al reiniciar, "real" = incendio.
- [ ] Persistir peak-capital a SQLite (`risk_state` table) → drawdown circuit breaker sobrevive a reinicio.
- [ ] Startup position reconciliation: cargar `status='open'`, consultar mercado, cerrar/resolver/expire.
- [ ] Arreglar Kalshi silent-fail: en `REAL_TRADING=true` y fallo real, NO guardar paper fill; devolver `real_failed` + alertar.
- [ ] Heartbeat + `process.on('uncaughtException'/'unhandledRejection')` + Slack/email alerting; `/api/health` chequea last_heartbeat.

### P1 — Des-overfit del edge funding-paper hacia los 6 gates
**Por qué:** el funding-paper SÍ acumula positivo en papel (equity crece en `executions.json`), es donde está el dinero potencial.
- [ ] Tomar las estrategias de `fund_winners.jsonl` y validarlas con walk-forward + Monte Carlo bootstrap (peor caso p5).
- [ ] Solo las que pasen OOS honesto entran al reporte de gates.
- [ ] Si pasan los 6 gates → queda como PAPER listo; el salto a real es DECISIÓN HUMANA manual, nunca automático.

### P2 — Estabilidad de arquitectura (después de P0+P1)
- [ ] Split del god-store `genesisStore.ts` (67,601 líneas) en stores <500 líneas.
- [ ] Split componentes monolíticos (MarketsView 32k, Dashboard 21k, AgentExecution 15k).
- [ ] Unificar doble sistema de agentes (pixel office falso vs backend real).
- [ ] Migrar `strategyParams` runtime mutation → SQLite.

---

## 3. Reglas que respeto
- Nunca trabajo en `main`. Siempre branch (`feat/*`).
- `live_mode = false` / `REAL_TRADING=false` por defecto. Cero ejecución real sin tu GO + llaves.
- Nada de datos falsos presentados como reales.
- Cada cambio se registra en `docs/CHANGELOG_AI.md`.

## 4. Siguiente paso
Ejecutar **P0-A**: reconciliar docs + correr los 6 gates contra datos reales OOS y volcar el resultado en `docs/GATES_REPORT.md`. Requiere tu confirmación antes de correr backtests/optimizador (puede tardar y consumir llamadas a la API de mercado).
