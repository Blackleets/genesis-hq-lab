# CHANGELOG_AI

## 2026-06-09 - Codex

- Branch: `feat/genesis-life-os`
- Summary: Corregi la reconciliacion para que mercados de prediccion confirmados como `open` ya no se marquen falsamente como `orphans` solo por antiguedad. Tambien arregle el origen del bug en Polymarket: los nuevos trades guardaran el `market.id` de Gamma en vez de priorizar `conditionId`.
- Files touched: `server/memory/reconciliationEngine.mjs`, `server/marketScanner.mjs`, `docs/CHANGELOG_AI.md`
- Verification: `node --check server/memory/reconciliationEngine.mjs` ok; `node --check server/marketScanner.mjs` ok; `node --test server/tests/reconciliation.test.mjs` ok; `npm run agent:futures:once` ok

## 2026-06-09 - Codex

- Branch: `feat/genesis-life-os`
- Summary: Cerre el `scalp_v2` huerfano de ETH con el monitor real usando precio live y deje un arranque `futures-only` reutilizable. El runner ahora puede operar solo el scheduler de futures sin tick de prediction markets ni loop crypto legacy, incluyendo `npm run agent:futures:once` para disparar una pasada real del worker.
- Files touched: `server/agentRunner.mjs`, `scripts/runFuturesOnlyAgent.mjs`, `package.json`, `.env.example`, `docs/CHANGELOG_AI.md`
- Verification: `node --check server/agentRunner.mjs` ok; `node --check scripts/runFuturesOnlyAgent.mjs` ok; `npm run agent:futures:once` ok; `npm run futures:status` ok

## 2026-06-09 - Codex

- Branch: `feat/genesis-life-os`
- Summary: Prepare el stack para operacion `futures-first` sin ruido de scalp/swing/event. Agregue switches reales por engine, documente las flags, y cree `npm run futures:status` / `npm run futures:once` para disparar el worker de futures breakout y leer posiciones/PnL reales desde SQLite + precios live.
- Files touched: `.env.example`, `package.json`, `scripts/futuresDesk.mjs`, `server/strategies/scalpingEngine.mjs`, `server/strategies/swingEngine.mjs`, `server/strategies/eventAlphaEngine.mjs`, `docs/CHANGELOG_AI.md`
- Verification: `node --check scripts/futuresDesk.mjs` ok; `npm test` ok; `npm run build` ok; `npm run futures:once` ok

## 2026-06-09 - Codex

- Branch: `feat/genesis-life-os`
- Summary: Unifique la observabilidad y las metricas del stack crypto para que los agentes `breakout` y `crypto_futures_breakout_*` no queden invisibles. Ahora dashboard, trade history, copilot, fatigue e inteligencia de mercado cuentan todo el universo crypto real y el scheduler puede mostrar actividad coherente de los workers nuevos.
- Files touched: `server/crypto/cryptoTradeUniverse.mjs`, `server/crypto/copilot.mjs`, `server/crypto/tradeHistory.mjs`, `server/intelligence/setupFatigue.mjs`, `server/crypto/marketIntelligence.mjs`, `server/index.mjs`, `docs/CHANGELOG_AI.md`
- Verification: `npm test` ok; `npm run build` ok

## 2026-06-09 - Codex

- Branch: `feat/genesis-life-os`
- Summary: Conecte agentes reales para el track de futures breakout. Añadi un worker `short_core` en futures paper y un `long_probe` separado para comparacion, ambos integrados al scheduler SLOW. Tambien deje la comparativa en el lab: `ETH+SOL short-only 4h` pasa (`PF test 1.70`, `EV test 1.27`) y `long-only` falla OOS, asi que el edge actual sigue siendo bajista y estrecho.
- Files touched: `server/crypto/backtest/strategyLab.mjs`, `server/strategies/futuresBreakoutEngine.mjs`, `server/trading/executionScheduler.mjs`, `server/trading/positionMonitor.mjs`, `server/crypto/cryptoTradeUniverse.mjs`, `server/tests/strategyLab.test.mjs`, `server/tests/futuresBreakoutEngine.test.mjs`, `docs/CHANGELOG_AI.md`
- Verification: `node --check server/strategies/futuresBreakoutEngine.mjs` ok; `node --check server/trading/executionScheduler.mjs` ok; `npm test` ok

## 2026-06-09 - Codex

- Branch: `feat/genesis-life-os`
- Summary: Endureci la base de research y ejecucion crypto para la siguiente fase. Agregue una hipotesis explicita `ETH+SOL short-only 4h` que ya pasa el lab, corregi el evaluador para estrategias narrow one-sided, y separe la infraestructura `futures paper` con metadatos, coste, funding y liquidacion sin contaminar el stack spot actual.
- Files touched: `server/trading/costs.mjs`, `server/crypto/cryptoExecution.mjs`, `server/trading/paperExecutionEngine.mjs`, `server/trading/positionMonitor.mjs`, `server/crypto/cryptoTradeUniverse.mjs`, `server/crypto/backtest/strategyLab.mjs`, `server/db/schema.sql`, `server/db/database.mjs`, `server/tests/costsCrypto.test.mjs`, `server/tests/strategyLab.test.mjs`, `docs/CHANGELOG_AI.md`
- Verification: `node --check server/trading/costs.mjs` ok; `node --check server/crypto/cryptoExecution.mjs` ok; `node --check server/trading/paperExecutionEngine.mjs` ok; `node --check server/crypto/backtest/strategyLab.mjs` ok; `npm test` ok; `npm run build` ok

## 2026-06-09 - Codex

- Branch: `feat/genesis-life-os`
- Summary: Cerre el research de rediseño crypto que habia quedado a medias: integre el experimento `scalp_regime_gated` al lab con tests directos del gating por regimen y deje `trendSearch` accesible via `npm run crypto:trend-search` para evaluar edge HTF sin tocar la ruta live.
- Files touched: `server/crypto/backtest/strategyLab.mjs`, `server/crypto/backtest/trendSearch.mjs`, `server/tests/strategyLab.test.mjs`, `package.json`, `docs/CHANGELOG_AI.md`
- Verification: `node --check server/crypto/backtest/strategyLab.mjs` ok; `node --check server/crypto/backtest/trendSearch.mjs` ok; `npm test` ok

## 2026-06-09 - Codex

- Branch: `feat/genesis-life-os`
- Summary: Pulí el sidebar principal para reducir ruido visual: active state más sobrio, navegación más compacta, headers de sección más limpios, chrome carbon consistente y scrollbar integrado. No se tocó lógica de navegación ni módulos.
- Files touched: `src/ui/GenesisSidebar.tsx`, `docs/CHANGELOG_AI.md`
- Verification: `npm run typecheck` ok; `npm run build` ok; `npm test` ok; Playwright local preview ok con backend local offline esperado

## 2026-06-09 - Codex

- Branch: `feat/genesis-life-os`
- Summary: Agrande el chart principal de Crypto Lab reorganizando el grid: el grafico toma el espacio restante como foco principal y los paneles inferiores quedan compactos. Tambien compacte el panel de orden manual y volvi el toggle `Trades` mas legible sin activarlo por defecto.
- Files touched: `src/index.css`, `src/dashboard/charts/CandleChart.tsx`, `src/components/crypto/ChartStatsHeader.tsx`, `docs/CHANGELOG_AI.md`
- Verification: `npm run typecheck` ok; `npm run build` ok; `npm test` ok; Playwright local preview ok con backend local offline esperado

## 2026-06-09 - Codex

- Branch: `feat/genesis-life-os`
- Summary: Limpie el chart principal de Crypto Lab ocultando los markers historicos detras de un toggle `Trades`, manteniendo visible solo el trade seleccionado cuando aplica. Esto reduce ruido visual y deja el panel mas cercano a una experiencia real tipo TradingView/DexScreener sin tocar backend ni trading.
- Files touched: `src/dashboard/charts/CandleChart.tsx`, `src/components/crypto/ChartStatsHeader.tsx`, `docs/CHANGELOG_AI.md`
- Verification: `npm run typecheck` ok; `npm run build` ok; `npm test` ok

## 2026-06-08 - Codex

- Branch: `feat/genesis-life-os`
- Summary: Active por defecto el candidato en sombra `btc_trend_1h_v1` en el backend, manteniendolo read-only y apagable solo via `SHADOW_CANDIDATE_ENABLED=false`. Esto evita depender del dashboard de Render para poblar el panel frontend ya desplegado.
- Files touched: `server/crypto/shadowCandidate.mjs`, `docs/CHANGELOG_AI.md`
- Verification: `node --check server/crypto/shadowCandidate.mjs` ok; `npm test` ok

## 2026-06-08 - Codex

- Branch: `feat/genesis-life-os`
- Summary: Añadi una superficie frontend minima para el sidecar de research crypto. `Crypto Lab` ahora muestra un panel `Shadow candidate` dentro de `DeskPanel > STATS`, leyendo `/api/crypto/shadow-candidate` sin tocar los paneles live ni el layout principal.
- Files touched: `src/services/cryptoClient.ts`, `src/components/crypto/ShadowCandidatePanel.tsx`, `src/components/crypto/DeskPanel.tsx`, `src/workflows/CryptoLabView.tsx`, `docs/CHANGELOG_AI.md`
- Verification: `npm run build` ok; `npm test` ok

## 2026-06-08 - Codex

