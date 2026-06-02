# AI_HANDOFF — Live state for the next AI

Update this file at the end of every session. It is the first thing the next AI
reads after `AGENTS.md`.

---

## Current state — 2026-06-02

- **Branch:** `cursor/update-improvement-plan-4eb6`
- **What's done:** Updated `docs/IMPROVEMENT_PLAN.md` so it reflects the current
  Genesis HQ Lab state: React/Vite frontend, Node/SQLite backend, live paper
  trading, marketing/signals/skills endpoints, Render/Vercel deploy path, and
  the main remaining gap between the visual HQ store and the real backend.
- **What's NOT done:** No product code was changed. The plan identifies
  implementation work but does not execute it.
- **Build status:** `npm run build` should be checked in the latest session log.

## Next concrete task

Implement P0 from `docs/IMPROVEMENT_PLAN.md`:

1. Create a live state adapter that maps backend data from `useAgentData` /
   `useLiveTrading` into visual agent/task state.
2. Make `PixelOfficeCanvas` and the office life loop reflect backend reality
   when online.
3. Keep `genesisStore` for local UI state only; do not use local simulated
   positions/capital as operational truth.
4. Show explicit offline/provider-not-configured states instead of fabricating
   activity.

## Known traps

- `docs/VISION.md` and `docs/DESIGN_DIRECTION.md` are binding before UI edits.
- Trading execution is paper-only in SQLite. Do not imply real-money Polymarket
  CLOB exists.
- `src/state/genesisStore.ts` still contains local `capital`, `positions` and
  `closedPositions`; treat them as legacy/local unless proven otherwise.
- Kalshi must say "Provider not configured" when credentials are missing.
- There is no test suite yet; money/risk changes should start by adding focused
  coverage.

## Open questions for the human

- Should Render stay on the free plan for demos, or should the project require
  an always-on paid instance for continuous market resolution?
- Should Kalshi be implemented now, or should all Kalshi claims be removed until
  credentials and data quality are confirmed?

## Things the previous AI deferred

- Rewriting or archiving `docs/MIGRATION_PLAN.md`, which is now mostly stale.
- Aligning `README.md` with the current Vite version and deployment status.
