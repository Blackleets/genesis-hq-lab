# Arbitrage Radar — SHADOW integration

This document defines the canonical integration boundary for the Arbitrage Radar research stack.

## Included

- benign DEX-to-DEX arbitrage only
- Ethereum same-block quote observation
- exact leg chaining on USDC -> WETH -> USDC routes
- modeled and measured gas/cost evidence
- same-block liquidity size-stress evidence
- optional read-only atomic executor simulation
- append-only SHADOW evidence ledger
- pre-capture readiness classification
- opportunity persistence and competition observability
- clean product surface: `OBSERVING`, `QUALIFIED`, `FILTERED`, `SHADOW`

## Structural safety

- `mode=SHADOW`
- `executionAuthority=false`
- no wallet or private key
- no transaction signing or broadcast
- no sandwiching, victim targeting, or mempool front-running
- no LIVE unlock
- no changes to futures v9, ratchet, TP/SL, sizing, or the existing execution scheduler

## Promotion rule

This integration is research-ready, not live-ready. No real-money execution may be discussed as ready until continuous real-block evidence demonstrates recurring positive economics after costs and there is separately measured capture/inclusion evidence. Opportunity persistence and edge decay are descriptive competition telemetry only and must never be converted into a synthetic inclusion probability.

## Runtime boundary

Continuous SHADOW observation requires a read-only Ethereum RPC configured outside the repository. Exact atomic proof additionally requires a compatible simulation executor address. Secrets must never be committed.

## Verification gate

The canonical integration pull request must pass:

- focused MEV shadow tests
- module syntax checks
- production build
- quant-edge audit

A green build proves software integrity, not economic profitability.
