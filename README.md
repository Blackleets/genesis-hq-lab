# Genesis HQ Lab

Experimentation and **operational surface** for **Genesis HQ** — pixel-art office,
autonomous trading agent (Polymarket data + SQLite execution), and module UI.

> Isolated from the main `../genesis` project so visual and agent experiments
> do not break production.

---

## What's inside

- React 19 + Vite 7 + TypeScript + Tailwind
- **Backend** (`server/`) — Node HTTP API, SQLite, agent runner (5 min ticks)
- **Trading pipeline** — SCAN → VETO → DEBATE → EXECUTE (real market data; execution in DB)
- **HQ canvas** — pixel office with live agent state

## Quick start

```bash
npm install
npm run start     # server + agent + web together
npm run dev       # frontend only (needs server for live data)
npm run build
npm run lint
```

**Live data requires:** `npm run start` (or `npm run server` + `npm run agent` + `npm run dev`).

Optional: copy `.env.example` → `.env` and set `ANTHROPIC_API_KEY` for AI debates/plans.

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

## Genesis Maintainer Orchestrator

Este repo usa un protocolo interno de mantenimiento para evitar fixes incompletos, demos falsas y cambios sin evidencia. Antes de declarar un cambio como listo, todo fix critico debe incluir diagnostico, tests, build, evidencia y live proof cuando aplique.

## Status

Operational lab: backend agent + UI wired to **real SQLite trades** (not local mock positions).
Next milestone: Polymarket CLOB for on-chain execution.
