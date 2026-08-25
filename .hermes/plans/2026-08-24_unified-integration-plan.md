# Plan Unificado de Acoplamiento — 4 Repos Oficiales → Genesis

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Fecha:** 2026-08-24
**Origen:** 4 informes de sub-agentes especialistas (Hummingbot, Freqtrade, FinGPT, FinRobot)
**Regla de oro:** live_mode = false inviolable · 6 gates como filtro duro · AGENTS.md respetado

---

## Síntesis de los 4 informes

| Fuente | Hallazgo principal | Valor para Genesis |
|---|---|---|
| **Hummingbot** | 6 patrones de conector bien replicados en Python; gaps JS: capital bifurcado treasury↔liveRunner, sin gate ready, lost-orders inexistentes | Alto (pre-live) |
| **Freqtrade** | 🔴 CRÍTICO: backtestCore.mjs pasa arrays completos a las estrategias → lookahead bias estructural no detectable por walk-forward | **MÁXIMO** (credibilidad de todo) |
| **FinGPT** | Sentimiento = feature tabular agregada, nunca señal standalone; stack costo-cero VADER+GDELT viable | Medio (feature secundaria) |
| **FinRobot** | Genesis YA es superior en el núcleo (Council determinista + gates vs LLM end-to-end); hueco real = shadow critic pre-persistencia | Bajo-medio |

---

## BACKLOG PRIORIZADO (valor/costo, orden de ejecución)

### 🔴 P0 — Lookahead Guard + Signal Shift (Freqtrade Mejora A)
**Por qué primero:** Sin esto, TODO el pipeline (Optuna, evolución, veredictos sabatinos) se apoya en un motor que no puede demostrar su propia honestidad. Es el multiplicador de credibilidad.

**Archivos:**
- Modify: `server/genesis/backtestCore.mjs` (~60 líneas)
- Modify: `server/genesis/evalCandidate.mjs` (propagar `lookaheadViolations`)
- Test: re-correr estudio Optuna activo y comparar top-5 previo vs post

**Firmas:**
```js
export function createCappedCtx(ctx, i)   // vistas hasta i inclusive; índice > i lanza RangeError('LOOKAHEAD')
export function runBacktest({ ..., strictLookahead = true, signalShift = true })  // señales ejecutan en open[i+1]
// result.lookaheadViolations: Array<{idx, detail}> — si length > 0 → go=false motivo 'LOOKAHEAD'
```

**Tareas bite-sized:** T1.1 createCappedCtx + tests · T1.2 signalShift en runBacktest · T1.3 propagación evalCandidate · T1.4 re-corrida Optuna comparativa · T1.5 commit

---

### 🟠 P1 — Capital unificado: reserve/release en Treasury (Hummingbot riesgo #1)
**Por qué:** Dos fuentes de verdad de capital que pueden divergir silenciosamente. Es el acoplamiento más peligroso pre-live.

**Archivos:**
- Modify: `server/genesis/treasury.mjs` (+`reserve(amountUsdt, reason)->id`, `release(id)`, `availableForTrading()`)
- Modify: `server/genesis/liveRunner.mjs` (sizing consulta reservas vivas cada ciclo)

**Tareas:** T2.1 reserve/release en treasury + ledger ops · T2.2 liveRunner consume availableForTrading · T2.3 test divergencia

---

### 🟠 P2 — connectorCore.mjs + feeAccountant.mjs (Hummingbot patrones 3/5)
**Por qué:** Ciclo de vida de órdenes real en JS (PARTIALLY_FILLED incluido) + fees maker/taker desde ccxt loadMarkets en vez de 0.1% hardcodeada.

**Archivos:**
- Create: `server/genesis/connectorCore.mjs` (OrderState, InFlightOrder, ClientOrderTracker portados del patrón HB/paper_connector)
- Create: `server/genesis/feeAccountant.mjs`
- Modify: `liveRunner.mjs` (tracker en vez de position mutada)

**Nota:** el snapshot del tracker debe escribirse atómicamente junto al estado existente (riesgo #3 del informe).

---

### 🟡 P3 — Loss registry plugable en Optuna (Freqtrade Mejora B)
**Por qué:** Permite evolucionar hacia Calmar/DD-relativo sin tocar el loop; desacopla fitness de gates.

**Archivos:**
- Create: `scripts/genesis_losses.py` (LOSS_REGISTRY: fitness/sharpe/calmar/profit_drawdown)
- Modify: `scripts/optuna_evolve.py` (`--loss` flag, sufijo en study_name)

---

### 🟡 P4 — Warmup candles en walk-forward folds (Freqtrade P5b)
**Por qué:** Los primeros ~50 candles de cada fold tienen indicadores "arranconos" → métricas distorsionadas. ~10 líneas pero cambia números históricos → re-validar todo después.

**Archivos:** Modify: `server/genesis/oosValidator.mjs`

---

### 🟢 P5 — Shadow Critic pre-persistencia (FinRobot)
**Por qué:** Segunda pasada crítica no-bloqueante sobre el veredicto del council antes de guardar. Reusa Hermes como runtime HTTP (cero AutoGen).

**Archivos:** Create: `server/genesis/shadowCritic.mjs`; Modify: decisionCouncil evaluateTrade.

---

### 🟢 P6 — sentimentEngine.mjs (FinGPT)
**Por qué:** Feature secundaria costo-cero (VADER+GDELT), integrada junto a Fear&Greed. Con las advertencias del informe: peso pequeño jamás trigger principal.

**Archivos:** Create: `server/genesis/sentimentEngine.mjs`

---

### ⚪ NO HACER (decisión explícita de arquitectura)
- DataProvider completo ni IStrategy de Freqtrade (sobre-ingeniería; nuestro strategyFn+cubren el caso)
- AutoGen/GroupChat/líder-orquestador LLM de FinRobot (choca con AGENTS.md, overengineering; Genesis ya es superior en núcleo determinista)
- X/Twitter API ($200/mes por señal débil)
- LLM local pesado tipo FinGPT-7B (sin GPU)

---

## Orden de ejecución recomendado

```
P0 (lookahead) → re-validar Optuna con motor honesto → P1 (capital) → P2 (connector core)
→ P3 (loss registry) → P4 (warmup) → P5/P6 (features secundarias)
```

**Después de P0:** re-correr los estudios Optuna activos (COTI/XLM) y comparar top-5 previo vs post. Si los tops sobreviven con strictLookahead, su credibilidad se multiplica; si mueren, acabamos de ahorrarnos dinero real.

## Validación global

```bash
node --check server/genesis/*.mjs
npm run typecheck && npm run build
npx vitest run api/auth          # auth intacta
python scripts/optuna_evolve.py --pair COTIUSDT --trials 20 --loss sharpe   # smoke post-P0
curl localhost:8787/api/genesis/live    # compat schema aditiva
```

## Riesgos transversales

1. Cambios de schema de estado: SIEMPRE aditivos (api/genesis/live.js y bots por-owner en producción).
2. Divergencia Decimal(JS)/Decimal(Python): tests cruzados contra demo del paper_connector.
3. Throttler debe ser singleton vía ccxtFeed desde el día 1.
4. Cada módulo nuevo entra detrás de feature-flag o default-compatible para poder revertir sin drama.
