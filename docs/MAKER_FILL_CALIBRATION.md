# Maker Fill Calibration v3

Status: **RESEARCH_ONLY**  
Execution authority: **none**

## Purpose

Genesis calibrates maker fills from durable queue-depletion observations instead of assuming that a touched quote filled.

The pipeline is:

```text
RPI book at t0
   ↓
hypothetical BUY + SELL quotes
   ↓
exact post-entry aggressive trade interval
   ↓
aggressive flow cut exactly at t0 + 1s / 3s / 10s
   ↓
future RPI book markout (≤25% timing drift)
   ↓
queue-depletion fill label
   ↓
fill-conditioned adverse markout
   ↓
horizon + side + queue + spread cohorts
```

## Queue rule

For a hypothetical maker order:

```text
fillable = max(0, aggressive flow toward our quote - queue ahead)
filled units = min(order size, fillable)
fill ratio = filled units / order size
```

Genesis gives **zero credit to cancellations**. Price touch alone is never counted as a fill.

## Horizons

Calibration v3 keeps these cohorts separate:

- 1,000 ms
- 3,000 ms
- 10,000 ms

A 10-second fill rate can never silently become a 1-second fill rate. The aggressive-flow interval ends at the exact target timestamp even if the future order-book snapshot arrives slightly later. Markout snapshots beyond 25% timing drift are rejected.

## Cohorts

Observations are segmented by:

- target horizon;
- maker side: BUY / SELL;
- queue-coverage bucket;
- observed spread bucket.

The default minimum is **100 valid observations per cohort**.

The sample fill rate is diagnostic. The value eligible for downstream research is the **95% Wilson lower confidence bound**.

Until a cohort reaches its minimum:

`INSUFFICIENT_DATA`

and:

`usableFillProbability = null`

## Adverse selection

Adverse selection is measured only after a queue-depletion fill.

For BUY:

```text
max(0, quote price - future mid)
```

For SELL:

```text
max(0, future mid - quote price)
```

normalized to bps against entry mid.

Reports expose p50 / p75 / p90 adverse-selection bps for filled observations.

## Durable evidence

The capture tape is produced by:

`server/genesis/makerQueueDepletionCapture.mjs`

The calibration report is produced by:

`server/research/runMakerFillCalibration.mjs`

Each durable observation records exact entry/future source timestamps, exact target flow horizon, markout timing drift, interval trade-flow provenance, queue size, order size, flow toward the quote, fill ratio and safety boundaries.

Historical `maker_queue_depletion_tape_v1` rows remain preserved in the tape but are rejected from v3 calibration because v1 could count aggressive flow beyond the nominal target horizon.

## Safety

- no private keys;
- no signing;
- no order placement;
- no order cancellation;
- no execution authority;
- no LIVE promotion;
- insufficient/malformed evidence fails closed.

The report is explicitly `notForLiveScoring: true` while evidence is being accumulated and reviewed.
