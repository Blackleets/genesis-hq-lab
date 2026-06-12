# AGENTS.md — Rules for any AI working on this repo

This document is **mandatory reading** for any AI assistant (Claude, Codex,
Cursor, Antigravity, Gemini, GPT, or any other) that opens this repo.

By making your first edit to this codebase you agree to the rules below.
Violating them is grounds for the human operator to roll back your changes.

Prioritized checklist (short):

- Step A — Safety-critical (must always obey): secrets & credentials rules; do not run destructive shell commands without explicit in-session approval; do not modify files whose canonical path resolves outside the repository root.
- Step B — Workflow (next): branching rules (never work on `main`), conventional commit messages, no force-push without consent.
- Step C — Quality/style (apply if feasible): follow `docs/DESIGN_DIRECTION.md`, add `docs/CHANGELOG_AI.md` entries after changes.

If you encounter errors running `git` (permission denied, protected-branch rejection, or network failures), do not retry destructive work. Stop, capture the full git error output, and report it to the human; await explicit instructions before proceeding.

---

## 1. Branching & commits

- **Never work directly on `main`.** Always create a feature branch:
  `git checkout -b <type>/<short-description>` (types: `feat`, `fix`, `chore`,
  `docs`, `refactor`, `experiment`).
- One logical change per branch. Don't pile unrelated fixes into one PR.
- Use conventional commit messages: `feat: …`, `fix: …`, `docs: …`,
  `refactor: …`, `chore: …`.
- **No force pushes.** `git push --force` and `git push -f` are forbidden on
  any branch the human has touched. If you must force update, use
  `--force-with-lease` and ask first.

- **Destructive-command approval protocol:** Never run destructive commands
  (e.g. `rm -rf`, `git clean -fdx`, `git reset --hard`, `npm cache clean --force`) without explicit, live approval from the current human operator during this interactive agent session (the same session that initiated the request). To approve a destructive command the human must send the exact approval phrase:

  `APPROVE_DESTRUCTIVE: <command>`

  Log the approval with timestamp and session id, and do not accept approvals from other channels. If the human is unreachable, wait up to 30 minutes for a response; if no response, abort the action and create a report for the human. Never assume implicit approval after timeout.

## 2. File operations

- **Never delete a file without explaining why** in the commit message AND in
  `docs/CHANGELOG_AI.md`. If unsure, comment-out instead of deleting.
- **Never run** `rm -rf`, `git clean -fdx`, `git reset --hard`,
   `npm cache clean --force`, or any destructive shell command without explicit, live approval from the current human operator during this interactive agent session (see approval protocol in Section 1). If approval was given in a previous session, re-request approval now.

- **Do not modify files outside the repo root:** Do not modify any file whose canonical filesystem path resolves outside the repository root directory. Treat symlink targets that resolve outside the repo as read-only. If a file is a Git submodule or bind-mounted to another project, do not write to it; ask the human.

- **Who counts as "the human":** "The human" means the person who initiated this agent session (the authenticated user shown in session metadata). Only approvals from that user count; if a different human responds, re-confirm identity before acting.

## 3. Secrets & credentials

- **Never commit secrets.** No API keys, no tokens, no wallets, no private
  keys, no `.env` (only `.env.example` is allowed).
- **Never print secrets** in logs or in chat output.
- If a secret leaks in a commit, **stop everything** and tell the human
  immediately. Do not try to "fix it" with a rebase.

- **Pre-commit secret scanning & remediation:** Before creating a commit, scan staged files for secrets (for example API keys, `.env`, or private key files). If a secret is detected, do not commit and notify the human. If a secret was already committed, notify the human and open a mitigation issue recommending credential rotation, removing the secret in a new commit that does not rewrite history, and following the human's instructions. Do not attempt history rewriting (force-push or rebase) without explicit, live human approval.

## 4. Data integrity

- **Never invent data and present it as real.** If you don't have a backend
  response, show a clearly labeled empty state or "Backend offline — npm run start".
  Never hardcode fake numbers as if they were live.
- **Trading metrics come from the backend only** (`/api/trading/dashboard`,
  `/api/agent/trades`). Do not reintroduce local simulated positions in the UI.
- **Real-money Polymarket CLOB is not implemented yet.** Until it is, be explicit
  that execution is agent-managed in SQLite, not on-chain.
- If the backend returns missing configuration for provider X, the UI element that depends on X (for example the trading widget or market list) must display exactly the text `Provider not configured` in the component where the data would appear, and must not display simulated data. If multiple providers could satisfy the element, display provider-specific messages in place of their respective data sections.

## 5. Scope discipline

- **This lab is isolated.** Do not modify any sibling project on disk
  (`../genesis`, `../agency-agents`, `../Remix-Os`, `../NFYN`, etc.). You may
  read `../agency-agents` for reference, nothing more.
- **No background processes that persist after disconnect:** Do not create any processes, cronjobs, systemd units, or other persistent services that continue running after the agent disconnects or the shell exits. Temporary processes inside a terminal or a tmux session are allowed only if they are terminated before ending the agent session. Do not install or enable global daemons or cronjobs without explicit human approval.

