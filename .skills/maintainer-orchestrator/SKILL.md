name: maintainer-orchestrator
description: Genesis internal maintenance orchestrator for critical fixes, production issues, PR readiness, live proof, and release-safe decisions.

# Genesis Maintainer Orchestrator

The Genesis Maintainer Orchestrator is the control protocol for keeping Genesis HQ maintainable, honest, and production-safe. It is inspired by maintainer-style orchestration, but adapted to Genesis: trading, crypto, Kalshi, Supabase, Vercel, agent runners, and money-adjacent automation require evidence before any change is called ready.

## Mission

Coordinate repository maintenance through diagnosis, repair, verification, evidence, and a clear decision boundary. No critical change may remain a demo, mock, partial fix, hidden fallback, or simulated success.

Use this skill when reviewing:

- Bugs and regressions.
- Issues and PRs.
- Production errors and failed deploys.
- Agent runner failures.
- Trading, scalping, Kalshi, crypto, wallet, PnL, order, or capital modules.
- Data integrity, fallback, persistence, and live proof gaps.
- CI, build, test, Vercel, Supabase, GitHub Actions, and deployment failures.

## Task Classification

Classify every task before acting:

- `AUTONOMOUS_FIX`: The issue is bounded, reproducible or diagnosable, safe to edit, and can be verified without owner input.
- `OWNER_DECISION_REQUIRED`: A product, strategy, risk, money, security, destructive, irreversible, merge, deploy, or real-operation decision is required.
- `BLOCKED_BY_SECRET_OR_API`: A required API key, wallet, account, token, service permission, provider access, or live target is missing.
- `REJECTED_OR_DEFERRED`: The requested work should not be done now because it is unsafe, out of scope, low ROI, conflicts with current rules, or lacks a valid path to evidence.

Do not hide blockers inside vague status. State the exact missing decision, permission, credential, or live proof.

## Evidence Rule

Never declare `ready`, `fixed`, `complete`, `live`, `operational`, or `safe` without evidence.

Required evidence depends on the changed surface:

- Code path: reproduction or root-cause proof, focused tests, build/typecheck where relevant.
- UI path: local or deployed visual proof when relevant.
- API path: real request/response proof with secrets redacted.
- Database path: real query or migration proof with schema/data safety noted.
- Runner path: real heartbeat, job result, log, or durable state transition.
- Trading/Kalshi/crypto path: live proof against real market data or official sandbox/paper system when applicable. Mocks alone are not enough.

If live proof is impossible, finish all safe local work first, then classify the task as `BLOCKED_BY_SECRET_OR_API` or `OWNER_DECISION_REQUIRED` and name the exact missing item.

## No Fake Trading Rule

For trading, scalping, Kalshi, crypto, PnL, order, wallet, and capital flows:

- Do not present mocks, fixtures, static JSON, local-only UI state, or simulated values as live results.
- Use real backend data, official sandbox data, paper-trading records, provider responses, or clearly labeled unavailable states.
- Do not create fake trades, fake PnL, fake fills, fake balances, fake decisions, or fake learning.
- Do not activate real-money trading without explicit owner confirmation in the current session.
- When money could be affected, add guardrails, limits, logs, and rollback before increasing autonomy.

## Permission Boundaries

Treat each permission as separate:

- Analyze does not authorize editing.
- Edit does not authorize commit.
- Commit does not authorize push.
- Push does not authorize deploy.
- Deploy does not authorize real-money operation.
- Paper trading does not authorize live trading.
- Read-only provider access does not authorize account mutation.

When permission is missing, stop at the last authorized boundary and report the exact next permission required.

## Required Fix Workflow

For every repair:

1. Identify the issue and classify it.
2. Reproduce the bug or establish root cause from concrete evidence.
3. Identify files and ownership boundaries.
4. Apply the smallest safe fix that preserves existing behavior.
5. Add or update tests when risk justifies it.
6. Run focused checks and broader checks appropriate to the change.
7. Collect live proof when the change crosses runtime, provider, runner, trading, database, or deploy boundaries.
8. Document risks and rollback.
9. Produce a Genesis Fix Report.
10. Ask for owner decision only when the remaining step truly requires the owner.

## Required Fix Report Fields

Every fix report must include:

- Classification.
- Diagnostico.
- Archivos modificados.
- Causa raiz.
- Solucion aplicada.
- Tests ejecutados.
- Resultado de build.
- Evidencia real or live proof.
- Riesgos.
- Rollback.
- Siguiente accion.

Use `docs/GENESIS_FIX_REPORT_TEMPLATE.md` as the default report format.

## Live Proof Gate

Live proof is mandatory before merge or deploy when the change affects:

- Trading decisions or execution.
- PnL, fills, capital, balances, or risk state.
- External APIs or provider integrations.
- Supabase, Vercel, GitHub Actions, Render, or scheduler behavior.
- Agent runner heartbeat, learning, autonomous decisions, or persistence.

Accepted live proof examples:

- A real deployed endpoint response.
- A real GitHub Actions run URL and result.
- A Supabase row/state transition confirmed by query or API.
- A real paper-trading trade lifecycle event.
- A provider response from official sandbox or read-only public market data.
- A screenshot only when it proves a UI/runtime state and the backing data source is real.

Mocks and unit tests support the proof, but do not replace it for live boundaries.

## Money-Affecting Modules

If a module can affect money, balances, orders, trades, PnL, wallets, fees, or user monetization:

- Default to paper/sandbox/read-only.
- Add maximum position size, maximum loss, daily caps, cooldowns, and kill-switch checks where applicable.
- Log every automated decision with reason, source data, and timestamp.
- Preserve rollback or disable path.
- Require explicit owner confirmation before enabling real-money operation.

## Owner Decision Brief

When owner input is required, the brief must include:

- Classification.
- What changed or would change.
- Why the owner decision is required now.
- Evidence already collected.
- Missing proof, permission, or credential.
- Options and consequences.
- Orchestrator recommendation.

Do not ask the owner to decide from vague status or an unverified claim.

## Merge and Deploy Gate

Before recommending merge or deploy, confirm:

- Working tree contains only intended changes.
- No secrets are staged or printed.
- Tests/build appropriate to the change have run.
- Live proof exists or an explicit item-specific waiver is recorded.
- Rollback path is known.
- Trading real-money mode remains disabled unless explicitly approved.
- The final report is complete.

If any gate fails, do not call the change ready.
