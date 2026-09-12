# Genesis repository review for Founder Control v1

Base: `feat/genesis-life-os` at `c13138e`. Review covers the repository module map,
active app routes, Node/Vercel entry points, authentication, trading control surfaces,
Truth Ledger, capture API, connector clients and relevant tests. This is not a claim
that every strategy or every file has received a quantitative/security certification.

| Surface | Finding from code | Decision |
|---|---|---|
| Command Center | Static AUDITOR online, OKX online, synthetic agent indicators and no-op buttons; default 10,000 equity/zero metrics with no feed | Replace with backend registry/readiness and unknown values |
| Truth Ledger v2 | Pure paper economics/reconciliation with closed[] as source; six baseline regressions pass | Preserve accounting implementation and label historical paper evidence |
| Capture API / workers | Public OKX input, paper replay and separate scheduled capture-tape branch | Retain for measurable research; not proof of live reconciliation |
| Node backend / Vercel API | Separate entry points, global Node OPTIONS behavior, API_BASE may target another origin | Install shared GET-only founder logic in both; no cross-host fallback for readiness |
| Wallet auth | API verify returned JWT in JSON; React stored it in sessionStorage | Secure HttpOnly host cookie; metadata-only JSON; same-origin write guard and tests |
| Legacy integrations | Browser credential form and external GitHub/Slack/webhook dispatch; previously unlinked from primary routes | Retire credential forms/dispatch; clear legacy connector config from persisted state |
| Main app route map | Marketing/HR/office-only modules already disconnected by base branch | Preserve disconnection; retain useful markets/research/ledger/health routes |
| Store tick / legacy modules | Remaining legacy app state includes simulated office/task/capital fields | New control room does not consume them; no claim of full repository theater removal |
| Quant bot factory / market views | Backend paths exist; paper lifecycle is distinct from real exchange execution | Retain; migrate cookie client requests without changing paper trading logic |
| Execution/risk engines | Existing REAL_TRADING/legacy execution surfaces outside new readiness boundary | Do not toggle or integrate readiness as a global execution override; independent gateway audit still required |
| Forex / LP agent mandates | No evidence of approved live adapters or risk-complete LP strategy in this slice | Explicit pending/scanner states; no APY/profit claims |
| Deployment workflows | Harvest and hosted runners use schedule/manual triggers; no founder-specific PR verification existed | Add tests/build workflow targeting the requested base; do not invoke trading workflows |

## Operational gaps that remain

1. No private venue login/account was verified. The connected Binance plugin supplied
   one public funding observation, not application credentials or execution access.
2. Seven named roles are defined, with deterministic SENTINEL evaluation. The other
   role-to-runner bindings, task queues and signed heartbeats are not installed here.
3. Independent signed preflight issuer and short-lived external owner cutover grant
   are not installed. Production correctly remains BLOCKED without them.
4. Existing wallet nonce storage is process-local. Production multi-instance nonce
   durability and end-to-end deployed login remain prerequisites to identity proof.
5. Global drawdown/exposure/win-rate/account sessions need dedicated reconciled feeds.
   Unknown is shown instead of zero or synthetic performance.
6. Existing Node write-auth behavior can be disabled when API_SECRET is absent.
   This slice introduces no trading writes; a production gateway must enforce auth
   independently and audit every legacy order entry point before real capital.
7. Profitability, sandbox order lifecycle, real risk-limit enforcement and deployed
   private connectivity have not been established by a registry or local unit tests.

No files are deleted. Retired implementation bodies are replaced because they
accepted credentials or implied runtime activity without an appropriate backend.

## Browser-discovered reliability fix

`useTruthLayer` accepted HTTP 503 error JSON as SystemTruth. The global header then
read `execution.startupReconciliation` from an absent object and replaced the entire
app with ErrorBoundary. The hook now rejects unsuccessful or malformed responses and
clears stale health. The browser regression intentionally returns 503 from legacy
health endpoints and verifies that Founder Control remains usable. The static
"office online" header was renamed to a neutral control-console label. On mobile,
the permanent sidebar is replaced by an accessible module selector.
