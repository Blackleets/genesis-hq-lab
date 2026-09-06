# Genesis Quant Research / Challenger operations

This source tree mirrors the production-safe quant research stack:

- `genesis-futures-runner` v8.1 / QVE v1.1: PAPER-only execution with family risk and research vetoes.
- `genesis-quant-research` qre_v1: hourly fixed-parameter historical OOS + walk-forward research on Binance public spot-reference klines.
- `genesis-quant-challenger` qcl_v1: research-only challenger tournaments with 60% train / 20% validation / 20% final holdout. Holdout is never used for ranking or tuning.
- `genesis-runner-status` v4: read-only telemetry exposing QVE and Challenger Lab evidence.

Safety invariants:

- Research and challenger workers have `executionAuthority: false`.
- Runner remains `paperOnly: true` and `liveOrders: false`.
- Challenger survivors are shadow candidates only. They do not modify active strategy versions or unlock capital.
- Cron jobs resolve `genesis_runner_token` from Supabase Vault at runtime; the secret is never committed.
- Final live eligibility remains Founder-controlled and `LIVE_LOCKED`.
