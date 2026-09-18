# Research Module Template

This folder is a copyable starting point for a **new RESEARCH_ONLY hypothesis**.

It is intentionally small.

## What it demonstrates

- immutable/versioned protocol;
- deterministic protocol hash;
- causal decision-time features;
- separate forward outcome;
- explicit round-trip costs;
- `INSUFFICIENT_DATA`, `REJECTED` and `SURVIVES_INITIAL_SCREEN`;
- no execution/promotion authority;
- fail-closed malformed evidence tests.

## Use it

1. Copy this directory.
2. Rename `study.mjs` and the test.
3. Replace the example hypothesis.
4. Replace `signalFeature` with your real, causally available feature.
5. Define the real provider/schema admissibility rules.
6. Declare costs and minimum sample **before** looking at final results.
7. Add OOS / walk-forward / holdout logic appropriate to the study.

Run the template test:

```bash
node --test templates/research-module/study.test.mjs
```

## Important

The fixture in `study.test.mjs` is synthetic. It proves evaluator behavior, not market edge.

This template must not be wired directly to execution. See:

- `docs/NEW_RESEARCH_MODULE.md`
- `docs/EVIDENCE_SCHEMA.md`
- `docs/REPRODUCIBILITY.md`
- `AGENTS.md`
