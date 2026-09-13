# 2026-09-13 — GPT-5.6 Sol

- Branch: `feat/arbitrage-autoshadow-runtime`
- Summary: prepares the production backend to launch the existing SHADOW Arbitrage Radar continuously alongside server, agent, and optimizer by switching Render to `npm run start:render:arbitrage`.
- Provider config: declares `GENESIS_MEV_RPC_URL` as a Render-managed value and keeps the optional simulation executor address external to git.
- Safety: `executionAuthority=false`; no wallet, private key, signing, broadcast, or LIVE unlock added. Futures v9/risk controls are unchanged.
- Verification: pending CI and deployment-provider connection.
- Changelog note: `docs/CHANGELOG_AI.md` is currently too large/non-UTF-8-safe through the connector, so this isolated UTF-8 change record is used rather than risking corruption.
