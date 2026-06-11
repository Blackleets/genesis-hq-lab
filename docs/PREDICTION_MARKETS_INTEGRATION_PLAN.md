# Prediction Markets Integration Plan
## Genesis HQ Lab — Staff Engineer Reference

---

## 1. What Was Integrated

### Module 1 — Data Layer (`server/predictionMarkets/`)
- `polymarketProvider.mjs` — wraps existing `server/polymarket.mjs` (Gamma API, no auth required)
- `kalshiProvider.mjs` — wraps existing `server/kalshi/adapter.mjs` (requires KALSHI_API_KEY)
- `normalizer.mjs` — unified normalization to common `MarketSnapshot` model
- `marketStore.mjs` — in-memory LRU cache (TTL=60s) for normalized markets
- `dataProvider.mjs` — aggregates both providers, handles degraded mode
- `index.mjs` — route registration entry point

### Module 2 — Backtesting Layer (`server/predictionMarkets/backtesting/`)
- `backtestEngine.mjs` — simulates prediction market strategy on historical data
- `strategyRunner.mjs` — runs named strategy functions against market snapshots
- `metrics.mjs` — computes winRate, EV, maxDrawdown, profitFactor, Sharpe-like ratio
- `replay.mjs` — replays fixture or historical market sequences
- `fixtures/sample.json` — curated static fixture (clearly marked FIXTURE_DATA)

### Module 3 — Execution Adapter (`server/predictionMarkets/execution/`)
- `polymarketAdapter.mjs` — typed wrapper for Polymarket CLOB API (read-only by default)
- `polymarketSafety.mjs` — safety config: maxPositionSize, maxDailyLoss, requireManualApproval
- `orderValidator.mjs` — validates orders against safety limits before any execution
- `paperExecutor.mjs` — paper trade execution (no real money, full audit log)
- `liveExecutor.mjs` — live execution stub (BLOCKED unless ENABLE_LIVE_PREDICTION_TRADING=true)
- `portfolioReader.mjs` — read portfolio positions (read-only, no mutation)

### Module 4 — LP Tooling (`server/predictionMarkets/liquidity/`)
- `lpScanner.mjs` — scans normalized markets for LP opportunities
- `spreadScanner.mjs` — ranks markets by spread width
- `rewardScanner.mjs` — detects reward/incentive programs if API exposes them
- `lpRecommendations.mjs` — assembles final ranked recommendations with risk classification

### Module 5 — UI (`src/components/predictionMarkets/`, `src/workflows/PredictionMarketsLab.tsx`)
- `MarketStatusPanel.tsx` — connector status (Polymarket/Kalshi + mode badges)
- `MarketTable.tsx` — sortable table of active normalized markets
- `OpportunityPanel.tsx` — ranked opportunities
- `BacktestPanel.tsx` — backtest controls + results
- `LPPanel.tsx` — LP opportunity recommendations
- `ExecutionPanel.tsx` — paper/live order panel
- `RiskPanel.tsx` — safety limits display
- `PredictionMarketLogs.tsx` — recent PREDICTION_* events
- `PredictionMarketsLab.tsx` — main page wiring all panels

---

## 2. What Was Left as Reference (Not Copied)

| Repo | What was studied | What was taken | What was left |
|------|-----------------|----------------|---------------|
| Jon-Becker/prediction-market-analysis | EV calculation approach, Kelly sizing | Metric formulas (re-implemented cleanly) | Raw Python code |
| evan-kolberg/prediction-market-backtesting | Backtest loop structure, slippage modeling | Design pattern | Source code |
| warproxxx/poly_data | Gamma API endpoints, market normalization approach | API endpoint knowledge | Data pipeline code |
| caiovicentino/polymarket-mcp-server | Safety layer design, order flow | Safety config schema | MCP server code |
| lihanyu81/polymarket_lp_tool | Spread scanner logic, LP scoring | Risk classification schema | Python LP code |

---

## 3. What Was NOT Copied

- No Python code was ported.
- No external npm packages were added.
- No MCP server code was imported.
- No API keys or credentials from external repos.
- No historical data sets (all fixture data is synthetic and clearly marked).

---

## 4. Risks

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Polymarket Gamma API rate limits | LOW | TTL cache (60s), no aggressive polling |
| Kalshi API deprecation/change | MEDIUM | Wrapped in kalshiProvider.mjs, easy to swap |
| Paper order state lost on restart | LOW | In-memory only by design; use DB for persistence in v2 |
| Live order accidentally enabled | CRITICAL | Requires `ENABLE_LIVE_PREDICTION_TRADING=true` + `MANUAL_CONFIRMATION_TOKEN` |
| Backtest overfitting | MEDIUM | Fixture data clearly marked; no historical data auto-fetch |
| LP recommending illiquid markets | MEDIUM | Risk classifier: AVOID label for low-liquidity markets |

