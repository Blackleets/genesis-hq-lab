# Research Principles

Genesis is built around a simple rule:

> A trading idea is a hypothesis until forward, net-of-cost evidence says otherwise.

## 1. Net edge, not gross edge

Always distinguish:

```text
gross opportunity
- fees
- slippage
- gas / priority fees
- failed-attempt cost
- adverse selection
- inventory / capital cost
= expected net edge
```

If a material cost is unknown, the result is not "free". It is **unknown**.

## 2. Price touch is not a fill

For maker research, a market trading at or through a hypothetical quote does not prove our order would have filled.

Queue position, queue depletion, order size and empirical fill behavior matter.

## 3. Forward evidence outranks backtests

Backtests are useful for rejecting bad ideas and forming hypotheses.

Promotion evidence should increasingly rely on:

- forward paper observations;
- out-of-sample periods;
- walk-forward validation;
- sequential validation;
- sealed holdouts.

## 4. No future leakage

Features must exist at the timestamp where the decision is made.

Lookahead contamination invalidates the evidence regardless of PnL.

## 5. Protocols should be hard to rewrite after seeing results

Where practical:

- predeclare thresholds;
- version the research protocol;
- hash/lock it;
- bump the version rather than editing history.

## 6. A rejected strategy is a valid result

Genesis should preserve negative findings.

"Funding arbitrage loses after fees" can be more valuable than another optimistic backtest.

## 7. Separate research from production

Research modules may explore aggressively.

Production/paper engines need stricter invariants.

A promising experiment must not silently become execution authority.

## 8. Calibrate confidence

Confidence should correspond to observed reliability, not the model's enthusiasm.

A confidence score without calibration evidence is a feature, not proof.

## 9. Segment before averaging away the truth

Evaluate performance by relevant dimensions such as:

- strategy;
- regime;
- venue;
- asset;
- spread/cost bucket;
- latency bucket;
- size;
- fill-probability bucket.

A positive global average can hide a destructive subgroup.

## 10. Protect the holdout

If a holdout changes how you tune the system, it is no longer a holdout.

Create a new sealed period after material tuning.

## 11. Evidence must be reproducible

A result should point back to:

- source data;
- schema/provenance;
- code version;
- protocol version;
- costs;
- sample definition;
- evaluation method.

## 12. "Insufficient data" is a first-class verdict

Do not force binary conclusions from weak samples.

Allowed outcomes include:

- `INSUFFICIENT_DATA`
- `NO_GO`
- `REJECTED`
- `SURVIVES_INITIAL_SCREEN`
- `HOLDOUT_READY`

## 13. Live capital is not the research shortcut

Real money does not make a bad experiment more informative.

Paper/shadow research should first prove that the measurement process itself is credible.
