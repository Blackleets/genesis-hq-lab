# Prediction Markets — Live Proof Checklist

Use this checklist before claiming any module is "production ready".
Each item must have evidence (log line, curl output, or screenshot path).

---

## 1. Data — Real Data Comprobado

- [ ] `GET /api/prediction-markets/status` → returns `{ ok: true, providers: { polymarket: { mode: 'read-only', ... }, kalshi: { ... } } }`
- [ ] `GET /api/prediction-markets/markets` → returns markets from Polymarket Gamma API (not fixture)
  - Evidence: response contains `source: 'polymarket'` and real market titles
- [ ] Response does NOT contain `mode: 'fixture'` unless explicitly testing fixtures
- [ ] Log line `DATA_FETCH_OK` visible in `/api/prediction-markets/status` or operator timeline

## 2. API Conectada

- [ ] Polymarket Gamma API reachable (no CORS, no timeout):
  ```bash
  curl https://gamma-api.polymarket.com/events?active=true&limit=1
  ```
- [ ] Response contains real events with `volume24hr` > 0
- [ ] If Kalshi key present: `GET /api/kalshi/status` returns `{ enabled: true, ... }`

## 3. Logs Reales

- [ ] `PREDICTION_DATA_FETCHED` event appears in `/api/operator/timeline?category=PREDICTION`
- [ ] Timestamp is recent (< 5 minutes old)
- [ ] No `NORMALIZE_FAIL` errors in last 50 events

## 4. Paper Order Validado

- [ ] `POST /api/prediction-markets/execution/paper-order` with valid body returns:
  ```json
  { "ok": true, "mode": "paper", "orderId": "...", "status": "filled" }
  ```
- [ ] Response contains `auditLog` entry
- [ ] `PREDICTION_PAPER_ORDER_CREATED` event visible in operator timeline
- [ ] Order appears in `GET /api/prediction-markets/execution/status`

## 5. Risk Guard Funcionando

- [ ] Paper order with `amount > MAX_PREDICTION_POSITION_SIZE` is REJECTED:
  ```bash
  curl -X POST /api/prediction-markets/execution/paper-order \
    -d '{"amount": 99999, "marketId": "test", "outcome": "YES"}'
  ```
  → Response: `{ "ok": false, "reason": "POSITION_SIZE_EXCEEDED" }`
- [ ] `PREDICTION_ORDER_REJECTED` event in operator timeline
- [ ] Daily loss cap: after exceeding `MAX_PREDICTION_DAILY_LOSS`, all orders rejected with `DAILY_LOSS_CAP_HIT`

## 6. Backtest Marcado Correctamente

- [ ] `POST /api/prediction-markets/backtest` with `source: "fixture"` returns:
  ```json
  { "dataMode": "FIXTURE_DATA", "disclaimer": "..." }
  ```
- [ ] Response does NOT say "guaranteed" or "expected returns"
- [ ] `winRate`, `EV`, `maxDrawdown`, `profitFactor` all present
- [ ] `fees` and `slippageEstimate` included and non-zero
- [ ] If insufficient data: returns `{ "error": "INSUFFICIENT_DATA" }`

## 7. Live Trading Bloqueado por Defecto

- [ ] `POST /api/prediction-markets/execution/live-order` WITHOUT env vars returns:
  ```json
  { "ok": false, "blocked": true, "reason": "LIVE_TRADING_DISABLED" }
  ```
- [ ] Same with `ENABLE_LIVE_PREDICTION_TRADING=false` (explicit)
- [ ] `PREDICTION_LIVE_ORDER_BLOCKED` event in operator timeline
- [ ] Even with `ENABLE_LIVE_PREDICTION_TRADING=true`, missing `MANUAL_CONFIRMATION_TOKEN` → `MISSING_CONFIRMATION_TOKEN`

## 8. Rollback Posible

- [ ] All new code is in isolated directories (`server/predictionMarkets/`, `src/components/predictionMarkets/`)
- [ ] Removing `server/predictionMarkets/` does NOT break existing endpoints (test: existing `/api/polymarket/health` still works)
- [ ] `npm run build` passes after rollback
- [ ] `npm test` passes after rollback

---

## Evidence Log

Fill this in as you verify each item:

| Date | Item | Evidence | Verified By |
|------|------|----------|-------------|
| | Data real fetched | | |
| | Paper order works | | |
| | Risk guard blocks over-limit | | |
| | Live trade blocked | | |
| | Backtest marked FIXTURE_DATA | | |
| | Build passes | | |
| | Tests pass | | |