---

## 5. Required APIs

| API | Required For | Auth Method | Status Without Key |
|-----|-------------|-------------|-------------------|
| Polymarket Gamma API | Market data (read) | None (public) | FULLY FUNCTIONAL |
| Polymarket CLOB API | Order execution | Private key + ETH wallet | BLOCKED_BY_SECRET_OR_API |
| Kalshi REST API | Market data + positions | Bearer token | DEGRADED_MODE |
| Kalshi WebSocket | Real-time fills | Bearer token | DEGRADED_MODE |

---

## 6. Environment Variables

```bash
# Polymarket — data is PUBLIC (Gamma API), execution needs these:
POLYMARKET_API_KEY=                    # CLOB API key (not needed for read-only)
POLYMARKET_PRIVATE_KEY=                # Wallet private key — NEVER commit
POLYMARKET_FUNDER_ADDRESS=             # Funding wallet address

# Kalshi
KALSHI_API_KEY=                        # Bearer token for REST + WS
KALSHI_PRIVATE_KEY=                    # RSA private key for v2 auth

# Safety gates
ENABLE_LIVE_PREDICTION_TRADING=false   # Must be explicitly true to unlock live orders
MANUAL_CONFIRMATION_TOKEN=             # Required per live order (UUID or passphrase)
MAX_PREDICTION_POSITION_SIZE=10        # Max USD per position
MAX_PREDICTION_DAILY_LOSS=25           # Max USD daily loss before halt
PREDICTION_DRY_RUN_DEFAULT=true        # Paper mode by default
```

---

## 7. How to Test

### Backend health check
```bash
curl http://localhost:8787/api/prediction-markets/status
```

### Markets (uses Polymarket Gamma API — no key needed)
```bash
curl "http://localhost:8787/api/prediction-markets/markets?limit=5"
```

### Opportunities
```bash
curl http://localhost:8787/api/prediction-markets/opportunities
```

### Backtest
```bash
curl -X POST http://localhost:8787/api/prediction-markets/backtest \
  -H "Content-Type: application/json" \
  -d '{"strategy":"simple_yes_low","source":"fixture"}'
```

### Paper order
```bash
curl -X POST http://localhost:8787/api/prediction-markets/execution/paper-order \
  -H "Content-Type: application/json" \
  -H "x-api-secret: YOUR_API_SECRET" \
  -d '{"marketId":"0x1234","outcome":"YES","amount":5,"source":"polymarket"}'
```

### LP opportunities
```bash
curl http://localhost:8787/api/prediction-markets/liquidity/opportunities
```

---

## 8. What Remains Blocked

| Feature | Status | Blocker |
|---------|--------|---------|
| Kalshi real-time market data | BLOCKED_BY_SECRET_OR_API | Needs KALSHI_API_KEY |
| Polymarket portfolio reading | BLOCKED_BY_SECRET_OR_API | Needs POLYMARKET_PRIVATE_KEY |
| Live order execution | BLOCKED | Needs ENABLE_LIVE_PREDICTION_TRADING=true + MANUAL_CONFIRMATION_TOKEN |
| Historical backtest data | BLOCKED | No historical data source configured |
| Liquidity reward detection | BLOCKED_BY_SECRET_OR_API | Polymarket rewards API requires auth |

---

## 9. Architecture Notes

- All new code lives under `server/predictionMarkets/` — isolated, zero coupling to crypto engine
- Routes added to `server/index.mjs` at `/api/prediction-markets/*`
- Logging uses existing `logEvent()` from `server/observability/eventTimeline.mjs`
- New `PREDICTION` category added to eventTimeline CATEGORY constant
- UI module `pred-markets` added to moduleRegistry, sidebar group "Trading & Risk"
- No new npm dependencies added
- In-memory paper order store — intentionally ephemeral (restart clears it)
- All fallbacks return structured error with `mode: 'degraded'` field

---

## 10. Rollback Instructions

To fully remove this integration:

```bash
rm -rf server/predictionMarkets/
rm -rf src/components/predictionMarkets/
rm src/workflows/PredictionMarketsLab.tsx
# Revert 5 files: server/index.mjs, src/App.tsx, src/core/data/moduleRegistry.ts,
#                 src/ui/GenesisSidebar.tsx, src/core/i18n/translations.ts
# Delete from .env: POLYMARKET_*, KALSHI_PRIVATE_KEY, ENABLE_LIVE_*, etc.
```

Git rollback: `git revert HEAD` or `git reset --hard <pre-integration-commit>`
