# Founder Real Control Room v1

This slice is a read-only operational boundary, not a live trading release.
There is no risk-free or 100% profitable strategy. Profitability requires net
realized evidence and a defined sample; readiness is not a profitability verdict.

## What is installed

- `GET /api/genesis/founder` on Node and Vercel. Every other method, including
  OPTIONS and HEAD, returns 405 with `Allow: GET`. JSON is never cached.
- Allowlisted public projection: owner verification status, limits, signed
  preflight gate results, seven connectors and seven agent roles. No raw owner
  address, account identifier, credential, signature, token or preflight JSON.
- Founder Live Control, Hermes Connector Registry and agents grouped into
  Infrastructure, Research, Control and Execution desks in the Command Center.
- SENTINEL evaluates readiness during the GET. The other new roles are registered
  but correctly report `not_running` or `locked`; there are no invented heartbeats,
  completed tasks or profits. AUDITOR's declared accounting source is Truth Ledger
  v2; attribution and live ledger ingestion into this new role are not installed.
- Paper funding P&L remains explicitly scoped to the historical funding snapshot.
  Missing metrics show a dash. Drawdown, win rate, exposure, open risk and active
  sessions are unavailable until the corresponding reconciled backend data exists.
- Old static online claims, fake operating-floor indicators, no-op ARM PAPER and
  ASTRA READY buttons are removed. No office is the primary screen.

## Modes and authority

| Mode | Meaning |
|---|---|
| read_only | Market/identity inspection; no capital movement |
| paper | Verified paper environment; cannot qualify for cutover |
| testnet | Verified test environment; cannot qualify for cutover |
| live_locked | Execution remains inaccessible |
| ready_for_external_cutover | All scoped preflight gates passed; external owner review still required |

`cutover.canExecute` is always false. `Review external cutover` only displays
review instructions; it never writes config, signs an order, or calls a POST.
Expired evidence, failed polling, missing data or changed account/config blocks it.
The readiness service is not connected to legacy trading gateways and must not be
mistaken for a kill switch controlling existing runners. Existing REAL_TRADING,
REAL_TRADING_CONFIRM, LIVE_MODE and LIVE_OFF behavior is unchanged.

## Secure configuration

Configure through the deployment secret manager only. Never paste credentials into
the app, source files, logs, PRs or this runbook. Readiness never tests credentials
by placing orders. Credential presence alone is not authenticated connector health.

| Server variable | Purpose |
|---|---|
| GENESIS_OWNER_ADDRESS | EVM public identity address verified by independent off-chain nonce proof |
| GENESIS_EXECUTION_VENUE | Exact `okx`, `binance` or `oanda`; others fail closed |
| GENESIS_ACCOUNT_ID | Specific external account scope; not sent to the browser |
| GENESIS_STRATEGY_ID / GENESIS_STRATEGY_VERSION | Exact strategy approved by the owner |
| GENESIS_REVISION | Exact deployed commit/revision examined by preflight |
| GENESIS_MAX_DAILY_LOSS_USD | Positive finite daily loss budget, explicitly approved |
| GENESIS_MAX_ORDER_NOTIONAL_USD | Positive finite order notional limit, explicitly approved |
| GENESIS_FOUNDER_PAUSED | Must explicitly be `false` plus independent pause-clear evidence |
| OKX_API_KEY / OKX_SECRET_KEY / OKX_PASSPHRASE | OKX server credentials |
| BINANCE_API_KEY / BINANCE_API_SECRET | Binance server credentials |
| OANDA_API_TOKEN / OANDA_ACCOUNT_ID | OANDA server credentials |
| GENESIS_PREFLIGHT_HMAC_KEY | Dedicated random secret of at least 32 characters; never an exchange key |
| GENESIS_PREFLIGHT_JSON / GENESIS_PREFLIGHT_SIGNATURE | Current independent preflight result and HMAC-SHA256 hex signature |

The owner must select limits; this slice supplies no recommended risk budget.
The signature binds evidence to credentials, owner, account, venue, strategy,
revision and numeric limits via `founderScope(env)`. Changing them invalidates it.
The signing key establishes operator trust, not automatic truth: an authorized
issuer can lie. Protect the issuer and preserve its supporting evidence.

## Independent preflight contract

No preflight issuer is implemented here. Do not manually set gates true to make a
screen green. A separately reviewed server-side verifier must perform and retain:

1. EIP-191 nonce/signature verification of the configured owner (not wallet-connect
   alone), with domain, expiry and replay controls. Wallet identity is not custody.
2. Authenticated read-only venue/account checks with withdrawal permission denied
   and least-privilege execution permissions independently examined.
