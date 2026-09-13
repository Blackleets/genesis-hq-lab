# 2026-09-13 — GPT-5.6 Sol

- Branch: `feat/arbitrage-rpc-resilience`
- Summary: Added a read-only resilient RPC selector for the continuous Arbitrage Radar. Configured Ethereum RPCs remain preferred; if unavailable, the worker can fall back to PublicNode then Ankr public mainnet endpoints, probes `eth_chainId` before use, rotates on later cycles, and never logs provider URLs because configured URLs may contain credentials. Execution remains SHADOW-only with `executionAuthority=false` and no wallet, signing, broadcast, or LIVE change.
- Files touched: `server/genesis/mevResilientWorker.mjs`, `server/tests/mevRpcResilience.test.mjs`, `package.json`, this record.
- Verification: pending GitHub CI (`MEV shadow checks` includes focused tests + production build).
- Governance note: `docs/CHANGELOG_AI.md` has previously been unreadable through the connected GitHub text path; this UTF-8 change record preserves the audit trail without overwriting or risking corruption of that file.