- Branch: `feat/genesis-life-os`
- Summary: Implemente el sidecar estricto de research crypto sin tocar la ruta live. Anadi `strategyLab` con experimentos canonicos BTC-only (baseline, trend, mean reversion), el runner `crypto:lab`, y un endpoint read-only `/api/crypto/shadow-candidate` para evaluar candidatos en sombra sin abrir trades.
- Files touched: `server/crypto/backtest/strategyLab.mjs`, `server/crypto/shadowCandidate.mjs`, `server/index.mjs`, `scripts/runCryptoStrategyLab.mjs`, `server/tests/strategyLab.test.mjs`, `server/tests/shadowCandidate.test.mjs`, `package.json`, `docs/CHANGELOG_AI.md`
- Verification: `node --check server/crypto/backtest/strategyLab.mjs` ok; `node --check server/crypto/shadowCandidate.mjs` ok; `node --check server/index.mjs` ok; `node scripts/runCryptoStrategyLab.mjs` ok; `npm test` ok; `npm run build` ok

## 2026-06-08 - Codex

- Branch: `feat/genesis-life-os`
- Summary: Volvi ejecutable el plan de recuperacion del scalp con un runner de decision live. `scripts/cryptoPhase1Check.mjs` ahora consolida verdad de metricas, disponibilidad del backtest, estado honesto del LLM y el `nextTrack` recomendado; ademas anadi `npm run crypto:phase1`.
- Files touched: `package.json`, `scripts/cryptoPhase1Check.mjs`
- Verification: `node scripts/cryptoPhase1Check.mjs` ok; `npm run crypto:phase1` ok; `npm test` ok; `npm run build` ok

## 2026-06-08 — Codex

- Branch: `feat/genesis-life-os`
- Summary: Hardened crypto LLM truth reporting so diagnostics no longer imply Claude is active in the live scalp scheduler. `llm` now declares that the live scalp path is deterministic, marks Claude status as `unverified` until a real crypto debate call happens, and keeps the legacy debate-loop status separate. Added regression coverage for both the unverified and fallback-on-402 cases.
- Files touched: `server/crypto/cryptoLlmStatus.mjs`, `server/tests/cryptoTruth.test.mjs`, `src/services/cryptoClient.ts`
- Verification: `node --check server/crypto/cryptoLlmStatus.mjs` ok; `node --check server/tests/cryptoTruth.test.mjs` ok; `node --test server/tests/cryptoTruth.test.mjs` ok; `npm test` ok; `npm run build` ok

---

Append-only log of every AI session that touched this repo. Newest entries
at the top. Use one block per session. Be honest about failures.

---

## 2026-06-03 — Claude Opus 4.8 (sistema de evolución visual de agentes)

- **Branch:** `feat/genesis-life-os`
- **Summary:** Sistema de evolución visual real, data-driven. `agentLevel(agent)` deriva un nivel (1..~60) de forma determinista de campos reales (`learningScore`*28 + rank_ordinal*4 + min(tradeCount,24)*0.5 − mistakeCount) — sube cuando el agente aprende, asciende y opera. 4 tiers acumulativos (Rookie 1-5, Professional 6-15, Elite 16-30, Legendary 31+). El sprite base NUNCA cambia (identidad sagrada); la evolución solo añade capas de refinamiento con el color de acento del propio agente: capa `ground` (anillo de base → aura premium → nodos orbitales rotando) bajo los pies, y capa `crest` (tick → galón → corona icónica + halo respirante) sobre la cabeza. Integrado en `pixelCanvasRenderer` (2 pasadas: antes/después del sprite) + badge de tier/nivel/progreso en `AgentInspector` y mini-badge en `AgentTooltip`. Verificado: curva produce los 4 tiers correctamente (intern nuevo→Rookie, senior experto→Legendary).
- **Files touched:** `src/animations/agentEvolution.ts` (nuevo), `src/animations/pixelCanvasRenderer.ts`, `src/agents/AgentInspector.tsx`, `src/agents/AgentTooltip.tsx`
- **Verification:** `npx tsc -b` limpio (0 errores) + `npm run build` verde (4382 módulos, 4.09s). Niveles validados con casos reales. Sin datos inventados — nivel es función pura de campos del agente.

---

## 2026-06-03 — Claude Opus 4.8 (refactor arquitectónico modular)

- **Branch:** `feat/genesis-life-os`
- **Summary:** Reorganización completa de `src/` de estructura por-tipo-técnico (`components/` 46, `lib/` 22, `data/` 14) a 10 módulos por dominio: `core/` (store, types, i18n, data), `services/`, `animations/`, `agents/`, `dashboard/`, `activity/`, `creator/`, `workflows/`, `ui/`, `hooks/`. Introducidos **path aliases por módulo** (`@core`, `@agents`, etc.) en tsconfig + vite. 105 archivos movidos con historia preservada; 210 reglas de reescritura de imports generadas automáticamente desde la ubicación final y aplicadas (relativos → aliases). `App.tsx` adelgazado de **762 → 95 líneas** extrayendo 5 vistas inline a archivos propios (`HQView`, `HRView`, `SettingsView` → `ui/views/`; `DecisionsView`, `AutoView` → `workflows/`). Sin cambios de comportamiento. `genesisStore.ts` reubicado pero no partido (fuera de alcance). `server/` intacto.
- **Files touched:** `tsconfig.app.json`, `vite.config.ts` (aliases); 105 archivos reubicados en `src/`; `src/App.tsx` reescrito; 5 archivos de vista nuevos. Plan: `docs/superpowers/specs` (plan mode).
- **Verification:** `npx tsc -b` limpio (0 errores) + `npm run build` verde (4382 módulos, 3.14s). `npm run lint`: 8 errores pre-existentes (react-hooks/purity, set-state-in-effect, react-refresh) — ninguno de resolución de imports; no bloquean build (per AGENTS.md). Plan aprobado por el operador antes de ejecutar.

---

## 2026-06-03 — Claude Opus 4.8 (auditoría + unificación de diseño)

- **Branch:** `feat/genesis-life-os`
- **Summary:** Auditoría completa de la UI (38 archivos, 586 font-sizes ad-hoc, 67 cards planos idénticos, solo 11 sombras en toda la app) y construcción de un sistema de diseño unificado "Profundidad sutil" sin romper la estética terminal. Fundación: tokens en `tailwind.config.js` (escala tipográfica semántica `gx-micro`…`gx-h1` con line-height, tracking canónico `gx-label`/`gx-over`/`gx-hero`, sombras de elevación `gx-card`/`gx-pop`/`gx-well`, color `trim-lit`) + clases de componentes en `index.css` (`.gx-card` con borde-superior-luz + sombra suave, `.gx-tile`, `.gx-card-head`, `.gx-card-title`, `.gx-label`, `.gx-overline`, `.gx-btn`, `.gx-divider`, scrollbars premium globales). Aplicación mecánica segura: 95 superficies → `gx-card`, 34 → `gx-tile`, 27 → `gx-card-head`, 84 patrones tipográficos → clases semánticas, outliers (`10.5px`→11, `7px`→8) normalizados. Acentos por departamento conservados. Glow sutil de división en el item activo del sidebar.
- **Files touched:** `tailwind.config.js`, `src/index.css`, `src/components/GenesisSidebar.tsx`, y ~30 componentes vía reemplazo mecánico de clases de superficie/tipografía.
- **Verification:** `npm run build` — OK (tsc -b limpio, vite build 4382 módulos en 4.09s; CSS 30.7→32.4kB por las clases nuevas). Decisiones de dirección (superficie con profundidad sutil + acentos por departamento) confirmadas con el operador antes de ejecutar.

---

## 2026-06-03 — Claude Sonnet 4.6 (Agent Creator cinematográfico + build verde)

- **Branch:** `feat/genesis-life-os`
- **Summary:** Construyó el Agent Creator cinematográfico de 6 pasos (ADN de Personalidad → Modelo Cerebral → Habilidades → Apariencia → Comportamiento → Misión) con intro y revelación de "nacimiento", transiciones spring de framer-motion, y un núcleo de ADN vivo (`AgentDnaCore`) en SVG que evoluciona con el draft. Reemplaza el `FactoryView` (formulario). Verificó el sistema de agentes IA reales end-to-end con un mock OpenAI-compatible (estados thinking→processing→completed reales, tokens reales, memoria SQLite persistida). Arregló errores de build: míos (re-export Bilingual huérfano, icono `agents-live` faltante en sidebar, tipos WsMessage para agent:status/log/completed) y dos pre-existentes que bloqueaban el build desde antes (`now` fuera de scope en GenesisHeader, import no-type-only `EnvTileId` en KenneyAtlas).
- **Files touched:** `src/components/agentCreator/creatorData.ts` (nuevo), `src/components/agentCreator/AgentDnaCore.tsx` (nuevo), `src/components/agentCreator/AgentCreator.tsx` (nuevo), `src/App.tsx` (eliminó FactoryView muerto), `src/state/genesisStore.ts` (createAgentFromFactory campos ricos), `src/components/GenesisSidebar.tsx`, `src/hooks/useWebSocket.ts`, `src/hooks/useAgentExecution.ts`, `src/components/GenesisHeader.tsx`, `src/components/KenneyAtlas.tsx`
- **Verification:** `npm run build` — OK (tsc -b limpio, vite build 4382 módulos en 3.91s). Solo warning pre-existente de tamaño de chunk.

---

## 2026-06-03 — Claude Sonnet 4.6 (command bar premium)

- **Branch:** `feat/genesis-life-os`
- **Summary:** Construyó `CommandBar.tsx` — paleta de comandos cinematic con overlay blur, panel animado (cmd-enter spring), placeholder rotante multi-idioma, sugerencias por categoría con hover accent, atajos de teclado (⌘K toggle, Tab completar, Esc cerrar), ejecución real a `/api/command/execute`, y trigger ⌘K en `GenesisHeader`. `CommandBarProvider` envuelve el árbol en `App.tsx`.
- **Files touched:** `src/components/CommandBar.tsx` (nuevo), `src/components/GenesisHeader.tsx`, `src/App.tsx`
- **Verification:** `npx tsc --noEmit` ok.

