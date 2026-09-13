# Arbitrage Radar — Shadow-Ready Boundary

Date: 2026-09-13

This change set closes the engineering loop for autonomous SHADOW observation without enabling real-money execution.

## What is ready

Arbitrage Radar can now be operated as a continuous evidence system with:

- same-block Ethereum DEX quotes
- exact leg-1 output chained into leg 2
- conservative gas/slippage economics
- same-block size-stress liquidity proof
- optional read-only atomic executor simulation
- deterministic atomic-simulation proof hashes
- append-only opportunity evidence
- pre-capture readiness classification
- opportunity-window persistence telemetry
- one-command read-only preflight
- an opt-in Render start command that runs the radar alongside the existing services

## What remains deliberately locked

The system does not claim that opportunity persistence equals transaction inclusion probability.

Until measured capture/competition evidence exists:

- inclusion probability remains unproven
- execution authority remains false
- no private key is required or accepted by this lane
- no transaction is signed or broadcast
- no wallet balance is placed at risk
- LIVE remains locked

## Operator commands

Read-only preflight:

```bash
npm run mev:preflight
```

One observation:

```bash
npm run mev:radar:once
```

Continuous local/deployment observation:

```bash
npm run mev:radar:watch
```

Opt-in Render process set with the radar included:

```bash
npm run start:render:arbitrage
```

The existing `start:render` command is intentionally unchanged, so this work cannot silently alter the current deployment process.

## Pre-capture readiness

A route is called pre-capture-ready only when it has already passed every material gate except capture/inclusion evidence. In particular it must have:

- positive buffered net economics
- positive stress economics
- successful exact atomic simulation
- measured same-block liquidity confidence
- SHADOW mode and executionAuthority=false

The only remaining blockers may be the capture/inclusion gate and the expected-value term that depends on that capture probability.

This state is not shown as a new product/version label in the dashboard. Internal evidence stays internal; the product surface remains **Arbitrage Radar**.

## Competition telemetry

`mevCaptureReadiness.mjs` tracks how long pre-capture-ready routes survive across observation cycles. This gives Genesis evidence about opportunity half-life and fragility without pretending that persistence is the probability of winning a builder auction.

The tracker reports active/closed windows and observation counts. It does not unlock execution and does not populate the evaluator's inclusion probability.

## Deployment configuration

At minimum, continuous real-block observation needs:

```text
GENESIS_MEV_RPC_URL=<read-only Ethereum RPC>
```

Exact atomic simulation additionally needs a compatible deployed simulation executor address:

```text
GENESIS_MEV_EXECUTOR_ADDRESS=<executor address>
```

No provider URL, key, wallet, signer, or secret is committed to the repository.

## Final safety statement

This branch is **shadow-ready, not live-ready**. That distinction is intentional. The next economic milestone is collecting enough real opportunity-window and eventual capture evidence to decide whether a tightly limited micro-live experiment is justified.
