# 2026-09-13 — GPT-5.6 Sol

- Branch: `feat/arbitrage-radar-shadow`
- Summary: Surfaced `Arbitrage Radar` directly on the Trading workspace, reused the existing `/api/genesis/context` Vercel function for the read-only radar view, and removed the standalone `api/mev/radar.js` function because it pushed the Hobby deployment over the 12-function limit. The visible product remains `Arbitrage Radar`; no `MEV vX` or internal `NO_GO` label was added.
- Files touched: `api/genesis/context.js`, `src/components/trading/ArbitrageRadarPanel.tsx`, `src/components/trading/TradingWorkspace.tsx`, removed `api/mev/radar.js`.
- Safety: `mode=SHADOW`, `executionAuthority=false`, no wallet, signer, broadcast, or LIVE unlock; futures v9/ratchet/TP/SL/sizing unchanged.
- Verification: pending GitHub Actions and Vercel preview after the serverless-function-count fix.
- Changelog note: `docs/CHANGELOG_AI.md` cannot be safely round-tripped through the active connector because its bytes do not decode as UTF-8; this isolated UTF-8 record preserves the required audit trail without corrupting the canonical file.
