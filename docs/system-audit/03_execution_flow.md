# Genesis HQ — Execution Flow

> Audit date: 2026-06-05. Read-only.

## Process Startup

```
npm start
  └─▶ concurrently:
        node server/index.mjs          → HTTP server on :8787 (631 lines)
        node server/agentRunner.mjs    → background ticker loop (206 lines)
        node server/crypto/runOptimizer.mjs → optimizer loop (165 lines)
        vite                           → frontend dev server on :5173
```

**Database init on startup:**
```
server/db/database.mjs:
  1. Open /data/genesis.db (creates if not exists)
  2. Set pragmas: WAL, foreign_keys ON, synchronous NORMAL, busy_timeout 5000ms
  3. READ server/db/schema.sql
  4. Execute all CREATE TABLE IF NOT EXISTS statements
  5. Database ready
```

**No startup reconciliation:** Open trades from a previous session are not reconciled with current market prices on restart. The system assumes open trades from a crashed session are still valid without verification.

---

## Main Trading Loop — SCAN → QUALIFY → VETO → DEBATE → EXECUTE

File: `server/agentRunner.mjs`, called every **5 minutes**

```
agentRunner.mjs:runTradingCycle()
│
├─▶ STEP 1: SCAN  [server/marketScanner.mjs:scanMarkets()]
│     ├─▶ fetchPolymarket():
│     │     GET gamma-api.polymarket.com/events?active=true&limit=20
│     │     → parse JSON → normalize to Market[] (id, question, category,
│     │       yesPrice, noPrice, volumeTotal, volume24h, daysToClose, source='polymarket')
│     │
│     └─▶ fetchKalshi() [if KALSHI_API_KEY set]:
│           GET trading-api.kalshi.com/trade-api/v2/markets?status=open
│           → parse JSON → normalize to Market[] (source='kalshi')
│
│     Returns: Market[] (combined, unsorted, 0-40 items typically)
│
├─▶ STEP 2: QUALIFY  [server/trading/workflow.mjs:stepQualify()]
│     Filter in-memory (no DB, no network):
│       volumeTotal >= 5000
│       volume24h   >= 200
│       yesPrice    >= 0.08 AND <= 0.92  (avoids near-certain outcomes)
│       daysToClose >= 1 AND <= 45       (horizon filter)
│
│     Returns: Market[] (0-20 items, typically 3-8 pass)
│
├─▶ STEP 3: VETO CHECK  [server/memory/mistakePrevention.mjs:checkVeto()]
│     For each qualified market:
│       SQLite: SELECT * FROM mistake_patterns WHERE active=1
│       SQLite: SELECT * FROM operating_rules WHERE is_hard=1
│       SQLite: SELECT COUNT(*) FROM trades WHERE status='open' [max=5 check]
│       SQLite: SELECT COUNT(*) FROM trades WHERE status='open' AND category=? [max=2 per category]
│       SQLite: SELECT COUNT(*) FROM trades WHERE opened_at >= today [max=8 daily]
│
│       IF any pattern matches market question → logVeto() + skip market
│       IF any hard rule violated → logVeto() + skip market
│
│     Returns: Market[] (survived veto)
│
├─▶ STEP 4: DEBATE  [server/trading/debateRoom.mjs:runDebate()]
│     For each veto-survived market:
│       1. getDecisionContext() → recent lessons from SQLite (last 10)
│       2. researchMarket() → newsAPI + HackerNews sentiment (optional, may be empty)
│       3. Build prompt: market details + context + bull/bear framing
│       4. POST api.anthropic.com/v1/messages (claude-haiku-4-5-20251001)
│          System: "You are a prediction market trading team..."
│          → { side: 'YES'|'NO', confidence: float, bull_arg, bear_arg, arbiter_verdict }
│       5. IF confidence < 0.65 → skip (not enough conviction)
│          IF side='NO' and bearConfidence > 0.58 → debate disagreement, skip
│       6. FALLBACK if no ANTHROPIC_API_KEY:
│          Rule-based: if price < 0.3 → YES at confidence=0.65
│                      if price > 0.7 → NO at confidence=0.65
│                      else → skip
│
│     Returns: TradeProposal (market + side + confidence + reasoning)
│
└─▶ STEP 5: SIZE + EXECUTE  [server/trading/workflow.mjs:stepExecute()]
      1. kellySize(confidence, entryPrice):
           fraction = (confidence - (1-confidence)/odds) × 0.3  [Kelly with 30% dampening]
           capitalUsed = availableCapital × fraction × budgetPct
           shares = capitalUsed / entryPrice

      2. preTradeCheck() [server/trading/riskManager.mjs]:
           Hard blocks (throws error if violated):
             - Portfolio drawdown ≥ 15% from peak
             - Open trades ≥ 5
             - Same category open trades ≥ 2
             - Daily trades ≥ 8
             - Loss streak ≥ 4
             - Duplicate market entry
           Soft warnings (logged, trade proceeds):
             - Low confidence + high price combination

      3. executeTrade() [server/trading/execution.mjs]:
           IF REAL_TRADING=false (DEFAULT):
             computePaperFillCosts({ entryPrice, shares, capitalUsed, volume24h })
               slippage = capitalUsed / (volume24h × 1_000_000) × 0.0005
               takerFee = 0.02 (2% conservative)
               effectivePrice = entryPrice × (1 + slippage + takerFee)
             SQLite INSERT into trades (status='open')
             return { executed: true, mode: 'paper' }

           IF REAL_TRADING=true AND source='kalshi':
             placeKalshiOrder():
               POST trading-api.kalshi.com/trade-api/v2/portfolio/orders
               headers: { Authorization: 'Token KALSHI_API_KEY' }
               body: { ticker, action:'buy', side:'yes'|'no', count:shares, type:'market' }
               IF success → SQLite INSERT (mode='real')
               IF failure → SQLite INSERT (mode='paper', reason=error)

           IF REAL_TRADING=true AND source='polymarket':
             STUB: return { executed: false, reason: 'not yet supported' }
             *** NO TRADE IS PLACED. THIS IS A DEAD END. ***
```

