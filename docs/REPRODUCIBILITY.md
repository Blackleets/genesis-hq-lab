# Reproducibility Guide

A Genesis research claim should be reproducible enough that another contributor can understand **what was measured, with which code, on which evidence, under which protocol**.

## Reproducibility packet

For any material research result, preserve as many of these as apply:

```text
code commit / PR
      +
protocol version/hash
      +
evidence tape / dataset reference
      +
schema + provenance
      +
cost assumptions
      +
sample definition
      +
evaluation command
      +
machine-readable report
```

## Minimum result metadata

A durable report should ideally expose:

- engine/study version;
- protocol version or hash;
- evidence schema version;
- provider(s);
- instrument(s);
- observation window;
- sample counts;
- rejected-row counts where relevant;
- cost assumptions;
- output metrics;
- decision/verdict;
- whether holdout data was used;
- whether the result is research, shadow or paper.

## Negative results are reproducible results

Do not delete or hide a study because it returns:

- negative expectancy;
- profit factor below 1;
- insufficient sample;
- failed walk-forward;
- failed holdout;
- `NO_GO`.

A rejection is useful if another contributor can reproduce **why** it was rejected.

## Separate selection from evaluation

A common failure pattern is:

1. tune on all data;
2. select the best result;
3. report the same data as validation.

Genesis should instead separate:

```text
discovery
   ↓
validation
   ↓
sealed holdout
```

or use a documented walk-forward design.

If a holdout influences parameter selection, it is no longer sealed.

## Cost reproducibility

Reports should make economic assumptions explicit.

Examples:

- maker/taker fee bps;
- gas units and gas price source;
- slippage reserve;
- failed-attempt probability/cost;
- maker fill probability;
- adverse-selection markout;
- inventory-risk penalty.

Unknown costs should remain unknown or make the candidate inadmissible.

## Timestamp reproducibility

For any observation used in causal/forward analysis, distinguish:

- external source timestamp;
- Genesis capture timestamp;
- later outcome timestamp.

A future source timestamp must never be accepted as contemporaneous data.

## Synthetic fixtures vs market evidence

Genesis uses synthetic fixtures for deterministic tests.

Synthetic fixtures are valuable for:

- parser behavior;
- gate behavior;
- edge cases;
- regression tests.

They must never be presented as proof of market edge.

Every fixture intended only for tests should be labeled accordingly.

## Suggested PR evidence section

A strong research PR can include:

```text
Protocol:
  maker_fill_calibration_v1

Data:
  OKX public RPI + fixed-window aggressive flow
  2026-09-XX to 2026-09-XX

Selection:
  none / predeclared buckets

Costs:
  explicitly listed

Sample:
  N raw, N admissible, N matured

Validation:
  discovery N
  validation N
  holdout SEALED

Result:
  INSUFFICIENT_DATA / REJECTED / SURVIVES_INITIAL_SCREEN

Reproduce:
  node ...
```

## Re-running existing research

The exact command depends on the lane. Prefer scripts already committed to the repository rather than ad-hoc notebooks that cannot be replayed.

Examples of existing styles include:

```bash
node server/research/causalMicrostructureStudy.mjs <evidence.jsonl> --out <report.json>
node server/research/rpiDepthImbalanceStudy.mjs <rpi-orderbook.jsonl> --out <report.json>
npm run mev:shadow:test
npm run quant:audit
```

Do not assume every command can run without its documented evidence/input files.

## Versioning discipline

When a locked research protocol changes materially:

- bump the study/protocol version;
- keep historical evidence associated with its original version;
- document why the change was made;
- do not retroactively claim the previous holdout remains virgin if it informed the change.

## Reproducibility checklist

- [ ] code revision identified;
- [ ] evidence source identified;
- [ ] schema/provenance identified;
- [ ] timestamps are causal;
- [ ] costs are explicit;
- [ ] sample definition is explicit;
- [ ] protocol is versioned;
- [ ] holdout status is explicit;
- [ ] result includes negative/insufficient outcomes;
- [ ] synthetic fixtures are not presented as market evidence.
