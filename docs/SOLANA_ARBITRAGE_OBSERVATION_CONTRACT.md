# Solana Arbitrage Observation Contract

Status: research-only.

Safety invariants:
- chain: Solana
- mode: SHADOW or PAPER only
- executionAuthority: false
- LIVE remains locked
- no wallet, signing, broadcast, bundle submission, or capital authority
- no synthetic realized PnL

## Required observation fields

Each observation must preserve:
- observedAt
- inputMint / outputMint
- inputAmount
- first-leg and second-leg venue labels
- quote context slots
- quote age / latency
- quoted round-trip output
- gross edge when DEX fees can be normalized
- DEX / swap fees
- slippage reserve
- priority fee
- Jito tip
- failed-attempt or safety reserve
- net edge only when every critical cost is measured
- viable size and liquidity evidence
- atomic simulation state
- capture evidence state
- final status

## Fail-closed rule

If any critical cost cannot be measured, netEdge and netPnl must remain null and the observation must be BLOCKED. A quote is not an executable fill. A positive quote is not evidence of capture.

## Data source direction

Jupiter may be used for read-only route discovery and quote evidence. Venue labels returned by the route should be preserved so Raydium, Orca, Meteora, and other routed liquidity can be identified from actual observations instead of hard-coded claims.

Jito tip-floor data may be used as observed cost evidence. Priority fee must be independently measured or explicitly marked unknown.

## Render-free path

Reuse the existing bounded GitHub Actions -> public snapshot -> API fallback architecture from PR #101. Solana observations should publish to a distinct snapshot namespace so Ethereum history and Solana evidence cannot be mixed.

## Promotion gates

Do not classify a route as economically qualified until all costs are measured. Do not classify it as capturable until atomic simulation and realistic inclusion/capture evidence exist.
