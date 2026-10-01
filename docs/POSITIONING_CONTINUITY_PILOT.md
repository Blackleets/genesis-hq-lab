# Positioning continuity pilot v1

Registered: 2026-09-30 UTC. Environment: RESEARCH_ONLY; no orders or capital authority.

## Observed blocker
Source revision: 95b50c20437b239087ba4f485fef2d9fd2c972e1.
Tape snapshot: 51e0378ae035ec679a35cb7322ff5c78091ea26c.
The BTC tape contains 131 raw rows, 128 historical schema-v4 rows, 115 gaps over 60 minutes and only one row in the active cohort.
On September 30 its captures were at 02:28:45, 08:58:57, 15:52:49 and 20:46:04 UTC; gaps are hours despite the declared 15-minute schedule.
The corresponding four harvest runs completed successfully. Run 36774895433 published its tape; its log records PRIOR_CAPTURE_TOO_OLD and independentRowCount=1.
Thus these latest gaps are not repaired by changing the sample threshold or by treating failed publication as proven.
GitHub documents possible delayed/dropped schedule events: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule .
Scheduler delay is a plausible explanation, not a verified root cause for every historical gap.

## Bounded experiment
Use the existing positioning-dynamics-capture workflow, with no new cron or persistent service.
Each invocation gets a fresh directory under paper-tape/positioning-continuity-v1/<run-id>-<attempt>/ on capture-tape.
Register protocol.json and its SHA-256 before fetching observations. Never overwrite a registered session.
Collect at most 24 attempts with at least 65 seconds after the previous attempt finishes.
Stop initiating/admitting observations at 30 minutes; outbound requests inherit the remaining deadline as well as existing provider timeouts. The workflow has a 32-minute collection-step fallback.
Keep the original 60-second taker window, 90% coverage, source freshness, 60-minute cohort cutoff and minimum 20 independent rows.
Reject repeated closed bars and exchange taker-window ends separated by less than 60 seconds, even when wall-clock capture times differ.
An insufficient-coverage attempt is recorded but contributes no sample. An unexpected main-capture failure stops the session.
Optional normalized spot/perp divergence must precede positioning by at most 30 seconds. Unavailable or stale divergence remains missing.
Use the existing fixed five-family positioning study; do not change its rules, 12-bps stressed round-trip deduction, chronological partitions or sealed holdout.
Archive partial/failing evidence and preserve failed run status. Per-run paths prevent concurrent harvests from overwriting this session.

## Pre-existing hypotheses to challenge
These mechanisms are hypotheses, not established explanations or measured edge. Thresholds remain in runPositioningEdgeFactory.mjs.

| Family | Proposed mechanism | Main invalidator |
|---|---|---|
| funding_oi_taker_reversal | Crowded leveraged positioning may unwind when aggressive flow reverses. | No persistent positive net response after cost. |
| funding_price_disagreement | A funding/price crowd may overextend before a reversal. | Continuation dominates or contrarian loss exceeds cost buffer. |
| oi_shock_failed_continuation | New positioning without flow confirmation may fail to extend price. | OI/flow mismatch has no stable forward consequence. |
| taker_reversal_after_vol_expansion | Aggressive flow after volatility expansion may mark pressure changing direction. | Reversal signal is transient noise or adverse selection. |
| spot_perp_taker_divergence_continuation | Aggression concentrated in perpetuals may precede a short continuation. | As-of join unavailable, effect disappears after cost, or no forward persistence. |

Funding here is the adapter's lagged settled funding feature, not promised future funding income.
The study measures closed-bar forward return proxies with a fixed cost assumption; it has no executable entry/exit fills.
A sample collected every roughly one minute is a new measurement cadence, not evidence that an older 15-minute result transfers.
Twenty independent observations permit beginning this diagnostic; they do not prove profitability, capture probability, statistical significance or PAPER eligibility.
A positive RESEARCH_CANDIDATE still requires separate frozen forward validation, executable economics and sufficient independent evidence. Final holdout remains sealed.

## Verification and authority
64 deterministic tests passed locally, including 13 new session/adapter tests covering replay, missing numbers, coverage gaps, fatal failures, elapsed budgets, deadline propagation, optional divergence and immutable session IDs.
Workflow YAML parsed; PR test job has read-only permission and never collects market data. Write permission is limited to the non-PR evidence job.
Frontend build not run locally for this research-only checkout; the repository PR build must be checked before merge.
No risk limits, Kelly, TP/SL, execution gateway, accounts, credentials, LIVE_LOCKED, strategy promotion or production scheduler changed.
Runtime market results are not yet claimed by this document. Append verified run/tape results after the pilot completes.

## Missing-number hardening — 2026-10-01
The legacy capture helper treated null as zero through Number(null). Two regression tests reproduce that defect: missing required features incorrectly allowed cross-capture deltas, and absent funding/premium/optional metrics appeared as observed zeros.
The helper now accepts only nonblank numeric strings and numbers; unknown values remain null and genuine numeric zeros remain zero.
Continuity admission additionally requires finite taker ratio, settled funding and premium before deriving a feature row.
67 tests pass after the repair; original failing regressions were reproduced before correction.
Maintenance pushes now verify only. A new market session requires workflow_dispatch or a matching-path push whose commit starts with capture:, following the existing branch-capture convention. This avoids unintentionally spending another 30-minute session on each maintenance merge.
The already running pilot 36794235660 keeps its original source revision 18bb315c27ea7f578232576e921ee19b20292fe4 and registered dataset; inspect numerical completeness before interpreting its results. No historical evidence is rewritten.
