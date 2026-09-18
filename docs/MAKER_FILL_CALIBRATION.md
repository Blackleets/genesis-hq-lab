# Maker Fill Calibration v1

Status: **RESEARCH_ONLY**  
Execution authority: **none**

## Purpose

`maker_fill_calibration_v1` estimates conservative maker fill probability from observed queue-depletion outcomes instead of assuming that a touched quote filled.

## Cohorts

Observations are separated by:

- maker side: BUY / SELL;
- queue-coverage bucket;
- observed spread bucket.

A cohort needs at least **30 valid observations** by default.

The sample fill rate is reported for diagnostics, but the value exposed for downstream research is the **95% Wilson lower confidence bound**. This deliberately discounts small or uncertain samples.

If the cohort is too small, the output is:

`INSUFFICIENT_DATA`

and `usableFillProbability = null`.

## Observation contract

Each row requires:

```json
{
  "side": "BUY",
  "queueCoverage": 1.4,
  "spreadBps": 3.2,
  "fillRatio": 0.5,
  "observedAt": "2026-09-18T12:00:00.000Z"
}
```

`fillRatio` must be in [0, 1]. A partial fill counts as a fill event while its execution fraction is retained separately in `meanFillRatio`.

Malformed evidence is rejected, not coerced to zero.

## Important limitation

This module does **not** infer whether an order would have filled from market touch alone. The input observations must already come from a defensible queue-depletion / replay methodology.

This module does not place, sign, amend or cancel orders and must not be used to weaken `LIVE_LOCKED`.
