# Genesis Product Foundation

Genesis should become a wallet-first SaaS without custody, fake PnL, or hidden live trading.

## Phase 0.5 Scope

- Wallet identity first: users authenticate by wallet signature later, not by seed phrase or private key.
- Owner/admin console: support and observability only, never custody.
- Paper sandbox per user: users can train agents with configurable virtual capital up to allowed plan limits.
- Billing hooks: events and entitlements are recorded, but fees stay disabled until explicitly enabled.
- Global learning: only opt-in, anonymized, closed-result patterns can become global candidates.

## Safety Rules

- No private keys, seed phrases, or delegated signing are stored.
- Reading a wallet does not authorize a transaction.
- Paper, sandbox, advisory, and live modes must stay visibly separated.
- Live trading remains disabled unless `ENABLE_LIVE_TRADING=true` and a future explicit user consent flow exists.
- Fees remain disabled unless `ENABLE_FEES=true` and a future explicit quote/acceptance flow exists.
- Admin can pause, inspect, support, and audit. Admin cannot move funds.

## Core Tables

- `users`: internal user profile.
- `user_wallets`: verified wallet addresses by chain.
- `wallet_sessions`: signed-login session records.
- `admin_users`: owner/operator access.
- `admin_audit_logs`: every admin action.
- `user_entitlements`: plans, limits, and future billing mode.
- `billing_events`: future monetizable events, currently disabled.
- `operation_intents`: audited action requests before execution.
- `wallet_snapshots`: cached public wallet balances.
- `memory_consent`: opt-in/opt-out for anonymous global learning.
- `user_memory`: private user learning.
- `global_memory_candidates`: anonymized candidates from profitable patterns.
- `global_memory`: approved global rules.
- `paper_accounts`, `paper_universe`, `paper_agent_runs`: per-user paper training sandbox.

## Rollout Order

1. Create wallet signature login endpoints.
2. Add owner bootstrap via env-configured wallet allowlist.
3. Add admin console read-only views.
4. Create per-user paper accounts and settings.
5. Move paper trades from global-only to user-scoped records.
6. Add opt-in global learning promotion pipeline.
7. Add Stripe or transaction-fee flow with fees still disabled by default.
