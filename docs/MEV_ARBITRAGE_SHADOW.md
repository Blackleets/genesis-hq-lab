# Genesis MEV Arbitrage Shadow v2

This lane researches benign DEX arbitrage only. It is designed as an evidence machine first and an execution system never by default.

## Allowed scope

- atomic DEX-to-DEX arbitrage
- pool-to-pool price dislocations
- backrun-style arbitrage that does not target a victim
- block-anchored quote comparison
- explicit gas, LP fee, slippage and flash-loan accounting
- SHADOW evidence and reproducible evaluation

## Explicitly excluded

- sandwich attacks
- victim-targeted transaction insertion
- mempool front-running
- transaction censorship
- private-key handling
- signing or submitting transactions

## Structural safety invariants

- `mode=SHADOW`
- `executionAuthority=false`
- no change to v9
- no change to ratchet, TP/SL or sizing
- no LIVE unlock
- no hidden fallback from unknown costs to zero

## v2 promotion gates

A spread is not a candidate just because the raw price difference is positive. Every candidate must pass all of these gates:

1. route identity is explicit
2. chain is explicit
3. evaluation is anchored to a block
4. all material costs are known
5. the route is explicitly atomic
6. simulation explicitly succeeded
7. prohibited MEV tactics are absent
8. quote age is within the configured freshness window
9. block lag is within tolerance
10. gross economics are positive
11. buffered net economics are positive
12. minimum net edge is met
13. minimum net PnL is met
14. economics remain positive under gas/slippage stress
15. inclusion probability is measured and above threshold
16. liquidity confidence is measured and above threshold
17. expected net PnL remains positive after failed-attempt cost

Unknown evidence fails closed to `NO_GO`.

## Cost model

The base model is deliberately more conservative than the raw quote:

- gas receives a safety multiplier
- slippage receives a safety multiplier
- LP fees are included explicitly
- flash-loan cost is included explicitly
- other known costs are included explicitly
- failed-attempt cost is included in expected PnL

A second stress model increases gas and slippage again. A route that looks profitable in the base model but loses under stress is rejected.

## Route identity + deduplication

Every route gets a deterministic fingerprint derived from:

- chain
- input token
- output token
- buy venue
- sell venue
- route id

Repeated observations of the same route are deduplicated for ranking so one noisy route cannot dominate the board by spamming snapshots.

## Evidence ledger

`server/genesis/mevShadowLedger.mjs` adds an append-only SQLite evidence ledger.

It records both candidates and rejections so the research process cannot hide failures. Stored fields include:

- route fingerprint
- chain/block
- tokens and DEX venues
- amount
- gross PnL
- total modeled costs
- buffered net PnL
- stress net PnL
- expected net PnL
- net edge bps
- robustness score
- verdict and blockers
- complete original evaluation payload

The ledger summary intentionally labels all opportunity economics as **theoretical**. It never presents them as realized account balance or realized profit.

## Orchestration

`server/genesis/mevShadowEngine.mjs` provides the isolated pipeline:

```text
quote snapshots
    ↓
fail-closed evaluator
    ↓
NO_GO / SHADOW_CANDIDATE
    ↓
append-only evidence ledger (explicit opt-in)
    ↓
deduplicated ranking
    ↓
research summary
```

Persistence is explicit (`persist=true`), never implicit.

## Command

```bash
npm run mev:shadow
```

At this stage the CLI exposes the evaluator policy and safety boundary. The system still does not connect wallets or submit transactions.

## Next evidence milestone

The next legitimate step is a public-data scanner/adapter layer that provides block-anchored DEX quotes, measured gas, liquidity depth and simulation results to this evaluator. Only after a large SHADOW dataset shows recurring positive **expected and stress-adjusted net edge** should execution even be discussed.
