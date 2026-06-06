# Genesis HQ — Data Flow Map

> Audit date: 2026-06-05. Read-only.

## Overview: Three Parallel Data Loops

```
Loop A: Prediction Market Cycle (every 5 min)
  External APIs → agentRunner → SQLite → /api/* → Frontend polling

Loop B: Crypto Scalping Cycle (every 1 min)
  Binance → cryptoWorkflow → SQLite → /api/crypto/overview → Frontend

Loop C: Optimizer Cycle (every 45 min)
  Binance historical → backtestEngine → strategyParams.mjs (file overwrite)
```

---

## Loop A: Prediction Market Data Flow (5-minute cycle)

```
1. agentRunner.mjs (ticker: every 5 min)
   └─▶ scanMarkets() [server/marketScanner.mjs]
         ├─▶ GET gamma-api.polymarket.com/events (limit=20, active=true)
         │     Returns: { id, question, category, outcomes, prices, volume, endDate }
         │     Parsed by: server/polymarket.mjs → unified Market object
         └─▶ GET trading-api.kalshi.com/trade-api/v2/markets (status=open)
               Returns: { ticker, question, category, yes_bid, volume_24h, close_time }
               REQUIRES: KALSHI_API_KEY in .env (skips gracefully if missing)

2. workflow.mjs stepQualify()
   └─▶ In-memory filter: volumeTotal ≥ 5000, price 0.08–0.92, 1–45 days
         No DB access, no network calls

3. workflow.mjs stepVetoCheck()
   └─▶ SQLite READ: SELECT FROM mistake_patterns WHERE active=1
         SELECT FROM operating_rules WHERE is_hard=1
         Pattern match: market question vs. known failure conditions

4. workflow.mjs stepDebate()
   └─▶ POST api.anthropic.com/v1/messages (claude-haiku-4-5-20251001)
         Prompt: market summary + recent lessons + bull/bear framing
         Returns: { side: 'YES'|'NO', confidence: 0.0-1.0, reasoning }
         FALLBACK: if no API key → rule-based debate (simple heuristic)

5. workflow.mjs stepExecute()
   └─▶ treasury.mjs kellySize(confidence, price) → shares + capitalUsed
         riskManager.mjs preTradeCheck() → hard blocks validation
         execution.mjs executeTrade():
           IF REAL_TRADING=false: saveTrade() → SQLite INSERT into trades
           IF REAL_TRADING=true AND source=kalshi: placeKalshiOrder()
           IF REAL_TRADING=true AND source=polymarket: STUB — returns { executed: false }

6. learningEngine.mjs (on trade close)
   └─▶ analyzeClosedTrade() → POST api.anthropic.com (Claude)
         Extracts: lesson, rule, new_veto_pattern
         SQLite INSERT into lessons, mistake_patterns

7. Server API layer (server/index.mjs)
   └─▶ Frontend polls every 10s:
         GET /api/trading/dashboard → SELECT from trades, capital_history, skill_versions
         GET /api/agent/trades      → SELECT from trades WHERE status='closed' LIMIT 50
         GET /api/agent/lessons     → SELECT from lessons LIMIT 20
         GET /api/agent/signals     → SELECT from signals LIMIT 20

8. Frontend (src/dashboard/ + src/workflows/)
   └─▶ GenesisDashboard.tsx: renders capital, PnL, win rate, recent trades
         TradingHistoryView.tsx: renders closed trades + lessons
         EdgeScorecardView.tsx: renders /api/trading/edge-scorecard response
```

---

## Loop B: Crypto Scalping Data Flow (1-minute cycle)

```
1. agentRunner.mjs (crypto ticker: every 1 min)
   └─▶ cryptoWorkflow.mjs runCryptoCycle()
         For each asset in CRYPTO_ASSETS env var (default: BTC, ETH, SOL, BNB):

2. priceFeeder.mjs fetchAssetContext(symbol)
   └─▶ GET api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=360
         Returns: 360 × 1-minute OHLCV candles
         Computes: EMA9, EMA21, RSI14, 1h price change, 24h volume
         Also fetches HTF klines for multi-timeframe filter:
           GET .../klines?interval=15m&limit=50

3. signal.mjs evaluateSignal(assetContext, params)
   └─▶ Confluence check (pure math, no network):
         - Momentum: EMA9 > EMA21 with % margin
         - RSI: in target range (oversold for LONG, overbought for SHORT)
         - Volume: 24h volume above floor
         - HTF filter: 15m trend aligns with signal direction
         Returns: { action: 'TRADE'|'WAIT', side: 'LONG'|'SHORT', confidence }

4. IF action='TRADE':
   └─▶ cryptoDebate.mjs runCryptoDebate()
         POST api.anthropic.com (Claude Haiku) — bull/bear args for crypto signal
         Returns: { proceed: true|false, confidence, finalSide }

5. IF proceed AND cryptoRisk.mjs checks pass:
   └─▶ cryptoExecution.mjs executeCryptoPaperTrade()
         Computes: entryPrice, targetPrice (+ targetPct%), stopPrice (- stopPct%)
         SQLite INSERT into trades (status='open', market_source='crypto')

6. positionManager.mjs (every 1 min):
   └─▶ For each open crypto trade:
         Fetch current price from Binance
         IF price ≥ target → close as win, SQLite UPDATE
         IF price ≤ stop → close as loss, SQLite UPDATE
         IF elapsed > timeoutHours → close at market, SQLite UPDATE

7. Frontend polling (every 15s via CryptoLabView.tsx):
   └─▶ GET /api/crypto/overview
         Returns: params, openTrades, recentTrades, optimizerState, pnlByAsset
```

