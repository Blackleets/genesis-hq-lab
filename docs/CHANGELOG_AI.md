# CHANGELOG_AI

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
