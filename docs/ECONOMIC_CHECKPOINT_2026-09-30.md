# Economic checkpoint — 2026-09-30

## Scope and provenance
Read-only review of source 9d9f6035eb7eba8e421f52bc46966704f861b7a6 and capture-tape snapshot 0948fa3ad454ad86fc8872e546255d301db26e18.
These are dated PAPER/RESEARCH artifacts, not live-money results or a guarantee of profit.
No wallet, trading credentials, execution path, limits or deployment configuration changed.

## Observed economic evidence
| Evidence | As of UTC | Result | Interpretation |
|---|---|---|---|
| paper-tape/funding-latest.json | 2026-09-30 20:46 | funding +40.2338703863 USDT; price PnL -254.5327028345; fees 10; net -224.2988324482 | Fee lock already active; funding income alone is not profit. |
| quant-evidence/forward-paper-latest.json | 2026-09-30 21:01 | 13 variants, 4 frozen-champion families; none next-stage eligible | Three champions negative; the positive XRP pullback champion has only one closed trade. |
| quant-evidence/research-promotion-latest.json | 2026-09-30 19:34 | 0 forward-paper eligible; 9 lanes building evidence | No new promotion authorization. |
| quant-evidence/maker-fill-calibration-latest.json | 2026-09-30 19:24 | 1,344 valid observations, 5 validated cohorts; all 5 usable fill probabilities = 0 | Validated queue cohorts provide no demonstrated fill opportunity. Do not pool other, unvalidated cohorts to bypass this. |
| quant-evidence/micro-canary-paper-latest.json | 2026-09-24 19:58 | baseline -0.0323912 USD over 2 replay trades | Historical diagnostic; not new paper execution or realized money. |

## Concrete pipeline defect and repair
Run [36784740134](https://github.com/Blackleets/genesis-hq-lab/actions/runs/36784740134) failed before all lab steps.
server/tests/publicResearchRunSummary.test.mjs imported ../publicResearchRunSummary.mjs, resolving to a nonexistent server/publicResearchRunSummary.mjs.
The implementation lives at scripts/publicResearchRunSummary.mjs. Import now resolves ../../scripts/publicResearchRunSummary.mjs.
The original failure was reproduced locally. All 49 tests from the exact safety/allocation/smart-execution workflow command pass after correction.
No tests, thresholds, assertions or safeguards were removed.

## Next evidence-producing action
Verify the repaired institutional workflow completes and inspect its fresh net-cost reports.
Separate the delta-neutral funding carry lab from the losing directional funding-hold tape.
Keep paper cash unallocated where no sleeve qualifies.
Do not retune frozen forward champions or open sealed maker holdouts merely to obtain a positive result.
No validated live-profit claim exists in the reviewed evidence.

## Boundary
LIVE_LOCKED remains true; this repair only restores research and reporting.

## Verified recovery — 2026-09-30 22:35 UTC
[Run 36785771684](https://github.com/Blackleets/genesis-hq-lab/actions/runs/36785771684) completed successfully on a5cbbfb40f643844b06d7d14bd21f99bb0ff9568 after PR #150 merged.
All seven lab steps, allocator invariants, summary publication and artifact upload passed. PR checks also passed, including production build and isolated browser acceptance.

| Fresh lane | Result | Interpretation |
|---|---|---|
| Market making | ETHUSDT, 23 observations, net expectancy -0.5017 bps | Queue-aware proxy; negative, no qualified allocation. |
| Statistical arbitrage | 63 candidates; 0 OOS passes | Best XRPUSDT/LINKUSDT has 6 validation trades and only 1 holdout trade. Positive figures do not establish edge. |
| Funding carry | 7 symbols; 0 OOS passes; best has 0 OOS trades | Historical delta-neutral lab; no qualifying opportunity. |
| Solana liquidity | 69 screened pools; sleeve has 10 forward proxy windows | Proxy expectancy 0.0041397492 bps, not capital eligible; no holding-horizon candidate. |
| Volatility sizing impact | 888 replayed trades, RISK_IMPROVEMENT_ONLY | Losing baseline loses less; no alpha or profitable sizing claim. |
| Volatility-normalized exits | 0 candidates | No eligible redesign produced. |
| Allocator | 0 qualified sleeves, 100% paper cash, WAIT | LIVE_LOCKED and zero authority preserved. |

## Next diagnosed bottleneck: positioning continuity
At tape snapshot 0948fa3ad454ad86fc8872e546255d301db26e18, paper-tape/positioning-data-quality-latest.json has 131 raw rows, 128 schema-eligible historical rows, 115 excessive-gap resets and only 1 current independent row versus 20 required to begin the study.
This is a data continuity failure, not permission to lower the sample or freshness thresholds.
Inspect successful-capture spacing, provider gaps, publish failures and scheduling delay before selecting a capture repair. The cause of each gap has not yet been isolated.
GitHub documents that scheduled workflows can be delayed: https://docs.github.com/en/actions/how-tos/troubleshoot-workflows .
Preserve the 60-minute cohort cutoff, source freshness, non-overlapping windows and sealed holdouts. Restore genuine consecutive observations; never concatenate disconnected cohorts or fabricate missing OI/flow.
