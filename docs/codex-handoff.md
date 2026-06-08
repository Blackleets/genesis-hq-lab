# Codex Handoff - Genesis HQ current reality

Context for a collaborating coding agent.

## Current truth

The crypto core is auditable now. The main reporting, autopsy, fallback truth, and additive gating
work is already done and deployed.

Live state verified on 2026-06-08:

- `closedTrades`: 103
- `wins`: 19
- `winRate`: 18.4%
- `totalPnl`: -68.58
- `expectancy`: -0.67
- `profitFactor`: 0.10
- `recommendation`: `pause_or_redesign_strategy`

Active additive manual filters:

- `SHORT_BEAR`
- hour `16`
- confidence band `80-89`

Conclusion: the scalp is still losing after 3 additive filters. Do not treat autonomous agents,
extra UI, or more AI layers as the next priority.

## What is already done

- Canonical crypto trade universe shared across:
  - `server/crypto/cryptoTradeUniverse.mjs`
  - `server/crypto/cryptoAnalytics.mjs`
  - `server/crypto/autoVeto.mjs`
  - `server/crypto/backtest/regimeBiasBacktest.mjs`
  - `server/crypto/cryptoRisk.mjs`
- Diagnostics exposes:
  - `autopsy.totalSamples`
  - `autopsy.edgeSummary`
  - `autopsy.breakdown`
  - `autopsy.candidateActions`
  - `autopsy.manualFilters`
  - `autopsy.manualFiltersActive`
  - `autopsy.recommendation`
- Claude fallback truth is exposed via live diagnostics.
- Operator status escalates to `PAUSE NOW` once the system stays negative after 3 additive filters.
- Recovery plan exists in:
  - `docs/CRYPTO_CORE_RECOVERY_PLAN.md`

## Immediate priority

Follow `docs/CRYPTO_CORE_RECOVERY_PLAN.md`.

The next real objective is not feature work. It is decision work:

1. Run the remaining Fase 1 observation window.
2. Decide whether `scalp_v2` should be paused as the primary strategy.
3. If it remains negative, move to redesign.

## If one last additive filter is explicitly requested

Only one slice is still a reasonable candidate:

- pair `BNBUSDT`
  - `EV -0.77`
  - `PF 0.04`

Do not stack multiple new filters without taking the pause/redesign decision.

## If redesign starts

Only test one hypothesis at a time:

1. pure trend continuation
2. pure mean reversion
3. single-pair specialization

Not allowed as a redesign answer:

- more agents
- more model layers
- more heuristics mixed together
- more UI before edge recovery

## Things not to touch

- execution engine
- risk engine
- safe mode
- daily caps
- Kelly sizing
- TP/SL
- paper-trading
- synchronous better-sqlite3 hot path

## Validation contract

Every meaningful change must keep these green:

- `node --check` for touched server files
- `npm test`
- `npm run build` if frontend changes

Every deploy must be verified live with:

- `/api/db/health`
- `/api/crypto/overview`
- `/api/crypto/diagnostics`
- `/api/crypto/regime-backtest`

## Handoff rule

If the system still shows `EV < 0` and `PF < 1`, say so directly and recommend pause or redesign.
Do not resume Phase 4 work while the core remains a losing strategy.
