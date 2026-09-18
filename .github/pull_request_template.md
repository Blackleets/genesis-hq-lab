## What changed

Describe the smallest logical change in this PR.

## Why

What research, reliability, contributor or product problem does it solve?

## Evidence / verification

List commands, tests, replay evidence or screenshots that verify the change.

## Economic / safety impact

- [ ] No real-money execution authority added.
- [ ] Missing evidence still fails closed.
- [ ] No fake/live-looking data introduced.
- [ ] Costs/fills are not made more optimistic without evidence.
- [ ] No secrets are included.

If any box cannot be checked, explain why.

## Research changes only

If this changes a hypothesis, threshold, cost model or evaluation protocol:

- protocol/version changed:
- forward/OOS impact:
- holdout impact:
- reason this does not contaminate existing evidence:

## Verification checklist

- [ ] Relevant tests pass.
- [ ] `npm run typecheck` passes when applicable.
- [ ] `npm run build` passes when applicable.
- [ ] Documentation reflects actual behavior.
- [ ] `AGENTS.md` rules were followed.