3. Independent armed AND tested kill switch; founder pause state; loss/notional
   limit enforcement. Distinguish an armed emergency mechanism from a triggered
   halt. A triggered founder pause always blocks cutover.
4. Owner approval of the exact strategy version after leakage checks, realistic
   fees, spread, slippage, funding, liquidity/capacity and out-of-sample evaluation.
5. Live Truth Ledger availability AND account/order/fill/balance reconciliation;
   durable audit write/read check. A paper capture snapshot is insufficient.
6. Sandbox failure drills: partial fills, unknown response/idempotency, duplicate
   intents, clock drift, stale feed, precision/min-notional filters, risk breaches,
   crash/restart reconciliation and founder abort. No production orders here.
7. Exact deployed revision verification and evidence expiry checks.

Private signed JSON schema (never returned through the endpoint):

```text
version: 1
scope: founderScope(env)
issuedAt, expiresAt: ISO timestamps
 gates:
   ownerVerified, killSwitchArmed, killSwitchTested, founderPauseClear,
   strategyApproved, truthLedgerOnline, ledgerReconciled, auditLogOnline,
   brokerAuthenticated, executionSafetyVerified: strict booleans
 connectors:
   <registry id>: { status: "online", mode: "read_only" | "paper" | "testnet",
                    checkedAt: ISO timestamp }
```

Signature is HMAC-SHA256 of the exact serialized JSON using the dedicated secret.
Maximum accepted evidence age is 60 seconds, future timestamps are rejected and
expiry cannot be more than five minutes after issuance. Selected venue AND
execution gateway health must each be at most 60 seconds old. Health from another
venue or from paper/testnet cannot satisfy the live-account gate. With no issuer,
credentials or evidence installed, the correct production status remains BLOCKED.
For v1, secure env/config distribution is the input contract; a frequently refreshed
private evidence store is a follow-up before a practical production cutover.

## Connector and research scope

- OKX/Binance: futures scalping and funding/basis research are separate mandates.
  Signed health data is supported; no new private exchange adapter is installed.
  Existing public OKX capture and CCXT research paths are retained.
- Forex: OANDA is the registry's first supported credential schema, not a claim
  that an account is eligible or funded. Require a DST/holiday-aware London/New
  York calendar and broker-specific cost model. Alpaca/IBKR remain unimplemented.
- Kalshi/Polymarket: read-only research; no order permission in this registry.
- LP/farming: scanner mandate only. No fabricated APY. Require impermanent loss,
  entry/exit fees, lockup, contract risk, and stressed exit liquidity modeling.
- No memecoin/junk liquidity promotion. Market universes and strategy approval
  remain separately versioned; net edge must survive realistic costs.

## Browser credential hardening

Wallet authentication now uses a `Secure; HttpOnly; SameSite=Strict` host cookie.
`/api/auth/verify` and `/api/auth/session` return public identity metadata only.
`/api/auth/logout` clears the cookie. Cookie-authenticated writes require matching
Origin/Host and reject cross-site requests. Existing server Bearer clients remain
supported. Wallet metadata in React grants no server authority.

The legacy sessionStorage token is removed on mount; legacy connector credential
configuration is purged during persistence hydration. Old browser connector writes
and credential forms are retired. Reconfigure integrations server-side rather than
recovering secrets into the browser. Existing users must log in again. Deploy the
frontend and auth endpoints together over HTTPS on the same origin. Separate-origin
cookie auth is deliberately not enabled. This does not fix the pre-existing
in-memory nonce store's multi-instance durability: replace it with an atomic durable
nonce store and verify deployed login before claiming production identity readiness.

## External cutover (future, requires separate review)

READY_FOR_EXTERNAL_CUTOVER only authorizes review of evidence. The owner still must
approve a short-lived, single-use, server-enforced grant for exact account, strategy,
limits and revision. A future gateway must re-read every gate before each order and
fail closed on expiry, divergence or ambiguity. Provision minimal capital only after
independent sandbox/shadow proof. Preserve an external cancel/abort route. Never
implement this by toggling a frontend state or by trusting a browser snapshot.

## Verification and rollback

Run commands documented in `docs/FOUNDER_CONTROL_VERIFICATION.md` and CI. Tests use
synthetic, runtime-generated credentials exclusively; test READY is not production
readiness. No live orders or exchange credential validation are performed by tests.

Rollback by reverting this feature's commits on a new branch and deploying the
reviewed revert. Do not alter capital or live flags. Reverting auth hardening restores
the legacy browser-token model and therefore needs a security decision; invalidating
sessions is preferable to restoring unsafe browser credentials. No database migration
or financial history rewrite is part of this slice.
