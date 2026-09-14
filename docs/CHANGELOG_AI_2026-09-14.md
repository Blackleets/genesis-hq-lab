# AI changelog — 2026-09-14

- Branch: `feat/solana-arbitrage-telegram-premium` (target: `feat/genesis-life-os`)
- Summary: Preserved the Futures workspace and added an isolated Solana desk with normalized append-only lifecycle events, post-cost economics, fresh-quote simulation gates, PAPER expected-versus-captured measurement, bounded risk controls, a fail-closed LIVE adapter, and encrypted server-side Telegram configuration and delivery.
- Files touched: Solana observer/event/execution/learning modules, Telegram API/service and Settings drawer, Trading workspace/header/radar UI, observation workflow, store/environment configuration, regression tests, and this changelog.
- Verification: 16 focused Solana/Telegram/UI tests passed; engine suite 123 passed; touched-file ESLint passed; TypeScript passed; production build passed; `git diff --check` passed. LIVE remained locked and no wallet key or Telegram token is persisted client-side.
- Rollback: Revert the single feature commit; no schema migration or destructive data change is required.

Note: `docs/CHANGELOG_AI.md` is binary/non-UTF-8 in the canonical repository, so the dated entry is recorded separately to avoid rewriting or corrupting existing history.