---

## Loop C: Optimizer Data Flow (45-minute cycle)

```
1. runOptimizer.mjs (ticker: every OPTIMIZER_INTERVAL_MIN minutes)
   └─▶ For each asset in CRYPTO_ASSETS:

2. Fetch historical data:
   └─▶ GET api.binance.com/api/v3/klines?interval=1m&limit=64800
         64,800 candles = ~45 days of 1-minute data

3. Data split (in memory):
   └─▶ 70% in-sample (training set)
         30% out-of-sample (validation set)

4. optimizer.mjs optimizeParams(klines, currentParams)
   └─▶ Generate candidates: base params + one-at-a-time mutations (±10% on each param)
         For each candidate: run backtestEngine.mjs
           - Replay klines candle-by-candle using evaluateSignal()
           - Score: expectancy × sqrt(trades) - penalty × maxDrawdown
         Coordinate descent: 2-3 rounds of greedy selection

5. shouldAdopt() check (anti-overfit gate):
   └─▶ Compare best candidate vs. current on OOS data
         Adopt ONLY if:
           - Candidate expectancy > 0 AND significantly better than current
           - Avoids adoption of overfit params

6. IF adopted:
   └─▶ Write new params to strategyParams.mjs (FILE OVERWRITE — not DB)
         WARNING: This mutates a source file at runtime. Restarts lose optimizer history.

7. Frontend shows optimizer state via:
   └─▶ GET /api/crypto/overview → { optimizerState: { lastRun, daysOfData, bestExpectancy } }
```

---

## WebSocket Event Flow

```
Source: server/index.mjs broadcast() function

Events pushed to all connected clients:

Event               │ Trigger                          │ Payload
────────────────────┼──────────────────────────────────┼────────────────────────────────
agent:tick          │ Every 15 seconds (heartbeat)     │ treasury snapshot (capital, PnL)
trade:executed      │ After executeTrade() succeeds     │ { tradeId, market, side, capital }
trade:resolved      │ After closeTrade() succeeds       │ { tradeId, pnl, resolution }
lesson:learned      │ After analyzeClosedTrade()        │ { lessonId, rule, tradeId }
capital:updated     │ After settleTradeCapital()        │ { capital, bucket allocations }
agent:status        │ Agent state transition            │ { agentId, status, task }
agent:log           │ Agent emits log line              │ { agentId, level, message }
agent:completed     │ Agent task done                   │ { agentId, result }

Broadcast path: agentRunner / agentEngine → POST /internal/broadcast → Set<WebSocket>
```

---

## Frontend State Flow

```
localStorage ←→ genesisStore.ts (67,601 lines)
      │
      ├── App.tsx: 5-second timer → actions.tick() (advances onboarding, task timers)
      │
      ├── services/agentClient.ts: polls every 10s
      │     GET /api/trading/dashboard → actions.setLiveMetrics()
      │     GET /api/agent/trades → actions.setTrades()
      │
      ├── hooks/useWebSocket.ts: subscribes to ws://localhost:8787/ws
      │     agent:tick → actions.setCapital()
      │     trade:executed → actions.appendTrade()
      │
      └── UI renders from store selectors
            useSyncExternalStore(subscribe, getSnapshot) → re-renders on commit()
```

---

## Data Persistence Summary

| Data Type | Storage | Written By | Read By |
|-----------|---------|-----------|---------|
| Trades | SQLite (trades) | agentRunner | Server API |
| Lessons | SQLite (lessons) | agentRunner | Server API |
| Capital | SQLite (capital_history) | agentRunner | Server API |
| Signals | SQLite (signals) | researchAgent | Server API |
| Agent state (visual) | localStorage | Frontend (genesisStore) | Frontend |
| Agent state (real) | SQLite (agent_executions) | agentEngine | Server API |
| Strategy params | strategyParams.mjs (file) | Optimizer | Live crypto loop |
| Org state | In-memory (orgState.mjs) | commandExecutor | Server API |
| Mistake patterns | SQLite (mistake_patterns) | learningEngine | workflow.mjs |
| Veto history | SQLite (trades, status='vetoed') | workflow.mjs | Server API |
