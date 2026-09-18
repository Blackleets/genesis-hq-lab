# Maker Fill Calibration v4

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

Calibration v4 keeps these cohorts separate:

- 1,000 ms
- 3,000 ms
- 10,000 ms

A 10-second fill rate can never silently become a 1-second fill rate. The aggressive-flow interval ends at the exact target timestamp even if the future order-book snapshot arrives slightly later. Markout snapshots beyond 25% timing drift are rejected.

The burst uses a **books-first scheduler**: it captures every future RPI snapshot before doing slower historical-trade pagination. This prevents the +1s flow query from delaying the +3s or +10s book snapshot.

Deadlines are aligned to the **exchange/source timestamp**, not to the later HTTP-response time. If the entry book is already 300ms old when Genesis receives it, the +1s capture begins roughly 700ms later and then polls until the source timestamp is at or beyond exactly t0+1s. The same 25% markout-drift gate remains enforced.

## Cohorts

Observations are segmented by:

- target horizon;
- maker side: BUY / SELL;
- queue-coverage bucket;
- observed spread bucket.

The sequential protocol is locked **before** enough observations exist:

```text
first 100  → CALIBRATION
next 50    → VALIDATION
next 50    → SEALED HOLDOUT
```

The first 100 observations may expose calibration/training diagnostics, but they **do not** produce a usable fill probability.

While the next 50 validation observations are accumulating, their metrics remain sealed. Only when all 50 exist are validation metrics revealed. At that point the research-only usable fill probability is:

```text
min(
  Wilson 95% lower bound on calibration,
  Wilson 95% lower bound on validation
)
```

The next 50 observations are the holdout. Routine reports expose only the holdout count and readiness status; they never expose holdout outcomes or metrics. A separate explicit one-time audit is required to unseal it.

Observations after the first 200 in a cohort cannot change the locked calibration/validation/holdout allocation.

Until validation is complete:

`usableFillProbability = null`

and the cohort is not eligible even for downstream SHADOW calibration.

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

Calibration reports expose p50 / p75 / p90 adverse-selection bps for filled observations in the calibration segment and, once complete, the validation segment. Holdout adverse-selection metrics remain sealed in routine reports.

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

The report also includes a SHA-256 hash of the effective sequential protocol so any future change to sample splits, buckets, Wilson confidence level or timing gate produces a different research protocol identity.
