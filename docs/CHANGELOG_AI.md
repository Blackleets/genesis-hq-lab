# CHANGELOG_AI

Append-only log of every AI session that touched this repo. Newest entries
at the top. Use one block per session. Be honest about failures.

---

## 2026-06-02 — GPT-5.5

- **Branch:** `cursor/update-improvement-plan-4eb6`
- **Summary:** Updated the improvement plan to reflect the current Genesis HQ state after the live-data wiring work. Reprioritized the roadmap around HQ-to-backend truth, tests for capital/risk logic, runtime observability, Sentinel/CEO autonomy, SkillOpt Phase 2, and documentation cleanup.
- **Files touched:** `docs/IMPROVEMENT_PLAN.md`, `docs/CHANGELOG_AI.md`, `docs/AI_HANDOFF.md`
- **Verification:** `npm run build` ok.

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
