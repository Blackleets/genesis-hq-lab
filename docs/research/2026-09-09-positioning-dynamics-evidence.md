# Positioning Dynamics Evidence — 2026-09-09

## Scope and safety boundary

- Branch: `feat/genesis-life-os`
- Mode: **RESEARCH_ONLY / PAPER**
- No LIVE enablement.
- No real orders.
- No changes to REAL_TRADING confirmations.
- No promotion/audit gates lowered or bypassed.
- No holdout data used for ranking.
- No candidate enrolled into Forward PAPER by this change.

## Problem

`derivativesContext.mjs` already collected Binance USDⓈ-M open-interest history and taker buy/sell ratio, but reduced them to a single full-window OI percentage change and a single long-window taker average. That aggregation can erase short-horizon information relevant to research, including OI expansion/acceleration and aggressive-flow reversals.

## Public-data availability check

Read-only public Binance USDⓈ-M endpoints were successfully queried for BTCUSDT during this research run:

- Open-interest history: `/futures/data/openInterestHist`, 5m observations.
- Taker buy/sell volume ratio: `/futures/data/takerlongshortRatio`, 1h observations.

The live taker sample contained both clear buy-pressure observations (ratio above ~1.16) and later strong sell-pressure observations (around ~0.78). A single 12-hour average can therefore mask a meaningful side flip.

This check establishes **data availability and information preservation value only**. It does not establish trading edge.

## Change

Commit `44e440e1e7cde9092808f74d3c24cdac02b7f884` adds pure, descriptive `derivePositioningDynamics()` features:

- `oiChangePct`
- `oiRecentChangePct` (recent 5m OI window)
- `oiAccelerationPct` (recent OI change minus prior equal-window change)
- `takerBias`
- `takerRecentBias`
- `takerImpulse` (recent mean minus prior equal-window mean)
- `takerPressure`
- `takerReversal`

These values are exposed as research context only; they do not place trades or bypass any promotion boundary.

Commit `bc4c7c269032ebf6b6014f3f830ba5b1f4e44c64` adds deterministic tests for a synthetic OI acceleration + taker reversal case and for missing-data honesty.

## Validation status

- Deterministic tests were added to `server/tests/derivativesContext.test.mjs`.
- GitHub reported no Actions workflow run for HEAD during this run, so **CI pass is not claimed**.
- The visible Vercel checks failed because deployment upload was rate-limited (`api-upload-free`), not because a code/test failure was reported.
- The public market-data endpoints themselves returned usable observations during the availability check.

## Research protocol from here

The next evidence-producing step is to persist synchronized **price + funding + OI + taker-flow** observations into the durable capture tape, then evaluate predeclared interactions such as:

`funding extreme × OI expansion/acceleration × taker reversal`

Evaluation order must remain:

1. train
2. validation
3. walk-forward / out-of-sample segments
4. untouched holdout only for final audit

Holdout must never rank variants. Any candidate must pass the existing fixed audit gates before **Forward PAPER** enrollment.

## Current conclusion

**Material infrastructure improvement, not a profitable-strategy claim.** Genesis now preserves derivatives dynamics that were previously averaged away. No independent candidate has yet earned promotion.
