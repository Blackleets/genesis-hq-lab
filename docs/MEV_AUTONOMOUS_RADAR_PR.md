# Pull request scope — Autonomous Arbitrage Radar

This document exists only to make the stacked review boundary explicit.

Base: `experiment/mev-arbitrage-shadow-v2`
Head: `experiment/mev-autonomous-radar`

The change is intentionally isolated from `main` and from futures v9 execution. It adds a real-block, read-only Ethereum arbitrage observation lane plus a clean dashboard surface. It does not add signing, transaction submission, wallet custody, LIVE activation, or any change to v9/ratchet/TP/SL/sizing/execution.
