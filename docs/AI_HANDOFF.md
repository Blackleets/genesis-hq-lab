# AI_HANDOFF — Live state for the next AI

Update this file at the end of every session. It is the first thing the
next AI reads (after `AGENTS.md`).

> Replace the placeholder section below with the current state. Keep the
> structure. Don't accumulate stale handoffs — overwrite.

---

## Current state — 2026-05-25 (bootstrap)

- **Branch:** `main`
- **What's done:** Vite + React + TS scaffold, Tailwind initialized,
  docs/ folder populated, `.env.example` created.
- **What's NOT done:** No real Genesis HQ port yet. `src/` still has the
  default Vite landing page.
- **Build status:** `npm run build` — see latest `docs/CHANGELOG_AI.md`.

## Next concrete task

Port a minimal Genesis HQ slice into this lab:

1. Copy these files from `../genesis/src/` as starting points (re-read
   them, do not assume they are still current):
   - `components/genesis/world/OfficeMap.tsx`
   - `components/genesis/world/Character.tsx`
   - `components/genesis/world/furniture.tsx`
   - `components/genesis/world/KenneyAtlas.tsx`
   - `components/genesis/world/ChatBubble.tsx`
   - `hooks/usePolling.ts`
   - `hooks/useAgentChatter.ts`
2. Stub out anything that pulls from a backend with fixtures from
   `src/fixtures/agents.json` (you create this).
3. Make sure the shared types live in `src/types/genesis.ts` (port from
   `../genesis/shared/types.ts`, trimmed).
4. `npm run build` must pass.
5. Update this file with whatever you broke, deferred, or discovered.

## Known traps

- The main `genesis` project uses React 18; this lab uses React 19.
  Some Framer Motion APIs differ — read the Framer Motion 11+ docs if
  things look weird.
- Tailwind here is v3 by design (Tailwind v4 changes the config format and
  we are not ready to migrate the visual conventions).
- TypeScript strict is on. Don't add `any` to silence errors — narrow the
  type or refactor.

## Open questions for the human

(none currently)

## Things the previous AI deferred

(none currently — this is the first session)
