# Crypto Scalping — Design Spec

**Date:** 2026-06-04  
**Status:** Approved

---

## Problem / Need

Genesis HQ currently trades only prediction markets (Polymarket) with a 5-minute cycle and multi-day horizons. Adding crypto scalping allows agents to train on a much higher volume of trades (minutes vs days), accelerating the learning loop and the path to the GO/NO-GO verdict. Capital is shared ($10k paper total across both strategies).

---

## Outcome

A second autonomous trading loop runs every minute, scanning BTC/ETH/SOL/BNB prices from Binance's free public API, running the same Bull/Bear/Arbiter Claude Sonnet debate the system already uses for Polymarket, and executing paper trades with a 2:1 risk/reward ratio (target +1.5%, stop −0.75%). Positions are managed every minute. Lessons from crypto trades feed the same learning engine as Polymarket trades.

---

## Architecture

### New files (4 modules)

```
server/crypto/
  priceFeeder.mjs       — Binance public API, EMA9/EMA21, RSI14, price changes
  cryptoDebate.mjs      — Claude Sonnet debate adapted for LONG/SHORT decisions
  cryptoWorkflow.mjs    — SCAN→QUALIFY→DEBATE→SIZE→EXECUTE for crypto
  positionManager.mjs   — Check open crypto positions every minute, close on target/stop/timeout
```

### Modified files

- `server/agentRunner.mjs` — add 1-minute crypto loop alongside the 5-minute Polymarket loop
- `server/db/schema.sql` — add 3 columns to `trades` table: `asset_pair`, `exit_reason`, `trade_type`

### What is NOT changed

- `server/trading/treasury.mjs` — shared capital, same Kelly sizing, same drawdown pause
- `server/trading/riskManager.mjs` — same limits (max 5 open positions total across both strategies)
- `server/memory/learningEngine.mjs` — crypto trade lessons go into the same table
- `server/trading/analytics.mjs` — crypto trades count toward the Edge Scorecard verdict

---

## Module Specs

### 1. `server/crypto/priceFeeder.mjs`

Fetches from Binance public REST API (no API key required):
```
GET https://api.binance.com/api/v3/ticker/24hr?symbols=["BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT"]
GET https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=30
```

For each asset, computes and returns:
```js
{
  symbol: 'BTC',        // short name
  pair: 'BTCUSDT',      // Binance pair
  price: 67420.5,       // current price (USD)
  change1h: 0.42,       // % change in last 1h (from klines)
  change24h: 1.85,      // % 24h change (from ticker)
  volume24h: 28500000,  // USD volume last 24h
  ema9: 67350.2,        // EMA of last 9 one-minute closes
  ema21: 67100.8,       // EMA of last 21 one-minute closes
  rsi14: 58.3,          // RSI(14) from last 14 one-minute closes
  trend: 'bullish' | 'bearish' | 'neutral',  // ema9 > ema21 → bullish
}
```

EMA and RSI computed locally from klines data (no external library needed — pure math).

Error handling: 8-second timeout, returns `[]` on failure (never blocks the loop).

---

### 2. `server/crypto/cryptoDebate.mjs`

Calls Claude Sonnet with a system prompt adapted for crypto scalping decisions.

**System prompt (inline fallback):**
```
You are Genesis HQ's crypto scalping debate facilitator.
Generate a structured debate between three agents about whether to open a position:
- BULL: argues for entering LONG (price will rise). Cites technical evidence.
- BEAR: argues for entering SHORT or SKIP (price will fall or move is unclear). Identifies risks.
- ARBITER: weighs both sides, decides LONG, SHORT, or SKIP.

Rules:
- No emotional language. Price levels, indicators, and momentum only.
- Bull must cite at least 2 specific technical reasons (EMA alignment, RSI level, momentum).
- Bear must identify at least 1 specific risk (overbought/oversold, lack of volume, trend reversal).
- Arbiter must reference both sides before deciding.
- If Bull confidence < 0.62 OR Bear confidence > 0.55, ARBITER votes SKIP.
- Confidence = probability the trade hits its target before its stop-loss.
- When genuine edge exists (trend + RSI + volume aligned), you MUST TRADE. Excessive caution loses money.
- SKIP only when: (a) indicators are conflicting, (b) volume is weak, or (c) a hard rule is violated.
```

**Input:** Asset context from `priceFeeder` + recent crypto lessons from `learningEngine.getDecisionContext('crypto')`.

**Output JSON** (same shape as debateRoom.mjs):
```json
{
  "action": "TRADE",
  "outcome": "LONG",
  "confidence": 0.68,
  "bull": { "evidence": ["EMA9 > EMA21 bullish cross", "RSI 58 neutral-rising"] },
  "bear": { "risks": ["Resistance at $67,500"] },
  "arbiterSummary": "Bullish momentum confirmed, entering LONG with tight stop."
}
```

