# Adding a Research Module

This is the smallest recommended path for adding a new Genesis research hypothesis.

A working copyable implementation lives at `server/research/templates/researchStudyTemplate.mjs`, with invariants in `server/tests/researchStudyTemplate.test.mjs`.

The goal is to make research modules easy to add **without** making execution authority easy to add.

## 1. State the hypothesis

Write one falsifiable sentence.

Good:

> When X and Y are observed at decision time, Z predicts a positive 15-minute return net of 10 bps round-trip costs.

Weak:

> This indicator looks bullish.

Define:

- instrument/universe;
- side(s);
- feature thresholds;
- forward horizon;
- cost model;
- minimum sample;
- rejection criteria.

## 2. Version the protocol

Prefer an immutable protocol object:

```js
export const PROTOCOL = Object.freeze({
  studyVersion: 1,
  hypothesis: '...',
  horizonMs: 15 * 60 * 1000,
  minimumObservations: 30,
  roundTripCostBps: 10,
  rejectionRule: '...',
});
```

If thresholds change after results are visible, bump the protocol version.

Do not silently edit the old protocol.

## 3. Keep feature extraction causal

A feature function should consume only evidence available at the entry timestamp.

Prefer pure functions:

```js
export function deriveFeatures(snapshot) {
  // no network, no future rows, deterministic output
}
```

Do not fetch future data from inside the evaluator.

## 4. Separate entry from outcome

Use two stages:

```text
entry evidence -> classify hypothesis
later evidence -> mature forward outcome
```

The entry object should not contain its later result.

## 5. Make costs explicit

A study that claims trade economics should subtract a declared cost model.

Do not hide costs inside an unexplained score.

If a material cost is unknown, prefer `INSUFFICIENT_DATA` / `NO_GO`.

## 6. Define the evaluator

Recommended shape:

```js
export function evaluateStudy(rows, protocol = PROTOCOL) {
  return {
    studyVersion: protocol.studyVersion,
    mode: 'RESEARCH_ONLY',
    observationCount: 0,
    metrics: {},
    decision: 'INSUFFICIENT_DATA',
  };
}
```

The exact fields can vary, but reports should remain machine-readable.

## 7. Tests before promotion

Minimum useful tests:

- positive deterministic fixture;
- negative fixture;
- stale/missing evidence;
- future timestamp/lookahead attempt;
- insufficient sample;
- cost erases gross edge;
- protocol/version behavior.

Synthetic fixtures must be clearly identified as test data.

## 8. Durable report

Prefer writing a report with:

- study version/hash;
- provider/instrument;
- sample counts;
- cost assumptions;
- metrics;
- verdict;
- holdout status.

See [REPRODUCIBILITY.md](./REPRODUCIBILITY.md).

## 9. Promotion boundary

A new research module must not:

- import signing keys;
- place orders;
- amend/cancel orders;
- toggle `LIVE_LOCKED`;
- silently feed a production strategy.

Research first. Promotion is a separate decision.

## Suggested file layout

```text
server/
├── genesis/
│   └── <evidence-or-feature-module>.mjs
├── research/
│   └── <study-name>.mjs
└── tests/
    ├── <evidence-or-feature-module>.test.mjs
    └── <study-name>.test.mjs
```

Not every study needs every layer, but keeping network capture separate from pure evaluation makes replay much easier.

## PR checklist

- [ ] hypothesis is falsifiable;
- [ ] protocol is versioned;
- [ ] no future leakage;
- [ ] costs are explicit;
- [ ] minimum sample is defined;
- [ ] negative/insufficient verdicts exist;
- [ ] tests are deterministic;
- [ ] report is machine-readable;
- [ ] no execution authority added.
