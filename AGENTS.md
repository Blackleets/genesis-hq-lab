# AGENTS.md — Rules for any AI working on this repo

This document is **mandatory reading** for any AI assistant (Claude, Codex,
Cursor, Antigravity, Gemini, GPT, or any other) that opens this repo.

By making your first edit to this codebase you agree to the rules below.
Violating them is grounds for the human operator to roll back your changes.

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

## 2. File operations

- **Never delete a file without explaining why** in the commit message AND in
  `docs/CHANGELOG_AI.md`. If unsure, comment-out instead of deleting.
- **Never run** `rm -rf`, `git clean -fdx`, `git reset --hard`,
  `npm cache clean --force`, or any destructive shell command without the
  human's explicit approval in the same session.
- **Never overwrite files** outside of this repo. If you need to read
  `agency-agents` or any other project, you may **only read** — never write.

## 3. Secrets & credentials

- **Never commit secrets.** No API keys, no tokens, no wallets, no private
  keys, no `.env` (only `.env.example` is allowed).
- **Never print secrets** in logs or in chat output.
- If a secret leaks in a commit, **stop everything** and tell the human
  immediately. Do not try to "fix it" with a rebase.

## 4. Data integrity

- **Never invent data and present it as real.** If you don't have a backend
  response, show a clearly labeled placeholder ("Mock data — not connected")
  or an empty state. Never hardcode fake numbers as if they were live.
- **Never connect this lab to real money.** No real trading, no real wallets,
  no real on-chain transactions. Simulated only.
- If an API/provider is not configured, the UI must say
  `"Provider not configured"` explicitly. No silent fallbacks that fabricate
  responses.

## 5. Scope discipline

- **This lab is isolated.** Do not modify any sibling project on disk
  (`../genesis`, `../agency-agents`, `../Remix-Os`, `../NFYN`, etc.). You may
  read `../agency-agents` for reference, nothing more.
- **No background processes** that outlive the session. No daemons, no
  cronjobs installed globally.
- **No global installs** without asking. Stick to project-local `node_modules`.

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

If the build is broken, say so clearly. Do not pretend it passes.

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

_Last updated: 2026-05-25._
