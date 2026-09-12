# Genesis MEV Arbitrage Shadow

This lane researches benign DEX arbitrage only.

Allowed:
- atomic DEX-to-DEX arbitrage
- backrun-style arbitrage that does not target a victim
- quote comparison after gas, LP fees, slippage and flash-loan cost
- SHADOW/PAPER evidence

Explicitly excluded:
- sandwich attacks
- victim-targeted transaction insertion
- mempool front-running
- transaction censorship
- private-key or live transaction submission

Safety invariants:
- mode=SHADOW
- executionAuthority=false
- no change to v9
- no change to ratchet, TP/SL or sizing
- no LIVE unlock

Command:

```bash
npm run mev:shadow
```

The initial module is an evaluator, not a live searcher. A future scanner may ingest public DEX quotes and gas estimates, but promotion remains blocked until net edge is positive after all known costs.
