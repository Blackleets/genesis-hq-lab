# Solana free-tier shadow benchmark

- Branch: `feat/solana-free-shadow-benchmark`
- Infrastructure policy: free-only, USD 0 monthly budget, no automatic upgrade.
- Priority fees: `getRecentPrioritizationFees` now accepts up to 128 deduplicated writable route accounts. A global estimate remains observable when accounts are unavailable, but `priority_fee_not_localized` blocks promotion.
- Benchmark: `npm run solana:rpc:benchmark:free` compares configured free read-only endpoints using `getSlot`, reporting success rate plus p50/p95 latency without emitting endpoint URLs.
- Safety: SHADOW/PAPER only; `executionAuthority=false`; `LIVE_LOCKED=true`; no signing, transaction submission, wallet, schema, UI, or Futures changes.
- Jupiter integration: when `GENESIS_SOLANA_OBSERVER_PUBLIC_KEY` is configured, the observer requests both legs from `/swap-instructions`, extracts every `isWritable` account, deduplicates them, and uses them for localized priority-fee evidence. This requires a public address only and never signs or submits.
- Remaining proof: `/swap-instructions` supplies route-account evidence but is not itself an atomic round-trip simulation. Atomic simulation and capture evidence remain mandatory blockers.
- Atomic SHADOW simulation: builds one unsigned v0 transaction containing both Jupiter legs, resolves lookup tables over the configured free RPC, calls `simulateTransaction` with signature verification disabled, and checks the simulated final USDC token-account amount against the quote minimum. It never signs, sends, confirms, or grants LIVE authority.
- CI reproducibility: the lockfile is generated with the npm 10 version used by Actions, and both Solana workflows install locked dependencies before importing the observer or simulator.
- Verification: 8 focused tests passed; typecheck passed; production build passed. Full suite: 1,558 passed and 1 pre-existing runner mismatch failed (`quantChallengerCore.test.mjs` imports Vitest but the aggregate script invokes Node test). The public RPC live probe timed out from this restricted workspace and was reported as unavailable without fallback claims.
