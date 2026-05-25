# Genesis HQ Lab

Isolated experimentation space for the **Genesis HQ** visual layer —
pixel-art top-down office, animated agents, conversation bubbles,
Kenney/RPG asset integration, and any UI/UX prototypes that should not
risk the main `genesis` project.

> **Why this repo exists:** the main Genesis project has a working backend
> (Fastify + SQLite + agents + decisions) and we do not want UI experiments
> breaking it. Everything visual happens here first; only proven results
> graduate back to `../genesis`.

---

## What's inside

- React 19 + Vite 7 + TypeScript
- Tailwind CSS 3
- Framer Motion (for tiny per-sprite animations)
- Lucide React (for non-sprite icons in the surrounding UI)
- No backend. This lab uses static mocks or reads JSON fixtures from
  `src/fixtures/` for prototyping. Mocks must be clearly labeled.

## Quick start

```bash
npm install
npm run dev     # http://localhost:5173
npm run build   # production build (typecheck + bundle)
npm run lint    # ESLint
npm run preview # serve the production build locally
```

## Project structure

```text
genesis-hq-lab/
├── AGENTS.md              # Rules for any AI working here — MANDATORY READING
├── README.md              # this file
├── docs/
│   ├── VISION.md          # what we are building and why
│   ├── DESIGN_DIRECTION.md# visual rules + palette + references
│   ├── SAFE_WORKFLOW.md   # how to make changes without breaking things
│   ├── AI_HANDOFF.md      # template for handing off context between AIs
│   └── CHANGELOG_AI.md    # append-only log of AI contributions
├── src/                   # React app source
├── public/                # static assets (sprite sheets, etc.)
├── .env.example           # copy to .env and fill local values
└── package.json
```

## Rules (short version)

1. Never work on `main` directly — branch first.
2. Never invent data and present it as real.
3. Never modify sibling projects on disk.
4. Read `docs/VISION.md` and `docs/DESIGN_DIRECTION.md` before any UI change.
5. Append to `docs/CHANGELOG_AI.md` after every task.

Full rules: `AGENTS.md`.

## Status

Bootstrap only. No features yet. The first real task is to port a small
Genesis HQ slice (one room with a few agents) into this lab so we can
iterate visuals without touching `../genesis`.
