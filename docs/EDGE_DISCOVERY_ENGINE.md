# Genesis Edge Discovery Engine v1

## Mission

Genesis is an evidence-driven edge discovery system. Its objective is not to force profitable results; no mathematical system can guarantee market edge. Its objective is to continuously propose, falsify, rank, quarantine, and promote hypotheses using reproducible net economics.

## Learning loop

1. Observe immutable market/trade evidence.
2. Form bounded hypotheses by strategy family, asset, side, regime, session, volatility and sizing.
3. Measure net expectancy after available fees, slippage and funding.
4. Require sufficient sample size before inference.
5. Penalize complexity, instability, drawdown and concentration.
6. Validate on data not used to select parameters.
7. Run fixed-candidate walk-forward.
8. Open a sealed final holdout only for finalists.
9. Admit survivors to PAPER shadow only.
10. Compare observed PAPER against the frozen research thesis.
11. Quarantine degradation; never silently retune a promoted version.
12. Repeat.

## Mathematical scorecard

For each candidate/segment Genesis records:

- N closed trades.
- Net expectancy per trade.
- Profit factor.
- Win rate.
- Average win and average loss.
- Payoff ratio.
- Maximum drawdown.
- Return/PnL concentration in top trades.
- Positive-regime breadth.
- Winner-lost rate and exit-reason distribution.
- Train, validation, walk-forward and sealed holdout results.
- Cost coverage and sensitivity to higher friction.

No single metric promotes a candidate.

## Anti-overfit rules

- Train selects; validation challenges; holdout never tunes.
- A failed holdout cannot be reopened and retuned under the same version ID.
- Parameter search space must be declared before holdout.
- Every promoted candidate receives a new immutable version.
- Multiple-testing pressure must be reported with candidate count and survivor rate.
- Small samples remain INSUFFICIENT_EVIDENCE, never EDGE.
- Regime/session segments with inadequate N cannot authorize trading.
- Research workers have executionAuthority=false.

## State machine

HYPOTHESIS -> RESEARCH -> VALIDATION -> WALK_FORWARD -> SEALED_HOLDOUT -> PAPER_SHADOW -> PAPER_EXPERIMENT -> VALIDATED

Failure can transition to REJECTED or QUARANTINED at any evidence gate.

VALIDATED does not mean LIVE. Capital eligibility remains a separate Founder-controlled process and LIVE_LOCKED remains invariant.

## Discovery priorities

The research factory should diversify hypotheses rather than repeatedly mutate one breakout strategy:

- trend/breakout;
- momentum continuation;
- mean reversion;
- volatility expansion/contraction;
- long/short asymmetric behavior;
- regime-conditioned variants;
- session-conditioned variants;
- cross-asset confirmation where causally defensible.

Complexity is a cost. A simpler robust candidate outranks a fragile complex candidate with similar economics.

## Objective

The optimization target is reproducible positive net expectancy with controlled drawdown and robustness, not trade count, win rate, gross PnL, or a visually attractive equity curve.

Genesis must be allowed to conclude NO EDGE and NO TRADE.
