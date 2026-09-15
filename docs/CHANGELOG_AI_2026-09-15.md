## 2026-09-15 — Codex

- Branch: feat/solana-supabase-shadow-v3
- Summary: Upgraded the canonical five-minute Solana observer with route-local priority fees, balance-free atomic plan validation, free-RPC latency evidence, and included it in the Supabase deployment workflow. SHADOW and LIVE_LOCKED remain enforced.
- Files touched: `supabase/functions/genesis-solana-observer/index.ts`, `.github/workflows/supabase-deploy.yml`, `docs/CHANGELOG_AI_2026-09-15.md`
- Verification: `npm run build` ok; focused Solana tests 11/11 passed; Edge Function bundle syntax check passed.
- Note: `docs/CHANGELOG_AI.md` is non-UTF-8 binary data in the canonical branch, so it was preserved unchanged to avoid corrupting existing user data.

## 2026-09-15 — Codex (deployment repair)

- Branch: fix/supabase-deploy-missing-function
- Summary: Made the Supabase deployment workflow skip a listed Edge Function when its source file is absent, allowing valid functions—including the Solana observer—to deploy instead of aborting early.
- Files touched: `.github/workflows/supabase-deploy.yml`, `docs/CHANGELOG_AI_2026-09-15.md`
- Verification: workflow shell guard reviewed; deployment verification pending GitHub Actions.

## 2026-09-15 — Codex (Cents Hunter PAPER v1)

- Branch: feat/solana-cents-hunter-v1
- Summary: Preserved the active cross-DEX radar in GitHub, expanded its paper notional grid, localized priority fees to selected-route writable accounts, added balance-free atomic plan evidence, and gated captured-cent Telegram alerts at +$0.01 after decay measurement.
- Files touched: `supabase/functions/genesis-solana-mev-radar/index.ts`, `supabase/functions/genesis-solana-mev-radar/deno.json`, `server/tests/solanaCentsHunterSource.test.mjs`, `docs/CHANGELOG_AI_2026-09-15.md`
- Verification: pending.
