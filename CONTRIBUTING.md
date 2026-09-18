# Contributing to Genesis HQ

Thanks for considering a contribution.

Genesis is an evidence-first quantitative research system. The most valuable pull requests are not the ones that create more trading activity; they are the ones that improve our ability to determine whether an edge is real.

## Before you start

Read these files:

1. `AGENTS.md`
2. `docs/RESEARCH_PRINCIPLES.md`
3. `docs/ARCHITECTURE_PUBLIC.md`
4. `docs/VISION.md`
5. `docs/DESIGN_DIRECTION.md` before any UI change

The repository's safety rules are binding.

## Non-negotiable boundaries

A contribution must not:

- silently enable real-money execution;
- add a private key, seed phrase, API secret or committed `.env`;
- weaken `LIVE_LOCKED` / paper / shadow boundaries;
- present mock data as live data;
- treat missing evidence as zero cost or perfect information;
- assume price touch equals fill;
- remove risk gates simply to increase the number of candidates;
- optimize on a sealed holdout and then report that same holdout as independent evidence.

If evidence is missing, fail closed.

## Branching

Never work directly on the default branch.

Use one logical branch:

```text
feat/<short-name>
fix/<short-name>
experiment/<short-name>
docs/<short-name>
refactor/<short-name>
```

Use conventional commit messages.

## Development

```bash
npm install
cp .env.example .env
npm run start:ui
```

Full paper stack:

```bash
npm run start
```

Verification:

```bash
npm run test
npm run typecheck
npm run build
```

Focused MEV checks:

```bash
npm run mev:shadow:test
```

## Best first contributions

### 1. Data-quality checks

Improve freshness, timestamp, duplicate, provenance or cross-source consistency checks.

### 2. Research adapters

Add a public/read-only market-data source while preserving provenance and rate limits.

### 3. Economic models

Improve fees, slippage, queue, failure-cost, fill-probability, inventory-risk or adverse-selection accounting.

### 4. Reproducibility

Make an existing study easier to replay from durable evidence.

### 5. Fail-closed tests

Add regression tests where unknown or contradictory evidence must produce `NO_GO`.

## Adding a research hypothesis

A new strategy or signal should start as research, not execution.

Document:

- hypothesis;
- required data;
- source provenance;
- feature definitions;
- entry condition;
- forward horizon;
- cost model;
- minimum sample;
- rejection criteria;
- OOS / walk-forward plan;
- holdout policy;
- expected failure modes.

Where possible, lock the protocol before sufficient observations exist.

## Adding a market-data source

A new adapter should expose:

- provider;
- instrument;
- source timestamp;
- capture timestamp;
- source age;
- schema version;
- provenance;
- raw or minimally transformed fields needed to reproduce features.

Network failure, stale data or malformed responses must be explicit.

## Pull-request checklist

- [ ] Branch is not the default branch.
- [ ] Scope is one logical change.
- [ ] No secrets are present.
- [ ] Tests cover the new economic/safety behavior.
- [ ] Missing data fails closed.
- [ ] No live-capital authority was added.
- [ ] Documentation matches actual behavior.
- [ ] `npm run typecheck` passes.
- [ ] `npm run build` passes.
- [ ] Relevant tests pass.
- [ ] Change is documented according to `AGENTS.md`.

## What makes a strong PR

Strong:

> Add queue-depletion evidence and show that the previous fill model overestimated maker fills by X under a reproducible replay.

Weak:

> Increase confidence from 0.65 to 0.80 because results look better.

Genesis prefers falsifiable evidence over parameter intuition.

## Security issues

Do not publish secrets or active exploit details in a public issue. See [SECURITY.md](./SECURITY.md).