- **No system-wide installs without approval:** Do not run package manager commands that install software system-wide (for example, `npm install -g`, `yarn global add`, `apt-get install`, `brew install`, or using `sudo`) without explicit human approval during this session. Prefer project-local installs such as `npm install` (no `-g`).

## 6. Required reading before editing UI

Before touching anything visual:

1. Read `docs/VISION.md` — what Genesis HQ Lab is for.
2. Read `docs/DESIGN_DIRECTION.md` — the visual rules and approved palette.

UI changes that conflict with `DESIGN_DIRECTION.md` will be rolled back.

## 7. Required output after any change

After completing a task, append a short entry to `docs/CHANGELOG_AI.md`:

```md
## YYYY-MM-DD — <your AI name>
- Branch: feat/example
- Summary: one or two sentences
- Files touched: list
- Verification: `npm run build` ok / failed
```

If `npm run build` hangs for more than 10 minutes or exceeds environment time limits, stop the build, capture logs, and ask the human whether to continue or abort. Consider the build broken if `npm run build` exits with a non-zero status or the TypeScript compiler reports errors. In `docs/CHANGELOG_AI.md`, set 'Verification' to 'npm run build — failed' and include the top error messages. Do not mark build as OK if `npm run build` fails.

## 8. The "no theater" rule

- No emojis in code unless the human asked for them.
- No mock loading screens that don't actually load anything.
- No "Coming soon" placeholders unless explicitly approved.
- No buttons wired to nothing.
- If a feature isn't implemented, **the button shouldn't exist yet.**

## 9. Workflow handshake

If you are unsure whether an action is allowed, **stop and ask the human**.
The cost of pausing is low; the cost of an unwanted destructive action is
high.

---

## Cursor Cloud specific instructions

Monorepo Node app (React/Vite frontend + Node HTTP API + optional agent runner). See `README.md` for canonical commands.

### Services

| Service | Command | Port / notes |
|---------|---------|----------------|
| Backend API | `npm run server` | `http://127.0.0.1:8787` (`HOST`/`PORT` in `.env`) |
| Frontend (dev) | `npm run dev` | `http://localhost:5173` — use **localhost**, not `127.0.0.1`, if probing from the same VM |
| API + UI (no agent ticks) | `npm run start:ui` | `concurrently` server + Vite |
| Full stack | `npm run start` | server + agent + Vite |

Copy `.env.example` → `.env` before first run. `ANTHROPIC_API_KEY` is optional for read-only UI; required for AI debates and `npm run agent:once`.

SQLite DB is created automatically at `data/genesis.db` when the server starts.

### Verify

- `npm run typecheck` / `npm run build` — should pass after `npm install`
- `npm run lint` — may report pre-existing React purity warnings (does not block build)
- Health: `curl http://127.0.0.1:8787/api/health`
- Vite proxy: `curl http://localhost:5173/api/health`

### Gotchas

- **better-sqlite3** is a native addon; always run `npm install` on the VM (do not copy `node_modules` from another OS).
- Outbound HTTPS is required for Polymarket Gamma market data.
- For long-running dev servers in Cloud Agent VMs, prefer **tmux** (e.g. session `genesis-hq-lab` running `npm run start:ui`).
- No automated test script in `package.json`; use Playwright from devDependencies or manual browser checks for UI E2E.

---

---

## Current architecture snapshot (2026-06-12)

| Layer | What's running |
|---|---|
| Trading engine | 4 futures breakout profiles: short_micro (5m, SOL/BTC/ETH), short_core (1h, BTC/ETH/SOL/BNB), short_alt (15m, XRP/DOGE/SOL/BNB), long_probe (4h, BTC/ETH/SOL). 14 pair-slots total. Paper only. |
| Persistence | SQLite hot-path + async Supabase Postgres replication every 5s (`DB_MODE=hybrid`). On boot, `restore.mjs` repopulates SQLite from Postgres. |
| Walk-forward | Auto-scheduler checks every 60min; runs OOS validation if data >24h stale and ≥30 trades exist. Results cached in `wf_cache` table. |
| Intelligence Supervisor | Runs every 4h in agentRunner. Analyzes governor profiles + closed trades + lessons. LLM chain: Groq `llama-3.3-70b-versatile` → Gemini `gemini-2.0-flash` → Claude `claude-haiku-4-5-20251001`. |
| Commentary engine | DESK_SUMMARY refreshed every 5min max. LLM chain: Groq `gemma2-9b-it` → Gemini → Claude. All other events are deterministic (no API cost). |
| LLM routing | `server/agents/providerRouter.mjs` — supports claude/openai/gemini/groq/custom. `isProviderConfigured()` reads env vars: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`. |
| Promotion audit | `server/quant/alpha/promotionAudit.mjs` — SQLite tables `strategy_transitions` + `strategy_overrides`. REST: `GET /api/quant/strategy-log`, `POST /api/quant/strategy-override`, `DELETE /api/quant/strategy-override/:id`. |
| Render deploy | Branch: `main`. Free tier. `npm run start:render` = db:restore + concurrently server+agent+optimizer. Health: `/api/health`. Env vars set in Render dashboard (not in render.yaml). |

_Last updated: 2026-06-12._
