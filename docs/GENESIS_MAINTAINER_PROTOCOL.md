# Genesis Maintainer Protocol

Genesis uses an internal maintenance protocol to prevent incomplete fixes, fake demos, and changes without evidence. Use the `maintainer-orchestrator` skill when work touches bugs, production failures, PR readiness, deployments, trading, crypto, Kalshi, agent runners, persistence, or money-adjacent automation.

## Core Rule

Do not accept "listo" without evidence. A fix is not ready until the report shows diagnosis, root cause, modified files, tests, build result, real evidence, risks, rollback, and the next action.

## Classifications

- `AUTONOMOUS_FIX`: The agent can investigate, edit, test, and prepare the fix without asking first.
- `OWNER_DECISION_REQUIRED`: The owner must decide product behavior, risk, merge, deploy, real-money operation, destructive actions, or unclear tradeoffs.
- `BLOCKED_BY_SECRET_OR_API`: The work needs an API key, account, token, wallet, permission, provider access, or live target.
- `REJECTED_OR_DEFERRED`: The work should not be done now because it is unsafe, low ROI, out of scope, or lacks a valid evidence path.

## How To Ask For A Repo Audit

Use a prompt like:

```text
Usa .skills/maintainer-orchestrator. Audita Genesis HQ para bugs criticos, deuda operativa, falsos mocks, fallos de runner, trading, Supabase, Vercel y seguridad. Clasifica cada hallazgo como AUTONOMOUS_FIX, OWNER_DECISION_REQUIRED, BLOCKED_BY_SECRET_OR_API o REJECTED_OR_DEFERRED. No edites todavia; dame el diagnostico y prioridad.
```

Expected output:

- Findings ordered by risk.
- File or system references.
- Classification.
- Evidence available.
- What can be fixed autonomously.
- What needs owner permission.

## How To Ask For Bug Repair

Use a prompt like:

```text
Usa .skills/maintainer-orchestrator. Repara este bug en Genesis. Puedes editar archivos, pero no hagas push ni deploy hasta tener tests, build y Genesis Fix Report. No cambies trading real ni inventes datos.
```

The agent should:

- Reproduce or prove the bug.
- Identify root cause.
- Apply the smallest safe fix.
- Run focused verification.
- Run build/typecheck when relevant.
- Produce `Genesis Fix Report`.

## How To Demand Live Proof

Use a prompt like:

```text
Usa .skills/maintainer-orchestrator. No aceptes mocks. Necesito live proof: endpoint real, job real, Supabase state real, provider sandbox oficial o paper-trading real segun aplique. Si falta API key o permiso, clasificalo como BLOCKED_BY_SECRET_OR_API.
```

Valid live proof can include:

- A real deployed endpoint returning expected state.
- A GitHub Actions run URL and result.
- A Supabase row/state transition.
- A Vercel deployment URL and health response.
- A provider read-only response or official sandbox result.
- A paper-trading lifecycle event backed by database records.

Mocks, screenshots without backing data, static JSON, and local placeholder values are not enough for trading, PnL, order, or runner claims.

## How To Review Changes Before Merge

Use a prompt like:

```text
Usa .skills/maintainer-orchestrator. Revisa este branch antes de merge. Verifica diff, tests, build, live proof, riesgos, rollback, secretos y que no haya trading real activado. Dame una decision: mergeable, needs owner, blocked, rejected/deferred.
```

The review should confirm:

- The diff matches the requested scope.
- No unrelated files were changed.
- No secrets are staged or printed.
- Tests and build are appropriate.
- Live proof exists where required.
- Rollback is known.
- Money-affecting code has guardrails.

## How To Prepare A Safe Deploy

Use a prompt like:

```text
Usa .skills/maintainer-orchestrator. Prepara deploy seguro de Genesis. No despliegues hasta verificar build, env, fallback, live proof, rollback y decision clara. Si deploy esta autorizado, ejecutalo y devuelve evidencia real.
```

Deploy preparation must include:

- Current branch and commit.
- Build and typecheck status.
- Required environment variables by presence only, never values.
- Deployment target and expected URL.
- Health checks after deploy.
- Rollback path.
- Owner decision if deploy changes money, trading, auth, billing, wallets, or production data.

## Permission Boundaries

Keep these boundaries explicit:

- Analyze does not authorize edit.
- Edit does not authorize commit.
- Commit does not authorize push.
- Push does not authorize deploy.
- Deploy does not authorize operating with real money.

When the agent reaches an unauthorized boundary, it must stop and ask for the exact next permission.

## Required Report

Every repair must end with `docs/GENESIS_FIX_REPORT_TEMPLATE.md` filled in or reproduced in the final response.