---

## 2026-06-03 — Claude Sonnet 4.6 (sistema agentes IA reales)

- **Branch:** `feat/genesis-life-os`
- **Summary:** Construyó sistema completo de agentes IA reales: `server/agents/` (providerRouter, agentMemory, agentEngine, agentRegistry), nuevas rutas `/api/agents/*`, módulo `agents-live` en el sidebar con `AgentExecutionView`, hook `useAgentExecution`, tipos `RealAgent`. Estados derivados de ejecución real (thinking→processing→completed/error). Sin loaders falsos. Multi-provider (Claude/OpenAI/Gemini/Custom) via fetch nativo sin SDKs extra. Memoria SQLite por agente.
- **Files touched:** `server/agents/providerRouter.mjs`, `server/agents/agentMemory.mjs`, `server/agents/agentEngine.mjs`, `server/agents/agentRegistry.mjs`, `server/index.mjs`, `src/types/realAgent.ts`, `src/hooks/useAgentExecution.ts`, `src/components/AgentExecutionView.tsx`, `src/data/moduleRegistry.ts`, `src/i18n/translations.ts`, `src/App.tsx`
- **Verification:** `npx tsc --noEmit` ok (sin errores).

---

## 2026-06-03 — Claude Sonnet 4.6

- **Branch:** `feat/genesis-life-os`
- **Summary:** Reemplazó `LiveActivityFeed` con `AgentActivityFeed` — feed terminal en tiempo real con frases inteligentes por tipo de tarea, heartbeat de agentes activos cada 5.5s, animación slide-in CSS, colores del perfil visual de cada agente, e integración con WebSocket para eventos de backend (trade ejecutado, lección aprendida, posición cerrada).
- **Files touched:** `src/components/AgentActivityFeed.tsx` (nuevo), `src/App.tsx`, `docs/CHANGELOG_AI.md`
- **Verification:** `npx tsc --noEmit` ok (sin errores). Advertencias de linter sobre `style={}` son esperadas — colores dinámicos de agente requieren estilos en línea.

---

## 2026-06-03 — GitHub Copilot

- **Branch:** `feat/kalshi-order-execution`
- **Summary:** Added Kalshi real execution support by posting limit orders to Kalshi's trading API and falling back to a paper trade when the order fails.
- **Files touched:** `server/trading/execution.mjs`, `docs/CHANGELOG_AI.md`
- **Verification:** `node --check server/trading/execution.mjs` ok. Full repo build was not run because unrelated existing type errors remain in `src/components/GenesisHeader.tsx` and `src/components/KenneyAtlas.tsx`.

---

## 2026-06-03 — GitHub Copilot

- **Branch:** `feat/real-trading-mode`
- **Summary:** Added a configurable real trading execution path and removed fixed paper trading-only rules from the backend decision pipeline.
- **Files touched:** `server/trading/execution.mjs`, `server/trading/workflow.mjs`, `server/decisionEngine.mjs`, `server/agentRunner.mjs`, `server/trading/treasury.mjs`, `server/trading/analytics.mjs`, `server/skills/runSkillOpt.mjs`, `docs/CHANGELOG_AI.md`
- **Verification:** `npm run build` failed due to unrelated existing type errors in `src/components/GenesisHeader.tsx` and `src/components/KenneyAtlas.tsx`.

---

## 2026-06-02 — GitHub Copilot

- **Branch:** `fix/agent-runner-fallback`
- **Summary:** Updated `server/agentRunner.mjs` so missing `ANTHROPIC_API_KEY` does not abort a one-time run; the system now continues with fallback rule-based debate logic and paper trading can execute without Claude.
- **Files touched:** `server/agentRunner.mjs`, `docs/CHANGELOG_AI.md`
- **Verification:** `npm run agent:once` ok. Backend agent tick executed with fallback debate logic and no Anthropic key.

---

## 2026-06-02 — GitHub Copilot

- **Branch:** `fix/genesis-store-dirty-flag`
- **Summary:** Reduced redundant `dirty = true` assignments in `src/state/genesisStore.ts`, fixed React hook effect usage in `src/hooks/useWebSocket.ts`, and removed an unused import from `src/components/KenneyAtlas.tsx`.
- **Files touched:** `src/state/genesisStore.ts`, `src/hooks/useWebSocket.ts`, `src/components/KenneyAtlas.tsx`, `docs/CHANGELOG_AI.md`
- **Verification:** `npm run lint` ok.

---

## 2026-06-01 — Auto

- **Branch:** (working tree)
- **Summary:** Removed demo/mock trading UI. All capital, P&L, positions and history now read from backend SQLite via `useLiveTrading`. Disabled local `evaluatePaperTrades`. Added `/api/agent/marketing`, enriched `/api/health`. Removed fake wallet "real mode" and simulated marketing funnel.
- **Files touched:** `src/hooks/useLiveTrading.ts`, `src/hooks/useAgentData.ts`, `src/lib/agentClient.ts`, `src/components/TopBar.tsx`, `GenesisDashboard.tsx`, `MarketsView.tsx`, `LiveTradingPanel.tsx`, `TradingHistoryView.tsx`, `CapitalChart.tsx`, `ProgressView.tsx`, `MarketingView.tsx`, `WalletView.tsx`, `GenesisHeader.tsx`, `src/i18n/translations.ts`, `server/index.mjs`, `AGENTS.md`, `README.md`, `.env.example`, `docs/CHANGELOG_AI.md`
- **Verification:** not run (no node_modules in session)

## 2026-05-27 - Codex

- **Branch:** `feat/genesis-life-os`
- **Summary:** Upgraded the Markets screen into an operational console: live Polymarket board on the left, real agent execution rail on the right, auto-refresh every 30 seconds, queued task visibility, and recent execution events from the store.
- **Files touched:** `src/components/MarketsView.tsx`, `docs/CHANGELOG_AI.md`
- **Verification:** `npm run typecheck` ok. `npm run build` ok.

## 2026-05-27 - Codex

- **Branch:** `feat/genesis-life-os`
- **Summary:** Added a minimal local read-only backend for Polymarket and replaced the `markets` placeholder with a real Markets screen backed by normalized Gamma API data. No trading, no wallet flow, no fake data.
- **Files touched:** `package.json`, `server/index.mjs`, `server/polymarket.mjs`, `src/components/MarketsView.tsx`, `src/lib/marketsClient.ts`, `src/App.tsx`, `src/data/moduleRegistry.ts`, `docs/CHANGELOG_AI.md`
- **Verification:** `npm run typecheck` ok. `npm run build` ok. Backend smoke-tested on `http://127.0.0.1:8787/api/health` and `http://127.0.0.1:8787/api/polymarket/events?limit=2`.

## 2026-05-27 - Codex

- **Branch:** `feat/genesis-life-os`
- **Summary:** Added a real local life loop to the Genesis HQ canvas renderer. The office now updates through `requestAnimationFrame`, agents animate and move between room workstations from real task/store state, onboarding agents stay active in HR, fired agents render in a fired archive, and event-driven speech bubbles appear temporarily over the correct agents without changing backend or product logic.
- **Files touched:** `src/components/PixelOfficeCanvas.tsx`, `src/lib/pixelCanvasRenderer.ts`, `src/lib/pixelLifeLoop.ts`, `src/lib/agentMovement.ts`, `src/lib/conversationEngine.ts`, `src/data/officeWorkstations.ts`, `src/state/genesisStore.ts`, `docs/CHANGELOG_AI.md`
- **Verification:** `npm run typecheck` ok. `npm run build` ok. Preview checked locally on `http://127.0.0.1:4173/`.

---

## 2026-05-27 - Codex

- **Branch:** `feat/genesis-life-os`
- **Summary:** Replaced the Genesis HQ center map with a new canvas-based pixel office renderer and kept the old SVG world as legacy fallback. The new renderer uses a fixed low-resolution canvas, integer-grid furniture and agent placement, sprite registry + office map data, store-driven agents, hitboxes for hover/click selection, and no internal canvas scroll.
- **Files touched:** `src/App.tsx`, `src/components/PixelOfficeCanvas.tsx`, `src/components/PixelOfficeViewport.tsx`, `src/lib/pixelCanvasRenderer.ts`, `src/data/pixelOfficeMap.ts`, `src/data/pixelSpriteMap.ts`, `docs/CHANGELOG_AI.md`
- **Verification:** `npm run typecheck` ok. `npm run build` ok. Preview checked locally on `http://127.0.0.1:4173/`.

---

## 2026-05-27 - Codex

- **Branch:** `feat/genesis-life-os`
- **Summary:** Polished Genesis HQ fit-to-screen and office composition without touching live logic. The viewport now scales a fixed office world into the available space with no internal map scroll, tabs no longer force horizontal overflow, side panels are slimmer, and the office scene uses tighter sprite proportions and softer zone separation for a more coherent pixel-office look.
- **Files touched:** `src/components/OfficeViewport.tsx`, `src/components/GenesisOfficeWorld.tsx`, `src/components/AgentSprite.tsx`, `src/components/PixelSprite.tsx`, `src/App.tsx`, `src/components/LiveActivityFeed.tsx`, `src/components/GenesisSidebar.tsx`, `docs/CHANGELOG_AI.md`
- **Verification:** `npm run typecheck` ok. `npm run build` ok. Preview checked locally on `http://127.0.0.1:4173/` with no internal horizontal map scroll detected.

---

## 2026-05-27 - Codex

