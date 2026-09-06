# Genesis Quant Research Ledger v1

Genesis records quant research as durable evidence, including negative results. A rejected hypothesis is institutional memory, not disposable output.

## Safety boundary

- Research only.
- `capital_eligible` is database-constrained to `false`.
- `live_orders` is database-constrained to `false`.
- UPDATE and DELETE are blocked by an append-only trigger.
- Founder LIVE LOCKED / cutover gates remain authoritative and separate.

## Evidence contract

Each experiment can retain family, strategy/version, stage, verdict, Git branch and commit, engine SHA-256, workflow/artifact provenance, data source/window, parameters, gates, development/validation/holdout/forward evidence, holdout state, evidence policy and notes.

The hosted runner status exposes the ledger read-only to the workstation. The Strategy terminal renders both current futures validation and historical research failures so ATLAS/FORGE can avoid silently recycling falsified hypotheses.

## Current bootstrap

Production was bootstrapped with nine real research experiments from the 2026-09-06 evidence campaign. None is capital eligible or live-enabled. The CTA multi-horizon trend family produced a validation near-miss but failed an unchanged 2022-2026 forward confirmation, so it remains NO_GO and its legacy historical holdout stays sealed.

This ledger is evidence memory, not proof of profitable edge and not execution authorization.
