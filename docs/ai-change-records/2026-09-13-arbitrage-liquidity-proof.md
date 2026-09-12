# 2026-09-13 — GPT-5.6 Sol

- Branch: `experiment/arbitrage-liquidity-proof`
- Summary: Added same-block route size-stress measurement so liquidity confidence is evidence-derived rather than guessed. The base route and a larger probe use the same adapters and block; probe failure leaves the liquidity gate closed without discarding the base observation. No wallet, signer, transaction submission, LIVE unlock, futures v9, ratchet, TP/SL, sizing or execution-scheduler changes.
- Files touched: `server/genesis/mevLiquidityProof.mjs`, `server/genesis/mevOnchainRadar.mjs`, `server/genesis/mevShadowWorker.mjs`, `server/tests/mevLiquidityProof.test.mjs`, `package.json`, `.github/workflows/mev-shadow-v2.yml`, `.env.example`, `docs/ARBITRAGE_LIQUIDITY_PROOF.md`, `docs/MEV_ARBITRAGE_SHADOW.md`.
- Verification: GitHub Actions `MEV shadow checks` passed module syntax, focused MEV shadow tests, and production build on commit `21f18947bf9f6464eb591bb6c5222b178b17f404`.
- Changelog note: `docs/CHANGELOG_AI.md` remains unsafe to round-trip through the active GitHub connector because it is not returned as usable UTF-8. This isolated UTF-8 record preserves the audit trail without overwriting the canonical file.
