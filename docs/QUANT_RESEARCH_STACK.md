# Genesis Quant Research / Challenger operations

This source tree mirrors the production-safe quant research stack:

- `genesis-futures-runner` v8.1 / QVE v1.1: PAPER-only execution with family risk and research vetoes.
- `genesis-quant-research` qre_v1: fixed-parameter historical OOS + walk-forward research on Binance public spot-reference klines.
- `genesis-quant-challenger` qcl_v2: research-only challenger tournaments with ATR(14)-adaptive exits, an economics-first friction gate, 60% train / 20% validation / 20% final holdout, and fixed-candidate walk-forward before holdout.
- `runQuantChallengerFallback.mjs`: Edge-independent qcl_v2 runner using the same public Binance reference data and the same shared ATR/economics core. It has no execution authority and persists evidence only to `capture-tape/quant-evidence/` through GitHub Actions.
- `genesis-runner-status` v5: read-only telemetry exposing QVE and Challenger Lab evidence.

## Challenger v2 search policy

qcl_v2 replaces the old fixed 4% / 8% / 12% target grid. Those targets were poorly scaled for intraday 5m/15m profiles and could produce indistinguishable timeout-driven candidates.

Each candidate now searches:

- breakout lookback: 0.6x / 0.8x / 1.0x / 1.2x the profile base period;
- target: 1.0 / 1.5 / 2.0 ATR depending on risk-reward tuple;
- stop: 0.75 / 1.0 ATR;
- timeout: 0.5x / 1.0x the profile base timeout.

The ATR is calculated using only information available through the signal bar. Before a trade is simulated, the candidate target must cover at least 2x a conservative friction estimate consisting of round-trip taker fees, two-sided slippage estimated from recent quote volume, and timeout-horizon funding cost. Signals that fail this test are recorded as `skippedByEconomics`; they are not turned into paper trades.

The economics gate is a precondition, not evidence of alpha. A candidate must still pass train, validation, fixed-candidate walk-forward and sealed holdout requirements.

## Anti-overfit policy

- First 60%: train and ranking only.
- Next 20%: validation; parameters remain fixed.
- Walk-forward: three pre-holdout fixed-candidate folds; at least 2/3 positive and at least 12 forward trades.
- Final 20%: sealed holdout opened only for finalists. Holdout never ranks or tunes candidates.
- v1 state/history are preserved; qcl_v2 writes to `quant_challenger_lab_v2` and `quant_challenger_history_v2` when Supabase Edge is available.

## Edge quota contingency

Supabase Edge remains the canonical hosted qcl_v2 worker. If the project is restricted by Edge quota, `.github/workflows/quant-challenger-fallback.yml` executes the same research-only tournament directly on a GitHub runner and stores durable evidence on the `capture-tape` branch:

- `quant-evidence/qcl-v2-latest.json` — full latest four-profile result;
- `quant-evidence/qcl-v2-history.jsonl` — append-only compact run history.

The fallback is evidence generation only. It does not write `strategy_versions`, does not modify Founder readiness, and does not submit exchange orders.

## Safety invariants

- Research and challenger workers have `executionAuthority: false`.
- Runner remains `paperOnly: true` and `liveOrders: false`.
- Challenger survivors are shadow candidates only. They do not modify active strategy versions or unlock capital.
- Cron jobs resolve `genesis_runner_token` from Supabase Vault at runtime; the secret is never committed.
- Final live eligibility remains Founder-controlled and `LIVE_LOCKED`.