- **Branch:** `feat/genesis-life-os`
- **Summary:** Integrated the `free-office-pixel-art` pack into Genesis HQ without changing store logic. The office world now uses real pixel sprites for core furniture and agents, keeps the existing one-screen layout, and documents the asset credits and extraction path for the lab.
- **Files touched:** `docs/ASSET_CREDITS.md`, `src/assets/officePixelAssets.ts`, `src/components/PixelSprite.tsx`, `src/components/AgentSprite.tsx`, `src/components/GenesisOfficeWorld.tsx`, `docs/CHANGELOG_AI.md`
- **Verification:** `npm run typecheck` ok. `npm run build` ok.

---

## 2026-05-27 - Codex

- **Branch:** `feat/genesis-life-os`
- **Summary:** Implemented the local Task Engine phase. Tasks now have the requested local model fields, the store exposes create/assign/start/complete/fail/archive and task selectors, agent status derives from task state, failures can increment `mistakeCount`, and completed tasks spawn a local memory-archive follow-up for `Memory Curator`.
- **Files touched:** `src/types/task.ts`, `src/types/genesis.ts`, `src/data/initialTasks.ts`, `src/state/genesisStore.ts`, `src/components/MetricsPanel.tsx`, `docs/CHANGELOG_AI.md`
- **Verification:** `npm run typecheck` ok. `npm run build` ok.

---

## 2026-05-27 - Codex

- **Branch:** `feat/genesis-life-os`
- **Summary:** Implemented the local Hiring Queue + 24h onboarding flow without backend changes. Hiring now creates a real onboarding agent in `hr-pod`, removes the candidate from the queue, blocks critical task assignment during onboarding, shows onboarding timing controls in Genesis HR, and keeps feed events for hired / onboarding started / onboarding completed.
- **Files touched:** `src/state/genesisStore.ts`, `src/components/OnboardingPanel.tsx`, `src/App.tsx`, `src/i18n/translations.ts`, `docs/CHANGELOG_AI.md`
- **Verification:** `npm run typecheck` ok. `npm run build` ok.

---

## 2026-05-27 - Codex

- **Branch:** `feat/genesis-life-os`
- **Summary:** Centralized the local Genesis UI state in the persistent store. The language store now delegates to `genesisStore`, the app restores language/module/agent selection from one source of truth, metrics now read live store data instead of seeds, and fresh boots still start with only the 5 active agents plus the requested 8-item hiring queue.
- **Files touched:** `src/state/persistence.ts`, `src/state/genesisStore.ts`, `src/data/futureAgents.ts`, `src/i18n/languageStore.ts`, `src/components/MetricsPanel.tsx`, `src/App.tsx`, `docs/CHANGELOG_AI.md`
- **Verification:** `npm run typecheck` ok. `npm run build` ok.

---

## 2026-05-26 — Claude (Sonnet 4.6) — session 4 (Genesis Life OS)

- **Branch:** `feat/genesis-life-os` (renamed from `feat/enterprise-characters`).
- **Summary:** Built the Genesis Life Operating System. Genesis HQ is now
  the visual representation of a real, persistent local system — not a
  scripted demo. State lives in `src/state/genesisStore.ts` and persists
  to `localStorage`. A `tick()` runs every 5s to advance movement, finish
  onboarding, start/complete tasks. All bubbles and feed entries are
  derived from real `SystemEvent` entries — no hard-coded conversation
  script.
- **What's now live:**
  - 5 active seed agents (Genesis Core, Market Scanner, Risk Guardian,
    Memory Curator, HR Evaluator) — others wait in `hiringQueue`.
  - **Hiring** — clicking "Hire" on a candidate creates a real agent in
    `status=onboarding` with `onboardingEndsAt = now + 24h`. The tick
    auto-transitions them to `idle` when the timer elapses. Dev mode
    surfaces a "Complete onboarding now" button per agent.
  - **Task engine** — tasks have status, room, assignee, estimatedMs.
    Assigned agents walk (lerp) to the room; on arrival the task
    auto-starts; after `estimatedMs` it auto-completes. agent.status
    derives from this lifecycle (idle → moving → working → idle).
  - **Live bubbles** — `useLiveBubbles` reads recent voiced events from
    the store; old `useConversationCycle` is now a thin compat shim.
  - **Activity feed** — reads from `state.events` (append-only, capped at
    200 to bound storage).
  - **Work screens** — `WorkScreen` opens per room with tasks + agents
    currently in that room. Risk Bunker / Execution Desk show the
    explicit "execution locked" / "read-only pending" banners.
  - **Dashboard** — real metrics computed from the store
    (`progressEngine.computeProgress`).
  - **Settings** — language toggle, dev mode toggle, reset button
    (with confirm) to clear persisted state and reboot the lab.
- **Persisted across reloads:** agents, tasks, events, modules, upgrades,
  hiring queue, fired agents, devMode, bornAt, language.
- **Backend:** 0. Polymarket: 0. Trading: 0. Real money: 0. Execution
  module remains explicitly locked with copy.
- **Files added (created):**
  - `src/types/{task,event,hiring,office,progress,module}.ts`
  - `src/state/{persistence,genesisStore}.ts`
  - `src/data/{officeRooms,initialAgents,initialTasks}.ts`
  - `src/lib/{liveBubbles,progressEngine,taskEngine,agentHelpers}.ts`
  - `src/components/{OnboardingPanel,WorkScreen,GenesisDashboard}.tsx`
- **Files modified:**
  - `src/types/genesis.ts` — extended Agent with movement + onboarding
    fields; role is now `string | { es; en }`.
  - `src/i18n/translations.ts` — ~30 new keys for Life OS UI.
  - `src/components/{LiveActivityFeed,HiringQueue,AgentInspector,AgentTooltip}.tsx`
    — read from store, bilingual.
  - `src/lib/agentMicroInteractions.ts` — re-exports `useLiveBubbles`.
  - `src/data/seedAgents.ts` — re-exports `INITIAL_AGENTS` for compat.
  - `src/experiments/CharacterPlayground.tsx` — guard for new role union.
  - `src/App.tsx` — module routing + tick loop.
- **Verification:** `npm run typecheck` exit 0. `npm run build` exit 0
  (302 KB JS, 17 KB CSS gzip 87 KB / 4 KB).