Model: `claude-sonnet-4-6`, `max_tokens: 800`, 20-second timeout.  
Fallback: if Claude fails, returns `{ action: "SKIP", skipReason: "Claude unavailable" }`.

---

### 3. `server/crypto/cryptoWorkflow.mjs`

Exports `runCryptoTradingCycle()` and `manageCryptoPositions()`.

**`runCryptoTradingCycle()`:**

```
SCAN     → priceFeeder.getAssetContext() → 4 assets
QUALIFY  → filter: abs(change1h) > 0.3% AND volume24h > $1M
           (ensures asset is moving and liquid enough to scalp)
DEBATE   → cryptoDebate.runCryptoDebate(asset, lessons)
           Skip if action !== 'TRADE'
SIZE     → kellySize(confidence, 0.5) capped at 5% of available capital
           (price ~0.5 because scalp target is ~50/50 from Kelly perspective;
            actual edge comes from the debate confidence)
EXECUTE  → executeCryptoTrade(asset, side, entryPrice, size)
           Saves to trades table with asset_pair, target_price, stop_price
```

One trade per cycle (same discipline as Polymarket loop).

**`manageCryptoPositions()`:**

Called every minute. For each open crypto trade:
1. Fetch current price from Binance
2. If LONG: check if `currentPrice >= target_price` (WIN) or `currentPrice <= stop_price` (LOSS)
3. If SHORT: check if `currentPrice <= target_price` (WIN) or `currentPrice >= stop_price` (LOSS)
4. If timeout (opened_at > 4 hours ago): close at current price (avoids holding overnight)
5. On close: call `settleTradeCapital(capitalUsed, pnl)` and `analyzeClosedTrade(trade)`

---

### 4. `server/crypto/positionManager.mjs`  
*(thin wrapper — calls `manageCryptoPositions()` from cryptoWorkflow, extracted for clarity)*

---

### DB Schema additions (`server/db/schema.sql`)

Add to `CREATE TABLE trades`:
```sql
asset_pair   TEXT,    -- 'BTCUSDT', 'ETHUSDT', etc. NULL for prediction markets
exit_reason  TEXT,    -- 'target_hit' | 'stop_loss' | 'timeout' | 'market_resolved'
trade_type   TEXT DEFAULT 'prediction'  -- 'prediction' | 'crypto_scalp'
```

Also add:
```sql
target_price  REAL,  -- price level to take profit
stop_price    REAL,  -- price level to stop loss
```

Migration: `ALTER TABLE trades ADD COLUMN` for each (idempotent via `IF NOT EXISTS` check or try/catch).

---

### `server/agentRunner.mjs` additions

```js
import { runCryptoTradingCycle, manageCryptoPositions } from './crypto/cryptoWorkflow.mjs';

// Crypto loop: every 1 minute
// manageCryptoPositions runs first (check open trades), then maybe open a new one
const CRYPTO_INTERVAL_MS = 60 * 1000;

if (!ONCE) {
  setInterval(async () => {
    try {
      await manageCryptoPositions();          // close hits first
      if (isDeptActive('crypto_scalping')) {
        const result = await runCryptoTradingCycle();
        if (result.executed) {
          console.log(`[cryptoScalper] Trade executed: ${result.side} ${result.symbol} @ $${result.entryPrice}`);
        }
      }
    } catch (err) {
      console.error('[cryptoScalper] Error:', err.message);
    }
  }, CRYPTO_INTERVAL_MS);
}
```

---

## Risk Management

| Rule | Value | Rationale |
|---|---|---|
| Target per trade | +1.5% | Scalp target, realistic in 1m timeframe |
| Stop-loss per trade | −0.75% | 2:1 reward/risk ratio |
| Max position size | 5% of capital | Same as Polymarket (Constitution rule) |
| Max open positions | 5 total (shared) | Unchanged — prevents overexposure |
| Position timeout | 4 hours | Avoid holding overnight risk |
| Qualify filter | abs(change1h) > 0.3% | Only trade when asset is moving |
| Qualify filter | volume24h > $1M | Ensure liquidity for fills |
| Min confidence | 0.62 | Slightly lower than Polymarket (faster markets) |

---

## Learning Loop

Crypto trade lessons flow into the same `lessons` table with `category = 'crypto'`.  
`getDecisionContext('crypto')` filters lessons by category when building debate context.  
The Edge Scorecard counts crypto trades alongside Polymarket trades.

---

## Not In Scope

- Real order execution on Binance (API keys, HMAC signing, order management) — paper only until GO verdict
- Leverage / margin — all positions are 1x spot equivalent
- Multiple timeframes (only 1-minute candles for now)
- Websocket streaming (polling every minute is sufficient for paper trading)
- Short selling mechanics (tracked as paper SHORT; no actual borrowing)
