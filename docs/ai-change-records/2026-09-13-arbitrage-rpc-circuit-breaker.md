# 2026-09-13 — GPT-5.6 Sol

- Branch: `fix/arbitrage-rpc-circuit-breaker`
- Summary: Hardened the read-only Arbitrage Radar provider layer so a provider that passes `eth_chainId` but fails during a deeper DEX scan is quarantined for a deterministic number of cycles. Configured providers remain preferred; public fallbacks rotate when configured providers are absent/unavailable, reducing repeated load on one public endpoint.
- Safety: SHADOW only; `executionAuthority=false`; no wallet, private key, signing, broadcast, or LIVE change.
- Files touched: `server/genesis/mevResilientWorker.mjs`, `server/tests/mevRpcResilience.test.mjs`, `.env.example`, this record.
- Verification: pending GitHub CI. Tests now cover configured-provider precedence, public rotation, wrong-chain rejection, URL non-disclosure, circuit-breaker cooldown, and blocked-provider exclusion.
- Governance note: existing `docs/CHANGELOG_AI.md` has previously been unreadable through the connected GitHub text path, so this UTF-8 record preserves the audit trail without risking corruption.
