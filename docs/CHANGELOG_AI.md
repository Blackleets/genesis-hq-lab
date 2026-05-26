# CHANGELOG_AI

Append-only log of every AI session that touched this repo. Newest entries
at the top. Use one block per session. Be honest about failures.

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
