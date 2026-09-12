# Arbitrage atomic simulation review scope

Review target: `experiment/arbitrage-atomic-simulation` stacked on `experiment/arbitrage-radar-clean`.

Scope is intentionally narrow: prove whether a quoted route can survive a read-only executor simulation on the same block, without granting execution authority.

Out of scope: wallet integration, signing, transaction broadcasting, private relay submission, live capital, v9 changes, ratchet changes, TP/SL changes, sizing changes, and scheduler changes.
