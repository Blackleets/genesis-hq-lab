# Arbitrage Radar address normalization

- Branch: `fix/arbitrage-radar-addresses`
- Scope: normalize Ethereum token/router/quoter addresses used by the read-only Arbitrage Radar through viem `getAddress`.
- Trigger: a live-chain SHADOW smoke reached Ethereum block 25969784 but all six route quotes failed because the USDC mixed-case literal had an invalid checksum.
- Safety: SHADOW only; `executionAuthority=false`; no wallet, signing, broadcast, LIVE unlock, v9, ratchet, TP/SL, sizing, or risk-policy changes.
- Canonical changelog note: `docs/CHANGELOG_AI.md` could not be read through the connector because it contains invalid UTF-8 bytes, so this isolated record is used rather than overwriting it.
- Verification target: MEV focused tests, production build, then repeat live-chain one-shot on the deployment branch.
