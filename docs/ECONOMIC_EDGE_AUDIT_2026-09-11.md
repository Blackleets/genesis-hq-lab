# Economic edge audit — 2026-09-11

## Decision

No demonstrated economic edge and no authorization for real capital. Current v8 is an experiment with only two closed paper trades. This audit is read-only: its KILL labels are recommendations, not execution-gateway enforcement.

| Cohort | Closed | Stored PnL USD | Expectancy USD | Profit factor |
| --- | ---: | ---: | ---: | ---: |
| Exact short_micro:v8 | 2 | -1.530 | -0.765 | 0.361702 |
| Exact short_micro:v7 | 1 | -2.073 | -2.073 | 0 |
| All futures, mixed historical attribution | 64 | -195.8842 | -3.060691 | 0.614938 |

The historical total is not an estimate of current v8 performance. Fifty-four old records have missing mode and sixty-one lack strategy version. Both v8 closures are SHORT, RANGE, confidence 0.75; ETH/Asia lost 2.397 and BTC/London gained 0.867. One open paper position was observed separately and is excluded from realized performance.

Latest captured short_micro:v8 research snapshot: walk-forward failed (1 of 3 positive folds, 2 required); OOS failed (9 trades, PnL -4.835, PF 0.5726). These research trades are not the two forward paper closures and must not be added to them. No segment or confidence calibration is statistically established by this sample.

## Observed deployment and pipeline

Baseline repository SHA: `870e52b89152811347a435e313222d8678d9e1f4`, default branch `feat/genesis-life-os`. Vercel reports a READY preview for that SHA in `genesis-hq-lab-real`; this is not proof that its production alias uses the same SHA.

The public `https://genesis-hq-lab.vercel.app/api/system/health` returned HTTP 200 at 12:42:08 UTC, identified `supabase_futures_runner` v8.1, last tick 12:30:10 UTC, one open trade, `paperOnly:true`, `liveOrders:false`. This verifies the reported runtime boundary, not independent exchange reconciliation.

Repository pipeline inspected in `supabase/functions/genesis-futures-runner/index.ts`:

1. Public Binance klines and ticker; default base is spot-reference `data-api.binance.vision/api/v3`, not a verified perpetual execution feed.
2. Closed candles feed a Donchian close breakout with SMA55 and fixed LONG/SHORT lane. Context is separately classified and recorded.
3. Version/family validation, quarantine, open-position limits and economics checks gate paper entries.
4. `economics()` sets margin times leverage, modeled entry slippage, rounded shares, 12% target and 3% stop. `tpNet` is profit conditional on hitting the target, not probability-weighted expected profit.
5. `openPaperPosition()` inserts into `trades` with version/regime/session attribution and constant confidence 0.75.
6. `closePositions()` checks sampled prices against target/stop/timeout, models execution costs, and persists `pnl` and `funding_paid`.
7. Validation snapshots and heartbeat are written to Supabase; Vercel health exposes the runner separately from its local server state.

## Material economic limitations still open

- Entry slippage is already included by `economics()` and is applied again to stored entry by `closePositions()`. The recorded PnL therefore includes an additional modeled entry penalty. Do not subtract the audit's modeled costs again.
- Funding is fixed at entry to 0.0001, prorated by elapsed hours with a one-hour minimum, and subtracted for either side. This is not settled, side-aware perpetual funding. A Binance connector read returned BTCUSDT funding rate 0.00003206 at exchange timestamp 1789130177005; that single observation cannot reconstruct historical settlements.
- Spot-reference prices, fixed funding and sampled exits cannot certify executable futures returns. Missing intraperiod stop crossings cannot be recovered from a ticker snapshot.
- Constant 0.75 confidence is not a calibrated probability. The audit measures calibration against net wins only as a diagnostic.
- Audit drawdown percentage uses mean trade allocation, not reconstructed account equity; it must not be presented as actual portfolio drawdown. Policy thresholds are inherited audit defaults, not independently justified capital limits.
- The $10 canary is a replay diagnostic. Its `replayTrade()` clamps losses to the remaining loss budget; this is not proof of a realizable maximum loss through price gaps.
- Net business profit still needs infrastructure/API costs and complete account-equity reconciliation. The audit cannot demonstrate that Genesis pays for itself.

Correcting runner cost semantics requires a new version and fresh evidence, not rewriting historical trades. No strategy tuning or production runner change is bundled into this audit-integrity fix.

## Implemented correction

- Missing/blank/boolean/invalid PnL and confidence stay unknown; out-of-range confidence fails integrity instead of being clamped.
- Duplicate or missing trade IDs block evidence eligibility.
- The canonical hash binds status, signal provenance, modeled friction, research evidence, policy and audit version; object key ordering does not alter it.
- Live REST reads paginate instead of silently stopping at the first capped response. Offset pagination is not transaction-consistent while records change; the captured offline snapshot is the reproducible input.
- CLI supports credential-free offline snapshots. Output explicitly identifies stored PnL, modeled cost and allocation-based drawdown semantics.

## Reproduce

Inputs and output are in `evidence/economic-audit-2026-09-11/`. They are actual read-only SQL results, not test fixtures. Trade and validation queries were separate reads; capture time is recorded in the input. The snapshot contains all 64 closed futures rows returned by the query and latest research snapshot per version.

```sh
node scripts/quantEngineeringAudit.mjs --input evidence/economic-audit-2026-09-11/input.json --out /tmp/genesis-economic-audit.json
node --test server/tests/economicEdgeAudit.test.mjs
npm run build
```

`--strict` exits 2 for `KILL_PRESENT`; this is an economic/integrity verdict, not a crashed process. Ten tests and the production build passed. No orders, database mutations, strategy overrides or activation flags were changed.
