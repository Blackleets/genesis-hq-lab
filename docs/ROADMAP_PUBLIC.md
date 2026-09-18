# Public Roadmap

This roadmap is about **research quality and contributor leverage**, not a promise to enable live trading on a date.

## Current phase — prove edge, improve measurement

### P0 — Reproducible economic truth

- [x] Paper/shadow-first architecture
- [x] Net-cost MEV candidate gating
- [x] Atomic simulation path
- [x] Liquidity / freshness / RPC resilience checks
- [x] Forward and OOS research infrastructure
- [x] Queue-aware maker shadow evaluator
- [x] RPI microprice and depth-band features
- [x] Causal maker queue-depletion capture tape (+1s / +3s / +10s)
- [ ] Empirical maker fill-probability calibration (accumulating ≥100 observations per cohort)
- [ ] Empirical adverse-selection calibration by regime
- [ ] Unified machine-readable economic scoreboard across research lanes
- [ ] Data-quality report for every promoted study

### P1 — Contributor-ready research SDK

- [x] Stable evidence schema documentation
- [x] Minimal interface for new read-only market adapters
- [x] Minimal interface for a new research hypothesis
- [x] Example replay dataset small enough for CI
- [x] Research-module template with versioned protocol hash + tests
- [x] Contributor documentation for adding a venue without adding execution authority
- [x] Public reproducibility guide

### P2 — Better cross-venue economics

- [ ] Improve same-block quote comparability
- [ ] Quantify provider / RPC latency degradation
- [ ] Segment arbitrage by notional and liquidity regime
- [ ] Measure opportunity half-life
- [ ] Model inclusion / failure probability from durable observations
- [ ] Publish rejection reasons as aggregate research metrics

### P3 — Public evidence surface

- [ ] Human-readable economic scoreboard
- [ ] Machine-readable research reports
- [ ] Strategy / regime cohort explorer
- [ ] Reproducible "why this was rejected" examples
- [ ] Public research changelog

## Promotion philosophy

Moving from research to capital should become **harder** as the amount of capital increases.

A future promotion decision should require evidence across:

- sample size;
- net expectancy;
- profit factor;
- drawdown;
- forward stability;
- cost sensitivity;
- regime stability;
- data integrity;
- operational reliability.

Passing a backtest is not a promotion event.

## Explicit non-goals for the current phase

- maximizing trade count;
- hiding negative experiments;
- enabling signatures just to "test in the real world";
- tuning on a sealed holdout;
- replacing measured costs with optimistic constants;
- claiming profitability from paper PnL alone.
