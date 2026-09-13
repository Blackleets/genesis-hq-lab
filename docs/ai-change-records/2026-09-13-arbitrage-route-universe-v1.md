# Arbitrage Radar route universe v1

- Branch: `feat/arbitrage-route-universe-v1`
- Scope: expand the Ethereum USDC/WETH SHADOW quote universe from Uniswap V3 fee tiers 500/3000 plus Sushi V2 to all executor-supported Uniswap V3 tiers 100/500/3000/10000 plus Sushi V2.
- Evidence before change: live same-block reconnaissance at Ethereum block 25969829 tested 20 ordered routes. No route was gross-positive, but `uniswap_v3_500 -> uniswap_v3_100` was materially closer to breakeven (-3.90658 bps gross) than the previous six-route universe, showing the 100 tier carries useful market information.
- Resulting default ordered route count: 20.
- Safety: SHADOW only; `executionAuthority=false`; no wallet, signing, broadcast, LIVE unlock, v9, ratchet, TP/SL, sizing, or risk-policy changes.
- Canonical changelog note: `docs/CHANGELOG_AI.md` currently cannot be safely decoded by the connector due invalid UTF-8, so this isolated record is used instead of overwriting it.
