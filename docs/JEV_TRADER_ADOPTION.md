# Jev Trader adoption for Genesis HQ

This change extracts the useful engineering patterns from `jarrodwatts/jev-trader` without importing its Monad/Kuru-specific execution code or treating its demo strategy as evidence of alpha.

## Adopted

- Passive post-only quoting instead of always crossing the spread.
- Quote replacement discipline: PLACE / KEEP / REPLACE / CANCEL decisions are explicit.
- Inventory-aware risk caps so the engine can prefer the risk-reducing side.
- A deliberately small hot path with read and end-to-end timing.
- Economic accounting after maker fees, network lifecycle costs, adverse selection and inventory penalty.
- Fill probability is treated as empirical calibration evidence, not a guessed constant.
- Unknown costs fail closed.
- Observability uses the existing Solana event model.

## Deliberately not adopted

- Monad or Kuru SDK code.
- Any wallet, signing, broadcast or live-order capability.
- The model-driven BUY/SELL decision as money authority.
- Simulated profitability presented as real edge.
- Hard-coded profitability assumptions from the reference project.

## Genesis contract

`server/genesis/solanaMakerShadow.mjs` is SHADOW-only:

- `SOLANA_MAKER_EXECUTION_AUTHORITY = false`
- `SOLANA_MAKER_LIVE_LOCKED = true`

A candidate is blocked when the spread is stale/tight, the order would cross, inventory exceeds the cap, fill calibration is missing, maker fees are unknown, adverse-selection evidence is unknown, lifecycle network costs are unknown, or expected net edge is below policy.

The expected maker economics are:

```text
expected gross capture
- expected maker fees on fills
- expected adverse selection on fills
- expected inventory penalty on fills
- quote lifecycle network cost
= expected net maker PnL
```

Lifecycle cost is charged even when the quote does not fill, which is intentionally conservative.

## Data source requirement

The engine accepts a real order-book snapshot and real evidence through adapters. It does not fabricate a Solana CLOB feed. A venue adapter can be attached later for a supported Solana order-book venue after we verify its current API, fee schedule, tick rules and cancellation semantics.

## Promotion gate

SHADOW observations alone cannot unlock LIVE. Before PAPER promotion, Genesis needs enough real observations to calibrate at least:

- fill probability by side / spread / queue state,
- adverse-selection markout after fills,
- quote lifetime and cancel/replace frequency,
- network cost per quote lifecycle,
- maker fee/rebate schedule,
- inventory excursions,
- net expectancy out of sample.

Only OOS-positive net expectancy after all costs should justify a later PAPER gate. LIVE remains locked by design.