- **GitHub push attempt:** `gh` CLI token was expired ("HTTP 401: Bad
  credentials"). I did NOT push. The local commit is ready. The human
  needs to run `gh auth login` and then can either let me create the
  repo or do it themselves.
- **Notes for next AI:** the office still shows the 5 active agents
  statically — agents walking between rooms is wired but only fires when
  a new task is assigned to them. To see movement, fire an assignTask
  from devtools or wire a UI for it.

---

## 2026-05-26 — Claude (Opus 4.7) — session 3 (revert)

- **Branch:** `feat/enterprise-characters`
- **Summary:** Human rejected the visual direction of the
  `CharacterPlayground` shown as the main route. Reverted the main app
  back to the bootstrap landing (`LabHome`). Moved the playground to
  `src/experiments/CharacterPlayground.tsx` so it is reachable only as an
  experiment, never as the homepage.
- **Honest note (no fabricated history):** The human asked to "restore the
  previous Genesis HQ office view" with components named `GenesisHeader`,
  `GenesisSidebar`, `OfficeViewport`, `GenesisOfficeWorld`, `LiveActivityFeed`,
  `AgentInspector`. **None of those exist in this lab**, and most don't
  exist in `../genesis` either with those exact names. This repo has had
  exactly two states: (1) bootstrap landing, (2) CharacterPlayground.
  No Genesis HQ office view has ever existed here. The "restore" therefore
  means restoring the bootstrap landing — the only previous state of the
  lab. A port from `../genesis` is a separate task that was NOT done in
  this session.
- **Files touched (moved):**
  - `src/views/CharacterPlayground.tsx` → `src/experiments/CharacterPlayground.tsx`
  - `src/views/` removed (empty after move)
- **Files touched (modified):**
  - `src/App.tsx` — restored to the bootstrap landing (matches commit
    `305ba39`)
  - `package.json` — added `"typecheck": "tsc -b"` script (human asked to
    run `npm run typecheck` which did not previously exist)
- **Files preserved (not deleted):**
  - All of `docs/*.md`
  - `AGENTS.md`, `README.md`
  - Supporting components from session 2 (KenneyCharacter, RoleOverlay,
    KenneyAtlas, CharacterLegacy, ChatBubble, colorMatrix, fixtures, types,
    the Kenney atlas PNG) — kept on disk because the playground in
    `src/experiments/` still imports them. None of these run unless the
    playground is mounted manually.
- **Verification:** `npm run typecheck` exit 0. `npm run build` exit 0
  (195 KB JS, 10 KB CSS gzip). Both before commit.
- **Notes for the next AI:**
  - The main route now shows the bootstrap landing. It is NOT a Genesis
    HQ. If the human wants an HQ view in this lab, that requires a new
    porting task from `../genesis` — explicitly approved by the human.
  - Do not commit anything with a title like "Restore Genesis HQ" — the
    HQ never existed in this lab.

---

## 2026-05-25 — Claude (Opus 4.7) — session 2

- **Branch:** `feat/enterprise-characters`
- **Summary:** Built the enterprise-grade character system on top of Kenney
  RPG Urban Pack (CC0). Identified 10 character sprites in cols 23-26 of
  the atlas, mapped each archetype to a base sprite, and added a per-agent
  color tint via SVG `feColorMatrix` (luminance-preserving). Added 12
  small role overlays (shield, lock, glasses, flask, headset, chat bubble,
  book, clipboard, crown, wrench, palette, mic) layered on top of the
  Kenney sprite so role identity is visible. Built `CharacterPlayground`
  view that shows 10 mock agents × 3 columns (Legacy SVG / Kenney+tint /
  Kenney+tint+overlay) with status/pose/overlay/tint toggles for visual
  comparison.
- **Files touched (created):**
  - `src/types/genesis.ts` — trimmed subset of main project types
  - `src/fixtures/agents.json` — 10 mock agents (clearly labeled)
  - `src/lib/fixtures.ts` — fixture loader
  - `src/lib/colorMatrix.ts` — hex → SVG feColorMatrix soft tint helper
  - `src/components/ChatBubble.tsx` — port from main project (unchanged)
  - `src/components/KenneyAtlas.tsx` — port + extended with `CHARACTERS`
    map (10 sprites) and `ARCHETYPE_TO_TILE` lookup
  - `src/components/RoleOverlay.tsx` — 12 per-archetype mini accessories
  - `src/components/KenneyCharacter.tsx` — full character pipeline (shadow
    → halo → tinted Kenney sprite → role overlay → typing arms → learning
    particles → chat bubble → title)
  - `src/legacy/CharacterLegacy.tsx` — port of the old SVG-primitive
    character (baseline for comparison; do not edit)
  - `src/views/CharacterPlayground.tsx` — the comparison page
  - `public/assets/kenney-rpg-urban/Tilemap/tilemap_packed.png` — copied
    from `../genesis/public/assets/` (CC0, ~17KB compressed)
- **Files touched (modified):**
  - `src/App.tsx` — now mounts `CharacterPlayground`
- **Verification:** `npm run build` → exit 0 (346 KB JS, 9 KB CSS gzip).
  `npm run dev` running on :5173. Atlas PNG served correctly.
- **Notes for the next AI:**
  - **Decision pending from human:** which column wins. After approval,
    port the chosen component back to `../genesis/src/components/genesis/world/Character.tsx`.
  - If tint looks too flat at strength 0.75, try 0.55 or 0.9 via the slider.
  - The `CHARACTERS` map in `src/components/KenneyAtlas.tsx` is the place
    to swap sprite tiles if a particular archetype's base looks wrong.
  - Role overlays are tuned for a 16×16 sprite. If we resize the sprite
    later, the overlay coords need to be updated too.

---

## 2026-05-25 — Claude (Opus 4.7) — session 1

- **Branch:** `main` (bootstrap; no feature branch needed for the very
  first commit per human's instruction).
- **Summary:** Initial bootstrap of the genesis-hq-lab repo. Scaffolded
  Vite + React + TS, installed framer-motion + lucide-react +
  tailwindcss + postcss + autoprefixer, initialized Tailwind, wrote
  `AGENTS.md`, `README.md`, `.env.example`, and all five `docs/*.md`
  files. No application code yet — the lab is just bones.
- **Files touched (created):**
  - `AGENTS.md`
  - `README.md`
  - `.env.example`
  - `.gitignore` (additions for `.env`, `data/`)
  - `docs/VISION.md`
  - `docs/DESIGN_DIRECTION.md`
  - `docs/SAFE_WORKFLOW.md`
  - `docs/AI_HANDOFF.md`
  - `docs/CHANGELOG_AI.md` (this file)
  - `tailwind.config.js`
  - `postcss.config.js`
  - `src/index.css` (Tailwind directives)
- **Files touched (modified):**
  - default Vite scaffold (`package.json`, etc.) via `npm install`.
- **Verification:** `npm run build` — see most recent run.
- **Notes for the next AI:** No real Genesis HQ port yet. Start at
  `docs/AI_HANDOFF.md`.

## 2026-06-08 — Codex

- Branch: `feat/genesis-life-os`
- Summary: Unified the canonical crypto trade universe across analytics, diagnostics, risk reads, regime backtest, and PnL filters. Added autopsy sample counts + edge summary and persisted crypto Claude/fallback status so diagnostics can distinguish real LLM reasoning from deterministic fallback.
- Files touched: `server/crypto/cryptoTradeUniverse.mjs`, `server/crypto/cryptoLlmStatus.mjs`, `server/crypto/cryptoAnalytics.mjs`, `server/crypto/autoVeto.mjs`, `server/crypto/backtest/regimeBiasBacktest.mjs`, `server/crypto/cryptoRisk.mjs`, `server/crypto/marketIntelligence.mjs`, `server/crypto/copilot.mjs`, `server/crypto/cryptoDebate.mjs`, `server/memory/pnlEngine.mjs`, `server/index.mjs`, `server/tests/cryptoTruth.test.mjs`, `src/services/cryptoClient.ts`
- Verification: `npm run build` ok; `npm test` ok; `node --check` ok for touched server modules

## 2026-06-08 — Codex

- Branch: `feat/genesis-life-os`
- Summary: Added a read-only `PRO` validation lane for Crypto Lab using Binance-derived multi-timeframe EMA/RSI/MACD checks. Exposed `/api/crypto/pro-validation`, added frontend client types, and surfaced the operator-only panel without wiring anything into execution or risk.
- Files touched: `server/crypto/proValidation.mjs`, `server/tests/proValidation.test.mjs`, `server/index.mjs`, `src/services/cryptoClient.ts`, `src/components/crypto/RightPanel.tsx`, `src/components/crypto/ProValidationPanel.tsx`, `docs/CHANGELOG_AI.md`
- Verification: `node --check server/crypto/proValidation.mjs` ok; `node --check server/index.mjs` ok; `npm test` ok; `npm run build` ok; local `GET /api/crypto/pro-validation?pair=BTCUSDT` returned `bias=LONG_BIAS`, `action=validate_longs_only`, `score=3`

## 2026-06-09 - Codex

- Branch: `feat/genesis-life-os`
- Summary: Removed persistent text labels from unselected chart trade markers so the live chart keeps TradingView-style visual clarity while preserving selected-trade labels and click-to-select behavior.
- Files touched: `src/dashboard/charts/CandleChart.tsx`, `docs/CHANGELOG_AI.md`
- Verification: `npm run typecheck` ok; `npm run build` ok; `npm test` ok

## 2026-06-09 - Codex

- Branch: `feat/genesis-life-os`
- Summary: Tightened the Crypto Lab chart fidelity after live review by reducing trade-marker label clutter and hiding the volume series last-value label so the panel reads more like a real TradingView/DexScreener chart.
- Files touched: `src/dashboard/charts/CandleChart.tsx`, `docs/CHANGELOG_AI.md`
- Verification: `npm run typecheck` ok; `npm run build` ok; `npm test` ok; Playwright local render check ok with no console errors

## 2026-06-09 - Codex

- Branch: `feat/genesis-life-os`
- Summary: Finished the Crypto Lab chart panel polish with a DexScreener-style stats header, Binance 24h ticker stats, professional candle/volume styling, open-position price lines, improved trade markers, EMA toggles, and a subtle symbol watermark while preserving the existing lower layout and trading logic.
- Files touched: `src/dashboard/charts/CandleChart.tsx`, `src/components/crypto/ChartStatsHeader.tsx`, `src/services/chartTicker.ts`, `docs/CHANGELOG_AI.md`
- Verification: `npm run typecheck` ok; `npm run build` ok; `npm test` ok; Playwright local render check ok with no console errors

## 2026-06-08 - Codex

- Branch: `feat/genesis-life-os`
- Summary: Enforced the existing negative-edge recommendation as a cached scalp entry pause, so `scalp_v2` stops opening new trades once enough closed trades show negative EV/PF after additive filters while leaving execution, risk sizing, TP/SL, and paper management unchanged. Added throttled pause logging to keep operator events useful without 5-second spam.
- Files touched: `server/crypto/autoVeto.mjs`, `server/strategies/scalpingEngine.mjs`, `server/tests/autoVeto.test.mjs`, `docs/CHANGELOG_AI.md`
- Verification: `node --check server/crypto/autoVeto.mjs` ok; `node --check server/strategies/scalpingEngine.mjs` ok; `node --check server/tests/autoVeto.test.mjs` ok; `npm test` ok

- Summary: Hardened crypto truth consistency with a regression test that forces `/api/crypto/regime-backtest` BEFORE metrics to match the canonical closed-crypto trade universe used by overview and autopsy.
- Files touched: `server/tests/cryptoTruth.test.mjs`, `docs/CHANGELOG_AI.md`
- Verification: `node --check server/tests/cryptoTruth.test.mjs` ok; `npm test` ok; `npm run build` ok; live checks on `overview`, `diagnostics`, and `regime-backtest` all reflected `99` closed crypto trades

## 2026-06-08 — Codex

- Branch: `feat/genesis-life-os`
- Summary: Added a structured kill recommendation to crypto diagnostics/autopsy and surfaced it in the operator status bar so the system can explicitly say when to change or pause the strategy instead of continuing blind.
- Files touched: `server/crypto/autoVeto.mjs`, `server/tests/cryptoTruth.test.mjs`, `src/services/cryptoClient.ts`, `src/components/crypto/OperatorStatusBar.tsx`, `docs/CHANGELOG_AI.md`
- Verification: `node --check server/crypto/autoVeto.mjs` ok; `node --check server/tests/cryptoTruth.test.mjs` ok; `npm test` ok; `npm run build` ok; local `/api/crypto/diagnostics` returned recommendation payload successfully

## 2026-06-08 — Codex

- Branch: `feat/genesis-life-os`
- Summary: Extended crypto autopsy with toxic-segment breakdowns by pair, side, regime, UTC hour, and confidence band, and surfaced the worst slices in execution telemetry to guide additive gating/filtering decisions.
- Files touched: `server/crypto/autoVeto.mjs`, `server/tests/cryptoTruth.test.mjs`, `src/services/cryptoClient.ts`, `src/components/crypto/EngineTelemetry.tsx`, `docs/CHANGELOG_AI.md`
- Verification: `node --check server/crypto/autoVeto.mjs` ok; `npm test` ok; `npm run build` ok; local `/api/crypto/diagnostics` returned the new breakdown shape

## 2026-06-08 — Codex

- Branch: `feat/genesis-life-os`
- Summary: Added an explicit additive manual block for the toxic `SHORT_BEAR` setup so veto gating can shut it off immediately during training, and extended truth tests to expose the block in diagnostics config.
- Files touched: `server/crypto/autoVeto.mjs`, `server/tests/cryptoTruth.test.mjs`, `docs/CHANGELOG_AI.md`
- Verification: `node --check server/crypto/autoVeto.mjs` ok; `npm test` ok; `npm run build` ok

## 2026-06-08 — Codex

- Branch: `feat/genesis-life-os`
- Summary: Added additive manual context blockers for the next toxic slice in training: blocked hour buckets, blocked confidence bands, and blocked pairs now lower scalp confidence below the gate without touching execution, sizing, or TP/SL. Extended diagnostics config, scan snapshot visibility, and regression tests around the new gates.
- Files touched: `server/crypto/autoVeto.mjs`, `server/strategies/scalpingEngine.mjs`, `server/tests/autoVeto.test.mjs`, `server/tests/cryptoTruth.test.mjs`, `server/tests/scalpingContextBlocks.test.mjs`, `docs/CHANGELOG_AI.md`
- Verification: `node --check server/crypto/autoVeto.mjs` ok; `node --check server/strategies/scalpingEngine.mjs` ok; `npm test` ok; `npm run build` ok

## 2026-06-08 — Codex

- Branch: `feat/genesis-life-os`
- Summary: Activated the next evidence-backed additive filter by default: the toxic `80-89` confidence band is now manually blocked as a confidence gate, with updated diagnostics and regression tests to keep the operator truth explicit.
- Files touched: `server/crypto/autoVeto.mjs`, `server/tests/autoVeto.test.mjs`, `server/tests/cryptoTruth.test.mjs`, `server/tests/scalpingContextBlocks.test.mjs`, `docs/CHANGELOG_AI.md`
- Verification: `node --check server/crypto/autoVeto.mjs` ok; `npm test` ok; `npm run build` ok

## 2026-06-08 — Codex

- Branch: `feat/genesis-life-os`
- Summary: Escalated crypto diagnostics from generic change/pause advice to an explicit `pause_or_redesign_strategy` verdict once the system remains negative after 3 additive manual filters. Surfaced active filter count in operator status for a more decisionable desk view.
- Files touched: `server/crypto/autoVeto.mjs`, `server/tests/cryptoTruth.test.mjs`, `src/services/cryptoClient.ts`, `src/components/crypto/OperatorStatusBar.tsx`, `docs/CHANGELOG_AI.md`
- Verification: `node --check server/crypto/autoVeto.mjs` ok; `npm test` ok; `npm run build` ok

## 2026-06-08 — Codex

- Branch: `feat/genesis-life-os`
- Summary: Added a repo-grounded crypto core recovery plan with freeze, redesign, relaunch, and go/no-go criteria tied to the real live metrics already verified in production.
- Files touched: `docs/CRYPTO_CORE_RECOVERY_PLAN.md`, `docs/CHANGELOG_AI.md`
- Verification: documentation update only; no runtime code changed

## 2026-06-08 — Codex

- Branch: `feat/genesis-life-os`
- Summary: Rewrote the next-session prompt and Codex handoff so future sessions start from the real live state: negative edge, three additive filters active, and recovery-plan-first instead of Phase 4 feature work.
- Files touched: `docs/next-session-prompt.md`, `docs/codex-handoff.md`, `docs/CHANGELOG_AI.md`
- Verification: documentation update only; no runtime code changed

## 2026-06-08 — Codex

- Branch: `feat/genesis-life-os`
- Summary: Added a Phase 1 decision runbook with exact live checks, consistency rules, and the binary go/no-go criteria for shutting down or redesigning the current crypto scalp.
- Files touched: `docs/CRYPTO_PHASE1_DECISION_RUNBOOK.md`, `docs/CHANGELOG_AI.md`
- Verification: documentation update only; no runtime code changed

## 2026-06-08 — Codex

- Branch: `feat/genesis-life-os`
- Summary: Added a lightweight production checker script for Crypto Phase 1 so the operator can query live metrics and get a direct freeze vs pause/redesign verdict from the same canonical endpoints.
- Files touched: `scripts/cryptoPhase1Check.mjs`, `docs/CRYPTO_PHASE1_DECISION_RUNBOOK.md`, `docs/CHANGELOG_AI.md`
- Verification: `node --check scripts/cryptoPhase1Check.mjs` ok; `node scripts/cryptoPhase1Check.mjs` returned live production metrics

## 2026-06-08 — Codex

- Branch: `feat/genesis-life-os`
- Summary: Added a concrete redesign hypothesis plan for the crypto core, with experiment order, minimum pass metrics, and abort criteria so recovery can proceed one thesis at a time instead of adding more filters or features.
- Files touched: `docs/CRYPTO_REDESIGN_HYPOTHESES.md`, `docs/CHANGELOG_AI.md`
- Verification: documentation update only; no runtime code changed

## 2026-06-09 â€” Codex

- Branch: `feat/genesis-life-os`
- Summary: Exposed the real futures desk as shared backend snapshot logic plus `/api/crypto/futures-desk`, and surfaced it inside Crypto Lab so the operator can monitor live futures profiles, treasury, open positions, and closed PnL without simulated data.
- Files touched: `server/crypto/futuresDesk.mjs`, `scripts/futuresDesk.mjs`, `server/index.mjs`, `src/services/cryptoClient.ts`, `src/workflows/CryptoLabView.tsx`, `src/components/crypto/DeskPanel.tsx`, `src/components/crypto/FuturesDeskPanel.tsx`, `docs/CHANGELOG_AI.md`
- Verification: `node --check server/crypto/futuresDesk.mjs` ok; `node --check scripts/futuresDesk.mjs` ok; `node --check server/index.mjs` ok; `npm run futures:status` returned live snapshot; `npm run build` ok

## 2026-06-09 â€” Codex

- Branch: `feat/genesis-life-os`
- Summary: Upgraded the futures desk into an operable console: the worker now records real per-pair cycle outcomes, the last cycle persists to `data/futures-last-cycle.json`, the UI can trigger a real futures cycle manually, and the default liquid futures universe expands to BTC/ETH/SOL/BNB with long probe isolated.
- Files touched: `.env.example`, `server/strategies/futuresBreakoutEngine.mjs`, `server/crypto/futuresDesk.mjs`, `server/index.mjs`, `src/services/cryptoClient.ts`, `src/workflows/CryptoLabView.tsx`, `src/components/crypto/DeskPanel.tsx`, `src/components/crypto/FuturesDeskPanel.tsx`, `docs/CHANGELOG_AI.md`
- Verification: `node --check server/strategies/futuresBreakoutEngine.mjs` ok; `node --check server/crypto/futuresDesk.mjs` ok; `node scripts/futuresDesk.mjs` returned persisted last-cycle diagnostics; `npm run build` ok

## 2026-06-09 â€” Codex

- Branch: `feat/genesis-life-os`
- Summary: Added futures-only realized equity and lifecycle alert feeds to the desk, sourced directly from SQLite futures trades so opens/closes and cumulative PnL render in the same panel once real futures activity begins.
- Files touched: `server/crypto/futuresDesk.mjs`, `src/services/cryptoClient.ts`, `src/components/crypto/FuturesDeskPanel.tsx`, `docs/CHANGELOG_AI.md`
- Verification: `node --check server/crypto/futuresDesk.mjs` ok; `node scripts/futuresDesk.mjs` returned `equityCurve` and `recentLifecycle` fields; `npm run build` ok

## 2026-06-09 â€” Codex

- Branch: `feat/genesis-life-os`
- Summary: Split the futures short engine into isolated `short_core` and `short_alt` profiles so Tier 1 and Tier 2 pairs no longer share the same futures short bucket. Added XRP/DOGE as alt-liquid pairs, updated training/desk aggregates, and verified the live cycle now scans 4 core pairs and 2 alt pairs independently.
- Files touched: `.env.example`, `server/strategies/futuresBreakoutEngine.mjs`, `server/crypto/cryptoTradeUniverse.mjs`, `server/trading/positionMonitor.mjs`, `server/crypto/futuresDesk.mjs`, `server/index.mjs`, `server/crypto/marketIntelligence.mjs`, `src/services/cryptoClient.ts`, `src/components/crypto/FuturesDeskPanel.tsx`, `docs/CHANGELOG_AI.md`
- Verification: `node --check server/strategies/futuresBreakoutEngine.mjs` ok; `node --check server/crypto/futuresDesk.mjs` ok; real cycle showed `short_core` scanning BTC/ETH/SOL/BNB and `short_alt` scanning XRP/DOGE separately; `npm run build` ok

## 2026-06-09 â€” Codex

- Branch: `feat/genesis-life-os`
- Summary: Removed Claude as a hard dependency for learning by adding deterministic trade-lesson fallback logic, and added a data-driven futures governor that can keep profiles in learning mode or later degrade/pause them based on real closed-trade results.
- Files touched: `server/memory/learningEngine.mjs`, `server/crypto/futuresGovernor.mjs`, `server/strategies/futuresBreakoutEngine.mjs`, `docs/CHANGELOG_AI.md`
- Verification: `node --check server/memory/learningEngine.mjs` ok; `node --check server/crypto/futuresGovernor.mjs` ok; real futures snapshot now includes governor state for `short_core`, `short_alt`, and `long_probe`; `npm run build` ok

## 2026-06-09 â€” Codex

- Branch: `feat/genesis-life-os`
- Summary: Added a persistent futures governor journal stored in `org_state`, exposed it through the futures desk snapshot, and rendered it in the desk so every profile state transition (`learning`, `degraded`, `paused`, `active`) is traceable with timestamp and performance context.
- Files touched: `server/crypto/futuresGovernor.mjs`, `server/strategies/futuresBreakoutEngine.mjs`, `server/crypto/futuresDesk.mjs`, `src/services/cryptoClient.ts`, `src/components/crypto/FuturesDeskPanel.tsx`, `docs/CHANGELOG_AI.md`
- Verification: `node --check server/crypto/futuresGovernor.mjs` ok; `node --check server/crypto/futuresDesk.mjs` ok; real desk snapshot returned `governorJournal` entries; `npm run build` ok

## 2026-06-09 â€” Codex

- Branch: `feat/genesis-life-os`
- Summary: Activated `long_probe` in runtime, upgraded the futures governor with ranking metrics (`expectancy`, `profit factor`, `max drawdown`, `rank score`), and surfaced that ranking in the desk so the operator can compare `core`, `alt`, and `probe` on one board while the governor controls sizing and kill states.
- Files touched: `.env`, `.env.example`, `server/crypto/futuresGovernor.mjs`, `server/strategies/futuresBreakoutEngine.mjs`, `src/services/cryptoClient.ts`, `src/components/crypto/FuturesDeskPanel.tsx`, `docs/CHANGELOG_AI.md`
- Verification: real futures cycle showed `long_probe` enabled and scanning `BTCUSDT`/`ETHUSDT`; `short_core` scanned 4 pairs, `short_alt` scanned 2 pairs, `long_probe` scanned 2 pairs; `npm run build` ok

## 2026-06-09 Ã¢â‚¬â€ Codex

- Branch: `feat/genesis-life-os`
- Summary: Added a non-destructive futures PnL baseline reset, introduced the `short_micro` 5m profile, completed the `5m/15m/1h/4h` multi-timeframe futures wiring across backend and UI, and surfaced per-profile timeframe and baseline state in the futures desk.
- Files touched: `.env.example`, `package.json`, `scripts/resetFuturesPnlBaseline.mjs`, `server/crypto/futuresGovernor.mjs`, `server/crypto/marketIntelligence.mjs`, `server/index.mjs`, `src/services/cryptoClient.ts`, `src/components/crypto/FuturesDeskPanel.tsx`, `docs/CHANGELOG_AI.md`
- Verification: `node --check server/strategies/futuresBreakoutEngine.mjs` ok; `node --check server/crypto/futuresDesk.mjs` ok; `node --check server/crypto/futuresGovernor.mjs` ok; `node --check server/index.mjs` ok; `node --check scripts/resetFuturesPnlBaseline.mjs` ok; `npm run build` ok; `npm run futures:reset` wrote baseline `2026-06-09T14:59:54.924Z`; `npm run futures:once` scanned `short_micro` 2 pairs, `short_core` 4, `short_alt` 2, `long_probe` 2 with live `inside_channel` no-entry reasons

## 2026-06-09 Ã¢â‚¬â€ Codex

- Branch: `feat/genesis-life-os`
- Summary: Added a real per-profile futures supervisor with cooldown triggers, persisted recent futures cycle history into SQLite-backed `org_state`, and surfaced a live "today" block plus compact profile scoreboard/history in the futures desk.
- Files touched: `server/crypto/futuresGovernor.mjs`, `server/strategies/futuresBreakoutEngine.mjs`, `server/crypto/futuresDesk.mjs`, `src/services/cryptoClient.ts`, `src/components/crypto/FuturesDeskPanel.tsx`, `docs/CHANGELOG_AI.md`
- Verification: `node --check server/crypto/futuresGovernor.mjs` ok; `node --check server/strategies/futuresBreakoutEngine.mjs` ok; `node --check server/crypto/futuresDesk.mjs` ok; `npm run build` ok; `npm run futures:once` ok; live snapshot at `2026-06-09T15:19:32.092Z` showed all 4 profiles active in `learning`, supervisor `live`, zero daily PnL since baseline, and cycle history persisted with `10` scans and `0` executions

## 2026-06-09 Ã¢â‚¬â€ Codex

- Branch: `feat/genesis-life-os`
- Summary: Moved the futures desk card to the top of the Crypto Lab `STATS` column so the production URL surfaces the futures controls first instead of burying them below telemetry and breakout diagnostics.
- Files touched: `src/components/crypto/DeskPanel.tsx`, `docs/CHANGELOG_AI.md`
- Verification: `npm run build` ok; browser verification on `https://genesis-hq-lab.vercel.app/` confirmed `DESK DE FUTUROS` is present inside `Crypto Lab -> STATS`

## 2026-06-09 - Codex

- Branch: `feat/genesis-life-os`
- Summary: Hardened the futures desk manual cycle flow so `RUN CYCLE NOW` waits longer for the real backend cycle, keeps the last valid snapshot if refresh lags, and stops showing the false "backend did not return snapshot" state during slow live runs.
- Files touched: `src/services/cryptoClient.ts`, `src/workflows/CryptoLabView.tsx`, `docs/CHANGELOG_AI.md`
- Verification: `npm run build` ok

## 2026-06-09 - Codex

- Branch: `feat/genesis-life-os`
- Summary: Added a dedicated futures PnL block with realized/unrealized/net-since-baseline values, exposed snapshot age in the desk, and wired a non-destructive baseline reset endpoint plus UI control so the operator can start futures reporting from zero without deleting historical losing trades.
- Files touched: `server/crypto/futuresDesk.mjs`, `server/index.mjs`, `src/services/cryptoClient.ts`, `src/workflows/CryptoLabView.tsx`, `src/components/crypto/DeskPanel.tsx`, `src/components/crypto/FuturesDeskPanel.tsx`, `docs/CHANGELOG_AI.md`
- Verification: `node --check server/index.mjs` ok; `node --check server/crypto/futuresDesk.mjs` ok; `npm run build` ok

## 2026-06-09 - Codex

- Branch: `feat/genesis-life-os`
- Summary: Replaced the stale scalp PnL headline with treasury-consistent capital metrics (`net`, `available`, `margin`, `open`) and switched the Crypto Lab header to live futures metrics so the UI reflects reserved capital from the 10k base instead of the legacy `-67` scalp figure. Also raised default futures profile sizing into more usable margin bands with configurable per-profile leverage.
- Files touched: `.env.example`, `server/strategies/futuresBreakoutEngine.mjs`, `src/services/agentClient.ts`, `src/dashboard/hooks/useLiveTrading.ts`, `src/ui/TopBar.tsx`, `src/workflows/CryptoLabView.tsx`, `docs/CHANGELOG_AI.md`
- Verification: `node --check server/strategies/futuresBreakoutEngine.mjs` ok; `npm run build` ok

## 2026-06-09 - Codex

- Branch: `feat/genesis-life-os`
- Summary: Shifted the Crypto Lab operator row into futures-first mode when the futures desk is present, so it reports futures scan/qualified/executed status instead of legacy scalp pause messaging. Added a dedicated `Capital flow` block in the futures desk to show base start, reserved margin, free capital, and live net in one place.
- Files touched: `src/components/crypto/OperatorStatusBar.tsx`, `src/components/crypto/FuturesDeskPanel.tsx`, `src/workflows/CryptoLabView.tsx`, `docs/CHANGELOG_AI.md`
- Verification: `npm run build` ok

## 2026-06-09 - Codex

- Branch: `feat/genesis-life-os`
- Summary: Made `Crypto Lab` futures-first end-to-end: the desk now hides legacy scalp telemetry panels when futures profiles are active, strips `SCALPING PAUSED` commentary from the live ticker/feed, and sets backend defaults toward futures-only operation with fee-aware futures breakout targets.
- Files touched: `.env.example`, `server/agentRunner.mjs`, `src/components/crypto/DeskPanel.tsx`, `src/workflows/CryptoLabView.tsx`, `docs/CHANGELOG_AI.md`
- Verification: `node --check server/agentRunner.mjs` ok; `npm run build` ok

## 2026-06-09 - Codex

- Branch: `feat/genesis-life-os`
- Summary: Hardened durable production boot by making the Supabase replicator add missing Postgres columns on startup instead of assuming a fresh schema, which fixes the live `trades.instrument_type` replication failure. Also pinned the Render blueprint env to futures-only mode with explicit TP/SL so production stops drifting back into mixed legacy crypto behavior.
- Files touched: `server/persistence/dbReplicator.mjs`, `render.yaml`, `docs/CHANGELOG_AI.md`
- Verification: `node --check server/persistence/dbReplicator.mjs` ok; `npm run build` ok

## 2026-06-09 - Codex

- Branch: `feat/genesis-life-os`
- Summary: Added an economics gate to the futures breakout engine so setups are rejected when estimated net TP after fees/funding is too small or reward/risk is too weak, and upgraded the futures governor to promote strong profiles with more capital/leverage while keeping weaker ones constrained. Exposed the new desk thresholds and richer profile scoreboard metrics to the UI contract.
- Files touched: `.env.example`, `server/crypto/futuresGovernor.mjs`, `server/crypto/futuresDesk.mjs`, `server/strategies/futuresBreakoutEngine.mjs`, `src/components/crypto/FuturesDeskPanel.tsx`, `src/services/cryptoClient.ts`, `docs/CHANGELOG_AI.md`
- Verification: `node --check server/crypto/futuresGovernor.mjs` ok; `node --check server/strategies/futuresBreakoutEngine.mjs` ok; `npm run build` ok

## 2026-06-09 - Codex

- Branch: `feat/genesis-life-os`
- Summary: Fixed the production futures desk crash by restoring the missing `getFuturesGovernorSnapshot` import in the backend snapshot builder, which was causing `/api/crypto/futures-desk` to return HTTP 500 and hide live futures state/PnL from the UI.
- Files touched: `server/crypto/futuresDesk.mjs`, `docs/CHANGELOG_AI.md`
- Verification: `node --check server/crypto/futuresDesk.mjs` ok; `npm run build` ok

## 2026-06-09 - Codex

- Branch: `feat/genesis-life-os`
- Summary: Hardened the futures desk path so partial backend failures no longer crash the whole endpoint: the snapshot builder now captures per-section errors into warnings with safe fallbacks, the HTTP handler returns a degraded payload instead of 500, and the frontend renders that degraded state visibly instead of pretending there is no response.
- Files touched: `server/crypto/futuresDesk.mjs`, `server/index.mjs`, `src/components/crypto/FuturesDeskPanel.tsx`, `src/services/cryptoClient.ts`, `docs/CHANGELOG_AI.md`
- Verification: `node --check server/crypto/futuresDesk.mjs` ok; `node --check server/index.mjs` ok; `npm run build` ok

## 2026-06-09 - Codex

- Branch: `feat/genesis-life-os`
- Summary: Split the futures desk capital view from the global treasury so the panel reports futures-only reserved margin, available capital, equity, and PnL instead of inheriting stale legacy reservations from unrelated open trades. Kept the global treasury visible as secondary context so mismatches are explicit instead of silent.
- Files touched: `server/crypto/futuresDesk.mjs`, `server/index.mjs`, `src/components/crypto/FuturesDeskPanel.tsx`, `src/services/cryptoClient.ts`, `docs/CHANGELOG_AI.md`
- Verification: `node --check server/crypto/futuresDesk.mjs` ok; `node --check server/index.mjs` ok; `npm run build` ok

## 2026-06-09 - Codex

- Branch: `feat/genesis-life-os`
- Summary: Recalibrated the futures breakout geometry per timeframe instead of forcing one 55-bar channel everywhere: `short_micro` now uses 20 bars, `short_alt` 12, `short_core` 34, and `long_probe` stays at 55. Added explicit channel-distance diagnostics to skipped `inside_channel` results so the operator can see how far each pair is from a real breakout trigger.
- Files touched: `.env.example`, `render.yaml`, `server/strategies/futuresBreakoutEngine.mjs`, `src/components/crypto/FuturesDeskPanel.tsx`, `src/services/cryptoClient.ts`, `docs/CHANGELOG_AI.md`
- Verification: `node --check server/strategies/futuresBreakoutEngine.mjs` ok; `npm run build` ok; live probe showed `15m` short setups can now qualify with the tighter period while `5m/1h/4h` still respect current market structure.

## 2026-06-10 - Codex

- Branch: `feat/genesis-life-os`
- Summary: In `FUTURES_ONLY_MODE`, startup reconciliation now expires and refunds any open paper trade that is not a managed futures position, so stale Polymarket/scalp inventory can no longer reserve the shared capital path used by the live futures desk.
- Files touched: `server/memory/reconciliationEngine.mjs`, `docs/CHANGELOG_AI.md`
- Verification: `node --check server/memory/reconciliationEngine.mjs` ok; `npm run build` ok

## 2026-06-10 - Codex

- Branch: `feat/genesis-life-os`
- Summary: Fixed `/api/health` for the futures-only runtime by falling back to the shared scheduler heartbeat when the legacy `agent_heartbeat.json` file is absent, so the production status bar can report the live futures agent instead of showing a false offline state.
- Files touched: `server/index.mjs`, `docs/CHANGELOG_AI.md`
- Verification: `node --check server/index.mjs` ok; `npm run build` ok

## 2026-06-10 - Codex

- Branch: `feat/genesis-life-os`
- Summary: Decoupled paper futures execution from the legacy treasury by introducing a dedicated futures capital ledger derived from futures trades only, and seeded the futures agent profiles so futures entries no longer fail on `agent_profiles` foreign keys.
- Files touched: `server/crypto/futuresCapital.mjs`, `server/crypto/futuresDesk.mjs`, `server/trading/paperExecutionEngine.mjs`, `server/db/schema.sql`, `docs/CHANGELOG_AI.md`
- Verification: `node --check server/crypto/futuresCapital.mjs` ok; `node --check server/crypto/futuresDesk.mjs` ok; `node --check server/trading/paperExecutionEngine.mjs` ok; `npm run build` ok; local paper futures open/close validation succeeded with `crypto_futures_breakout_short_micro-02d5b1c6`

## 2026-06-10 - Codex

- Branch: `feat/genesis-life-os`
- Summary: Made the visible status layer futures-first in production: `/api/health` now reports futures open-count and futures capital in `FUTURES_ONLY_MODE`, `useLiveTrading` switches to the futures desk as the source of visible capital/margin/open metrics, and the top/tech status bars now label and render those values accordingly instead of mixing in the legacy treasury view.
- Files touched: `server/index.mjs`, `src/services/agentClient.ts`, `src/dashboard/hooks/useLiveTrading.ts`, `src/ui/TopBar.tsx`, `src/ui/TechView.tsx`, `docs/CHANGELOG_AI.md`
- Verification: `node --check server/index.mjs` ok; `npm run build` ok

## 2026-06-10 - Codex

- Branch: `feat/genesis-life-os`
- Summary: Removed the remaining global-treasury line from the futures desk UI and added a futures break-even stop ratchet in the position monitor, so open futures trades can lock risk back to entry-plus-buffer once they have covered enough of the path toward TP.
- Files touched: `src/components/crypto/FuturesDeskPanel.tsx`, `server/trading/positionMonitor.mjs`, `docs/CHANGELOG_AI.md`
- Verification: `node --check server/trading/positionMonitor.mjs` ok; `npm run build` ok

## 2026-06-10 - Codex

- Branch: `feat/genesis-life-os`
- Summary: Unified `/api/health` with the live futures mark-to-market path so the production status layer now reports the same real futures equity, unrealized PnL, and available capital as the futures desk instead of a stale zero-PnL snapshot.
- Files touched: `server/crypto/futuresDesk.mjs`, `server/index.mjs`, `docs/CHANGELOG_AI.md`
- Verification: `node --check server/crypto/futuresDesk.mjs` ok; `node --check server/index.mjs` ok; `npm run build` ok

## 2026-06-10 - Codex

- Branch: `feat/genesis-life-os`
- Summary: Rebuilt the Crypto Lab chart surface for operator readability: expanded the terminal grid so panels stop clipping, added separate toggles for trade markers/entries/exits/labels, overlaid live trade badges directly on the candlestick chart, and upgraded the trade timeline + selected-trade card with real capital and leverage context from persisted trades.
- Files touched: `server/crypto/tradeHistory.mjs`, `src/services/cryptoClient.ts`, `src/dashboard/charts/CandleChart.tsx`, `src/components/crypto/ChartStatsHeader.tsx`, `src/components/crypto/TradeTimeline.tsx`, `src/components/crypto/TradeStoryCard.tsx`, `src/index.css`, `docs/CHANGELOG_AI.md`
- Verification: `node --check server/crypto/tradeHistory.mjs` ok; `npm run build` ok

## 2026-06-10 - Codex

- Branch: `feat/genesis-life-os`
- Summary: Hardened the live office renderer without changing behavior: the pixel office now respects `VITE_USE_LIVE_TILE_OFFICE=false` to fall back to the previous SVG office, and sprite loading no longer fails all-or-nothing when one asset is missing. If the canvas renderer cannot initialize, HQ safely falls back to the legacy office instead of breaking.
- Files touched: `src/animations/pixelCanvasRenderer.ts`, `src/animations/PixelOfficeCanvas.tsx`, `src/ui/views/HQView.tsx`, `src/vite-env.d.ts`, `docs/CHANGELOG_AI.md`
- Verification: `npm run build` ok; `npm run typecheck` ok

## 2026-06-10 - Codex

- Branch: `feat/genesis-life-os`
- Summary: Merged the latest `origin/main` backend fixes together with Claude's live tile office branch, then resolved `HQView` so Genesis now prefers the new tile office when enabled, falls back safely to the pixel canvas if tile assets fail, and still degrades to the legacy office if the canvas renderer cannot initialize.
- Files touched: `server/index.mjs`, `server/trading/positionMonitor.mjs`, `src/ui/views/HQView.tsx`, `public/assets/office/*`, `src/hooks/useLiveOfficeState.ts`, `src/office/*`, `docs/CHANGELOG_AI.md`
- Verification: `npm run build` ok; `npm run typecheck` ok

## 2026-06-10 - Codex

- Branch: `feat/genesis-life-os`
- Summary: Upgraded the live office dialogue layer so agents now speak work-focused lines by role instead of generic filler, and the office bubbles follow the active `es/en` language without inventing trading outcomes.
- Files touched: `src/office/officeTypes.ts`, `src/office/officeDialogueRules.ts`, `src/office/agentDialogue.ts`, `src/office/TileOffice.tsx`, `docs/CHANGELOG_AI.md`
- Verification: `npm run typecheck` ok; `npm run build` ok

## 2026-06-10 - Codex

- Branch: `feat/genesis-life-os`
- Summary: Made office bubbles react to real system context instead of random chatter: the relevant desk now gets speaking priority when the engine degrades, risk rises, open positions exist, or commentary implies pause/breakout/momentum, and each role turns those signals into honest Spanish/English work speech.
- Files touched: `src/office/agentDialogue.ts`, `docs/CHANGELOG_AI.md`
- Verification: `npm run typecheck` ok; `npm run build` ok
