# MIGRATION_PLAN — Genesis HQ Lab roadmap

This file maps out the phases beyond the current visual lab. It is a
roadmap, not a commitment. Phases land **only** when the prior phase is
visually approved AND there is explicit human authorization for the next
one. No phase starts on its own.

The current state is **visual lab only**:

- Genesis HQ renders as the main route
- All agents/activity are seeded with `isVisualSeed: true`
- No backend, no DB, no LLM providers, no Polymarket
- The CharacterPlayground from earlier iterations is parked in
  `src/experiments/` and never mounted

The phases below are the planned path **after** visual approval.

---

## Phase 8 — Backend base

Stand up a minimal Fastify + TypeScript server (or whatever the human
picks). One endpoint: `/api/health`. Nothing else live yet.

- Stack decision (Fastify vs Express vs Hono)
- TypeScript build + dev script
- CORS so the lab can talk to it locally
- Lint + typecheck pass

**Acceptance:** `curl /api/health` returns 200 with a non-fake body.

## Phase 9 — Agents in a real DB

Move the seed agents into a small SQLite (or whatever fits) schema.

- Migration script
- CRUD endpoints (read-only first)
- Lab gets a feature flag to read from real backend instead of fixture
- Visual layer doesn't change; only data source changes

**Acceptance:** the same office shows real DB rows, every row tagged as
"seed" until live data is created.

## Phase 10 — `agency-agents` importer

One-way importer that reads `../agency-agents/*.md` and turns each into
an Agent row. Read-only on `agency-agents`, never modify it.

- Frontmatter parsing
- Mapping folder → department
- Idempotent (re-running doesn't duplicate)
- Conflict policy (skip if source_file already exists)

**Acceptance:** running the importer once produces N agents; running it
twice produces the same N.

## Phase 11 — Genesis HR (real)

The inspector's "Promote / Retrain / Suspend / Fire" buttons start
writing to the DB.

- HR action endpoints
- Audit log entries
- Each action requires a human-readable reason (never silent)
- UI surfaces exit reports for fired agents

**Acceptance:** firing an agent in the inspector persists, shows up in
the activity feed, and the agent is removed from the office floor.

## Phase 12 — Polymarket (read-only)

Pull a small live snapshot of Polymarket markets via the public Gamma API.

- Read-only; no API key, no order placement
- Markets show in a separate Markets screen, not in HQ
- Failure to fetch is **shown** as "provider unreachable", not faked

**Acceptance:** the Markets screen displays at least one real market and
gracefully shows an error state when offline.

## Phase 13 — Decision Engine

A pure-TS module that takes a market + a set of agents and produces a
decision artifact: action, confidence, risk score, reasoning, agents
involved.

- Heuristic only (no LLM yet)
- Risk Guardian veto is enforced
- Decisions saved to DB and surfaced in the feed

**Acceptance:** clicking "Analyze" on a market produces a persisted
decision; the Decision Engine can be re-run deterministically.

## Phase 14 — LLM providers

Pluggable provider layer for Anthropic / OpenAI / Gemini.

- Each provider is opt-in by env var
- If no key, the UI explicitly says **"Provider not configured"** —
  never silently falls back to fake output
- Provider calls are wrapped with timeouts + error surfaces

**Acceptance:** the agent runtime uses an LLM when configured, falls
back to the heuristic otherwise, and the UI tells the user which mode
is active.

## Phase 15 — Memory + Progress

Agents remember outcomes. Progress (learning level, accuracy, etc.) is
computed from real history, not faked.

- `memory_entries` table
- Aggregate progress endpoint
- Visual progress page

**Acceptance:** the progress numbers move when the audit endpoint is
called; they do not move when there's no underlying activity.

## Phase 16 — Visual integration (real)

The HQ visual layer (this lab's work) is ported back into the production
genesis project, this time wired to the real backend.

- Replace fixture loader with real API client
- Bubble text comes from real `currentTask` or real `audit_logs`
- Inspector actions hit real endpoints
- isVisualSeed marker is dropped — every agent on screen is real

**Acceptance:** screenshots match the lab; activity feed entries match
real audit log entries; no `isVisualSeed: true` anywhere in production
data.

---

## Non-goals (still)

These remain out of scope even after Phase 16 unless explicitly authorized:

- Real money / on-chain execution
- Public deployment of the lab itself
- Multi-tenant accounts
- Mobile app
- 3D / WebGL anything
- Sound design
