# P0 Current-State Audit — 2026-09-12

Base audited: `feat/genesis-life-os` at `88cefdbc5058387f9b8d54210e3c8a834f5e3b7d`.

The historical `PROYECTO_ESTADO_COMPLETO.md` is from June 2026. This audit checks the current September code before changing anything.

## Result

| Historical item | Current verdict | Evidence / action |
|---|---|---|
| Pause legacy crypto scalping | ALREADY_FIXED | `server/command/orgState.mjs` defaults `crypto_scalping: false`; `FUTURES_ONLY_MODE` disables the legacy crypto loop by default. Futures v9 is intentionally untouched and remains PAPER-only. |
| P0.1 persistent peak capital | ALREADY_FIXED | `server/trading/treasury.mjs` persists `peak_capital` in SQLite `org_state`, reloads it from DB, seeds from capital history, and uses it for drawdown. The old requested dedicated `risk_state` table is unnecessary duplication. |
| P0.2 startup reconciliation | ALREADY_FIXED | `server/memory/reconciliationEngine.mjs` reconciles open positions at startup; `agentRunner.mjs` runs it before trading and degraded state blocks new trades. |
| P0.3 persistent org state | ALREADY_FIXED | `server/command/orgState.mjs` reads/writes SQLite `org_state` transactionally. |
| P0.4 API auth | FIXED_ON_THIS_BRANCH | Existing auth was fail-open when `API_SECRET` was absent and pause/resume writes were unprotected. This branch makes auth fail closed, allows the Authorization CORS header, protects pause/resume, and documents `API_SECRET` in `.env.example`. |
| P0.5 Kalshi silent fallback | ALREADY_FIXED | `server/trading/execution.mjs` returns `mode: 'real_failed'` and does not save a paper fill when a real Kalshi order fails. |
| P0.6 monitoring | ALREADY_FIXED + CLEANUP | Scheduler heartbeat is persisted in SQLite, `/api/health` checks freshness under 10 minutes, and crash logging exists. This branch removes duplicate exception-handler registrations. |

## Safety invariants

- No change to futures v9 strategy.
- No change to ratchet, TP/SL, sizing, or execution logic.
- No activation of real trading.
- No change to `REAL_TRADING`, LIVE locks, or execution authority.
- No merge to `main`.

## Files changed on this branch

- `server/index.mjs`
- `.env.example`
- `server/agentRunner.mjs`
- this audit document

## Verification status

Static source audit completed. Runtime build/tests have not been executed by the GitHub connector environment yet; do not mark them as passing until CI or a local runner proves it.

## Changelog note

`docs/CHANGELOG_AI.md` is not readable through the GitHub connector because the file is not valid UTF-8. It was therefore not rewritten blindly. Repairing its encoding should be a separate explicit maintenance action to avoid corrupting history.