---

## Trade Settlement Flow (Closes Open Trades)

File: `server/agentRunner.mjs` — runs at the START of each 5-min cycle before scanning

```
1. Get all open prediction market trades from SQLite
2. For each open trade:
   a. getMarketStatus(market_id, source) → fetch current market state
   b. IF market resolved:
        closeTrade(tradeId, resolvedOutcome, exitPrice) → SQLite UPDATE
        settleTradeCapital(trade, pnl) → update capital_history
        updateAfterTrade(agentId, outcome) → update agent_profiles skills
        analyzeClosedTrade(trade) → Claude Haiku extracts lesson
          → SQLite INSERT into lessons
          → IF lesson has veto_pattern → SQLite INSERT into mistake_patterns
        broadcast({ type: 'trade:resolved', tradeId, pnl })
```

---

## Crypto Scalping Loop (1-minute cycle)

File: `server/agentRunner.mjs`, crypto ticker runs every **1 minute**

```
cryptoWorkflow.mjs:runCryptoCycle()
│
├─▶ cryptoRisk.mjs: check daily loss circuit breaker
│     IF realizedLoss today > CRYPTO_DAILY_LOSS_CAP → HALT all crypto
│
├─▶ For each asset (BTC, ETH, SOL, BNB by default):
│     priceFeeder.mjs:fetchAssetContext(symbol):
│       GET api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=360
│       Compute: EMA9, EMA21, RSI14, 1hChange, volume24h
│       GET .../klines?interval=15m&limit=50 [HTF filter]
│
│     signal.mjs:evaluateSignal(context, params):
│       strategy = params.strategy  // 'momentum' or 'mean-reversion'
│       IF momentum: EMA9 > EMA21 × (1 + margin) AND RSI in [rsiMin, rsiMax]
│       IF mean-rev: RSI < rsiOversold (LONG) or RSI > rsiOverbought (SHORT)
│       HTF filter: 15m EMA9 must align with signal direction
│       Volume floor: volume24h >= params.minVolume24hUsd
│       IF signal qualifies:
│         IF asset in cooldown after loss → SKIP (CRYPTO_COOLDOWN_MIN default=15)
│         IF already has open position → SKIP
│         return { action: 'TRADE', side, confidence }
│
│     cryptoDebate.mjs:runCryptoDebate(context, signal):
│       POST api.anthropic.com (Claude Haiku) — quick bull/bear for crypto
│       IF debate fails → skip asset
│
│     cryptoExecution.mjs:executeCryptoPaperTrade(asset, side, params):
│       entryPrice = context.price
│       targetPrice = side='LONG' ? price × (1+targetPct) : price × (1-targetPct)
│       stopPrice = side='LONG' ? price × (1-stopPct) : price × (1+stopPct)
│       SQLite INSERT into trades (status='open', source='crypto')
│
└─▶ positionManager.mjs:managePositions():
      For each open crypto trade:
        Fetch current price → check vs target/stop/timeout
        IF exit triggered → SQLite UPDATE (status='closed', pnl=...)
```

---

## Optimizer Loop (45-minute cycle)

File: `server/crypto/runOptimizer.mjs`

```
1. Fetch 45-day 1m klines from Binance (GET /api/v3/klines?interval=1m&limit=64800)
2. Split: 70% in-sample, 30% out-of-sample
3. Generate param candidates via one-at-a-time mutations on each of ~10 params
4. For each candidate: run backtestEngine.mjs
     - Replay klines: evaluateSignal() same function as live engine
     - Score: expectancy × sqrt(trades) - 0.5 × maxDrawdown
5. Coordinate descent: 2-3 rounds, pick best at each step
6. shouldAdopt(candidate, current, oosKlines):
     - Backtest both on OOS data
     - Adopt if candidate has statistically significant positive edge
7. IF adopted: write to server/crypto/strategyParams.mjs (MUTATES SOURCE FILE)
```

---

## Org State / Command Flow

```
POST /api/command { command: "pause crypto trading" }
  └─▶ commandExecutor.mjs:
        intentParser.mjs → POST api.anthropic.com (parse natural language intent)
        → orgState.mjs: setMode(), activateDept(), pauseDept(), setFocus(), setGoal()
        → SQLite INSERT into founder_orders
        → Response: { ok: true, summary: "Parsed and applied" }

Org state is PURELY IN-MEMORY (orgState.mjs).
It is NOT persisted to SQLite on write.
A server restart loses all org state changes made via /api/command.
```

---

## Real Agent Task Execution Flow

```
POST /api/agents/:id/task { task: "Analyze BTC signal" }
  └─▶ agentEngine.mjs:
        1. setState(agentId, 'thinking')     → broadcast agent:status
        2. buildSystemPrompt(agentId)        → loads agent definition from agentRegistry
        3. providerRouter.mjs:runTask():
             IF provider=claude → POST api.anthropic.com (claude-haiku-4-5-20251001)
             IF provider=openai → POST api.openai.com (gpt-4o-mini)
             IF provider=gemini → POST generativelanguage.googleapis.com
             IF provider=custom → POST configuredEndpoint
        4. SQLite INSERT into agent_executions, agent_messages, agent_logs
        5. setState(agentId, 'completed')    → broadcast agent:completed
        6. POST /internal/broadcast → all WS clients get agent:log events
```
