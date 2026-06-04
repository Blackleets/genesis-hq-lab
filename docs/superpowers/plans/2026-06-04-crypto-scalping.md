# Crypto Scalping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 1-minute crypto scalping loop (BTC/ETH/SOL/BNB) that uses the same Claude Sonnet Bull/Bear/Arbiter debate as Polymarket, paper-trades with real Binance prices, and shares the $10k capital with Polymarket.

**Architecture:** Four new modules under `server/crypto/` handle prices, debate, execution and position management. The existing agentRunner gets a second 1-minute `setInterval` for crypto. DB schema gets 5 new columns on the `trades` table. All capital, risk limits, and learning loops are reused unchanged.

**Tech Stack:** Node.js 22 ESM, Binance public REST API (no key), better-sqlite3 (sync), Claude Sonnet 4.6 (same as debates), `node:test` for unit tests.

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| **ADD columns** | `server/db/schema.sql` | `asset_pair`, `trade_type`, `target_price`, `stop_price`, `exit_reason` |
| **MODIFY** | `server/db/database.mjs:47` | Swallow "duplicate column name" in migration (same as "already exists") |
| **CREATE** | `server/crypto/priceFeeder.mjs` | Binance 24h ticker + 1m klines → EMA9/21, RSI14, trend |
| **CREATE** | `server/crypto/cryptoDebate.mjs` | Claude Sonnet debate adapted for LONG/SHORT crypto decisions |
| **CREATE** | `server/crypto/cryptoExecution.mjs` | Paper fill: saves crypto trade with target/stop prices |
| **CREATE** | `server/crypto/positionManager.mjs` | Every minute: check open crypto trades vs live price, close on target/stop/timeout |
| **CREATE** | `server/crypto/cryptoWorkflow.mjs` | SCAN→QUALIFY→DEBATE→SIZE→EXECUTE orchestration |
| **MODIFY** | `server/agentRunner.mjs` | Add 1-minute crypto interval |
| **CREATE** | `server/tests/priceFeeder.test.mjs` | Unit tests for EMA/RSI calculations |
| **CREATE** | `server/tests/cryptoExecution.test.mjs` | Unit tests for PnL computation |

---

## Task 1: DB schema migration — add 5 columns to `trades`

**Files:**
- Modify: `server/db/schema.sql`
- Modify: `server/db/database.mjs`

- [ ] **Step 1: Add ALTER TABLE statements to schema.sql**

Append at the end of `server/db/schema.sql` (after the last statement):

```sql
-- ─── Crypto scalping columns (added 2026-06-04) ──────────────────────────────
-- These are NULL for prediction market trades; populated only for crypto_scalp trades.
ALTER TABLE trades ADD COLUMN asset_pair   TEXT;
ALTER TABLE trades ADD COLUMN trade_type   TEXT DEFAULT 'prediction';
ALTER TABLE trades ADD COLUMN target_price REAL;
ALTER TABLE trades ADD COLUMN stop_price   REAL;
ALTER TABLE trades ADD COLUMN exit_reason  TEXT;
```

- [ ] **Step 2: Update database.mjs migration to swallow "duplicate column name" errors**

In `server/db/database.mjs`, find the inner catch in `migrate()` (around line 47):

```js
    } catch (e) {
      // Ignore "already exists" errors from IF NOT EXISTS
      if (!e.message.includes('already exists')) throw e;
    }
```

Replace with:

```js
    } catch (e) {
      // Ignore idempotent migration errors
      if (!e.message.includes('already exists') && !e.message.includes('duplicate column name')) throw e;
    }
```

- [ ] **Step 3: Verify migration runs cleanly**

```bash
node -e "import('./server/db/database.mjs').then(() => console.log('migration OK')).catch(e => console.error('FAIL:', e.message))"
```

Expected: `migration OK`

- [ ] **Step 4: Verify columns exist**

```bash
node -e "import('./server/db/database.mjs').then(m => { const cols = m.default.prepare('PRAGMA table_info(trades)').all().map(c=>c.name); console.log('has asset_pair:', cols.includes('asset_pair')); console.log('has trade_type:', cols.includes('trade_type')); console.log('has target_price:', cols.includes('target_price')); console.log('has stop_price:', cols.includes('stop_price')); console.log('has exit_reason:', cols.includes('exit_reason')); })"
```

Expected: all 5 lines print `true`.

- [ ] **Step 5: Commit**

```bash
git add server/db/schema.sql server/db/database.mjs
git commit -m "feat(db): add 5 crypto_scalp columns to trades table"
```

---

## Task 2: `server/crypto/priceFeeder.mjs` — Binance prices + indicators

**Files:**
- Create: `server/crypto/priceFeeder.mjs`
- Create: `server/tests/priceFeeder.test.mjs`

- [ ] **Step 1: Write failing tests first**

Create `server/tests/priceFeeder.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeEma, computeRsi, buildAssetContext } from '../crypto/priceFeeder.mjs';

test('computeEma — single value returns that value', () => {
  assert.strictEqual(computeEma([100], 9), 100);
});

test('computeEma — rising series, EMA9 < EMA21 for short series', () => {
  const closes = Array.from({ length: 25 }, (_, i) => 100 + i); // 100..124
  const e9  = computeEma(closes, 9);
  const e21 = computeEma(closes, 21);
  assert.ok(e9 > e21, `EMA9 ${e9} should be > EMA21 ${e21} for rising series`);
});

test('computeRsi — all gains returns near 100', () => {
  const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
  const rsi = computeRsi(closes, 14);
  assert.ok(rsi > 90, `RSI should be >90 for all-gain series, got ${rsi}`);
});

test('computeRsi — all losses returns near 0', () => {
  const closes = Array.from({ length: 20 }, (_, i) => 120 - i);
  const rsi = computeRsi(closes, 14);
  assert.ok(rsi < 10, `RSI should be <10 for all-loss series, got ${rsi}`);
});

test('computeRsi — flat series returns 50', () => {
  const closes = Array.from({ length: 20 }, () => 100);
  const rsi = computeRsi(closes, 14);
  assert.strictEqual(rsi, 50);
});

test('buildAssetContext — returns correct structure from mock klines', () => {
  // 30 klines: [openTime, open, high, low, close, volume, ...]
  const klines = Array.from({ length: 30 }, (_, i) => [
    Date.now() - (30 - i) * 60000,
    String(100 + i),      // open
    String(101 + i),      // high
    String(99 + i),       // low
    String(100.5 + i),    // close
    String(1000),         // volume
    0, 0, 0, 0, 0, 0,
  ]);
  const ticker = { lastPrice: '129.5', priceChangePercent: '1.5', quoteVolume: '5000000' };
  const ctx = buildAssetContext('BTC', 'BTCUSDT', klines, ticker);
  assert.strictEqual(ctx.symbol, 'BTC');
  assert.strictEqual(ctx.pair, 'BTCUSDT');
  assert.ok(typeof ctx.price === 'number');
  assert.ok(typeof ctx.ema9 === 'number');
  assert.ok(typeof ctx.ema21 === 'number');
  assert.ok(typeof ctx.rsi14 === 'number');
  assert.ok(['bullish', 'bearish', 'neutral'].includes(ctx.trend));
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
node --test server/tests/priceFeeder.test.mjs
```

Expected: `Error: Cannot find module '../crypto/priceFeeder.mjs'`

- [ ] **Step 3: Create `server/crypto/priceFeeder.mjs`**

```js
// priceFeeder.mjs — Binance public REST API price feed for crypto scalping.
// No API key required. Returns price context with EMA9/EMA21 and RSI14.
// Pure math — no external libraries.

const BINANCE_BASE = 'https://api.binance.com/api/v3';
const ASSETS = [
  { symbol: 'BTC', pair: 'BTCUSDT' },
  { symbol: 'ETH', pair: 'ETHUSDT' },
  { symbol: 'SOL', pair: 'SOLUSDT' },
  { symbol: 'BNB', pair: 'BNBUSDT' },
];

// ─── EMA (exponential moving average) ─────────────────────────────────────────

export function computeEma(values, period) {
  if (values.length === 0) return 0;
  if (values.length === 1) return values[0];
  const k = 2 / (period + 1);
  let result = values[0];
  for (let i = 1; i < values.length; i++) {
    result = values[i] * k + result * (1 - k);
  }
  return result;
}

// ─── RSI(14) ──────────────────────────────────────────────────────────────────

export function computeRsi(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return Math.round((100 - 100 / (1 + rs)) * 100) / 100;
}

// ─── Build asset context from raw API data ────────────────────────────────────

export function buildAssetContext(symbol, pair, klines, ticker) {
  const closes = klines.map(k => parseFloat(k[4]));
  const ema9   = computeEma(closes, 9);
  const ema21  = computeEma(closes, 21);
  const rsi14  = computeRsi(closes, 14);
  const price  = parseFloat(ticker.lastPrice);
  const change1h = closes.length >= 60
    ? ((closes[closes.length - 1] - closes[closes.length - 60]) / closes[closes.length - 60]) * 100
    : parseFloat(ticker.priceChangePercent ?? 0);

  const trend = ema9 > ema21 * 1.001 ? 'bullish'
              : ema9 < ema21 * 0.999 ? 'bearish'
              : 'neutral';

  return {
    symbol,
    pair,
    price,
    change1h:  Math.round(change1h * 100) / 100,
    change24h: parseFloat(ticker.priceChangePercent ?? 0),
    volume24h: parseFloat(ticker.quoteVolume ?? 0),
    ema9:      Math.round(ema9 * 100) / 100,
    ema21:     Math.round(ema21 * 100) / 100,
    rsi14:     rsi14,
    trend,
  };
}

// ─── Fetch all 4 assets from Binance ─────────────────────────────────────────

export async function getAssetContexts() {
  try {
    const pairs = ASSETS.map(a => `"${a.pair}"`).join(',');

    // Fetch 24h tickers + 1m klines for each pair in parallel
    const [tickerRes, ...klinesRes] = await Promise.all([
      fetch(`${BINANCE_BASE}/ticker/24hr?symbols=[${pairs}]`, { signal: AbortSignal.timeout(8000) }),
      ...ASSETS.map(a => fetch(`${BINANCE_BASE}/klines?symbol=${a.pair}&interval=1m&limit=30`, { signal: AbortSignal.timeout(8000) })),
    ]);

    if (!tickerRes.ok) throw new Error(`Binance ticker HTTP ${tickerRes.status}`);
    const tickers = await tickerRes.json(); // array of ticker objects

    const klinesData = await Promise.all(klinesRes.map(async (r, i) => {
      if (!r.ok) return null;
      return r.json().catch(() => null);
    }));

    const contexts = [];
    for (let i = 0; i < ASSETS.length; i++) {
      const { symbol, pair } = ASSETS[i];
      const ticker = tickers.find(t => t.symbol === pair);
      const klines = klinesData[i];
      if (!ticker || !klines || klines.length < 22) continue;
      contexts.push(buildAssetContext(symbol, pair, klines, ticker));
    }

    console.log(`[priceFeeder] ${contexts.length} assets fetched: ${contexts.map(c => `${c.symbol}@$${c.price}`).join(', ')}`);
    return contexts;

  } catch (err) {
    console.warn('[priceFeeder] Error fetching Binance data:', err.message);
    return [];
  }
}

// ─── Fetch current price for a single pair (used by positionManager) ─────────

export async function getCurrentPrice(pair) {
  try {
    const res = await fetch(`${BINANCE_BASE}/ticker/price?symbol=${pair}`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json();
    return parseFloat(data.price);
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run tests — confirm all pass**

```bash
node --test server/tests/priceFeeder.test.mjs
```

Expected: 6 tests pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add server/crypto/priceFeeder.mjs server/tests/priceFeeder.test.mjs
git commit -m "feat(crypto): add priceFeeder — Binance API, EMA9/21, RSI14, with unit tests"
```

---

## Task 3: `server/crypto/cryptoDebate.mjs` — Claude Sonnet debate for LONG/SHORT

**Files:**
- Create: `server/crypto/cryptoDebate.mjs`

Context: mirrors `server/trading/debateRoom.mjs` but adapted for crypto. Input is an asset context object from priceFeeder; output is `{ action, outcome, confidence, bull, bear, arbiterSummary }` — same shape as `runDebate()` in debateRoom.

- [ ] **Step 1: Create `server/crypto/cryptoDebate.mjs`**

```js
// cryptoDebate.mjs — Claude Sonnet Bull/Bear/Arbiter debate for crypto scalping.
// Mirrors debateRoom.mjs but for LONG/SHORT decisions on BTC/ETH/SOL/BNB.
// Same output shape as runDebate() so the rest of the pipeline is reusable.

const CLAUDE_API = 'https://api.anthropic.com/v1/messages';

const CRYPTO_DEBATE_SYSTEM = `You are Genesis HQ's crypto scalping debate facilitator.
Generate a structured debate between three agents about whether to open a position:
- BULL: argues for entering LONG (price will rise shortly). Cites specific technical evidence.
- BEAR: argues against or for SHORT/SKIP (price unclear or will drop). Identifies specific risk.
- ARBITER: weighs both sides, makes the final call.

Rules:
- No emotional language. Price levels, indicators, and momentum only.
- Bull must cite at least 2 specific technical reasons (EMA alignment, RSI level, price momentum).
- Bear must identify at least 1 specific risk (overbought/oversold, weak volume, trend reversal signal).
- Arbiter must reference both sides before deciding.
- If Bull confidence < 0.62 OR Bear confidence > 0.55, ARBITER votes SKIP.
- Confidence = probability this position hits its +1.5% target before its -0.75% stop-loss.
- When trend + RSI + volume are aligned, you MUST TRADE. Excessive caution is a losing strategy.
- SKIP only when: (a) indicators are conflicting, (b) volume is weak, or (c) a hard rule is violated.`;

const JSON_DIRECTIVE = `\n\nRespond ONLY with valid JSON. No markdown. No explanation outside the JSON.`;

// ─── Fallback when Claude is unavailable ──────────────────────────────────────

function fallbackCryptoDebate(asset) {
  // Simple rule: RSI 40-55 + bullish EMA trend → LONG; RSI 45-60 + bearish → SHORT; else SKIP
  const bullishSetup = asset.trend === 'bullish' && asset.rsi14 >= 40 && asset.rsi14 <= 60;
  const bearishSetup = asset.trend === 'bearish' && asset.rsi14 >= 40 && asset.rsi14 <= 60;

  if (bullishSetup) {
    return { action: 'TRADE', outcome: 'LONG', confidence: 0.63,
      bull: { evidence: ['EMA9 > EMA21 bullish', `RSI ${asset.rsi14} neutral-rising`] },
      bear: { risks: ['Rule-based fallback — limited signal quality'] },
      arbiterSummary: 'Rule-based: bullish EMA + neutral RSI → LONG' };
  }
  if (bearishSetup) {
    return { action: 'TRADE', outcome: 'SHORT', confidence: 0.63,
      bull: { evidence: ['Rule-based fallback'] },
      bear: { risks: ['EMA9 < EMA21 bearish', `RSI ${asset.rsi14} neutral-falling`] },
      arbiterSummary: 'Rule-based: bearish EMA + neutral RSI → SHORT' };
  }
  return { action: 'SKIP', skipReason: 'Rule-based fallback: indicators not aligned', confidence: 0 };
}

// ─── Run the crypto debate ────────────────────────────────────────────────────

export async function runCryptoDebate(asset, contextLessons = []) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return fallbackCryptoDebate(asset);

  const lessonsCtx = contextLessons.length > 0
    ? `\nPrevious crypto lessons:\n${contextLessons.slice(0, 3).map(l => `- ${l.lesson_text || l.lesson}`).join('\n')}`
    : '';

  const userPrompt = `ASSET TO DEBATE:
Symbol: ${asset.symbol} (${asset.pair})
Current price: $${asset.price}
EMA9: $${asset.ema9} | EMA21: $${asset.ema21} | Trend: ${asset.trend.toUpperCase()}
RSI(14): ${asset.rsi14}
1h change: ${asset.change1h > 0 ? '+' : ''}${asset.change1h}%
24h change: ${asset.change24h > 0 ? '+' : ''}${asset.change24h}%
24h volume: $${Math.round(asset.volume24h).toLocaleString()}
${lessonsCtx}

Target if LONG: $${(asset.price * 1.015).toFixed(2)} (+1.5%) | Stop: $${(asset.price * 0.9925).toFixed(2)} (-0.75%)
Target if SHORT: $${(asset.price * 0.985).toFixed(2)} (-1.5%) | Stop: $${(asset.price * 1.0075).toFixed(2)} (+0.75%)

Generate the full debate and decision. Respond with:
{
  "bull": {
    "thesis": "1-2 sentence argument for LONG",
    "evidence": ["specific technical reason 1", "specific technical reason 2"],
    "confidence": 0.XX
  },
  "bear": {
    "thesis": "1-2 sentence argument for SHORT or SKIP",
    "risks": ["specific risk or counter-signal"],
    "confidence": 0.XX
  },
  "arbiter": {
    "summary": "1-2 sentence synthesis",
    "action": "TRADE | SKIP",
    "outcome": "LONG | SHORT",
    "final_confidence": 0.XX,
    "skip_reason": "only if action=SKIP"
  }
}`;

  try {
    const res = await fetch(CLAUDE_API, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 800,
        system: CRYPTO_DEBATE_SYSTEM + JSON_DIRECTIVE,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text().then(t => t.slice(0, 200))}`);

    const data = await res.json();
    const raw  = data.content?.[0]?.text ?? '';
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in response');
    const debate = JSON.parse(match[0]);

    return enforceRules(debate, asset);

  } catch (err) {
    console.warn(`[cryptoDebate] Error for ${asset.symbol}:`, err.message);
    return fallbackCryptoDebate(asset);
  }
}

// ─── Enforce hard rules on debate output ─────────────────────────────────────

function enforceRules(debate, asset) {
  const arb = debate.arbiter;
  let action = arb.action ?? 'SKIP';
  let skipReason = arb.skip_reason;

  if ((arb.final_confidence ?? 0) < 0.62) {
    action = 'SKIP';
    skipReason = `Confidence ${arb.final_confidence} below 0.62 minimum`;
  }
  if ((debate.bear?.confidence ?? 0) > 0.55) {
    action = 'SKIP';
    skipReason = `Bear confidence ${debate.bear.confidence} too high`;
  }
  if (asset.volume24h < 1_000_000) {
    action = 'SKIP';
    skipReason = `Volume $${Math.round(asset.volume24h).toLocaleString()} below $1M minimum`;
  }

  return {
    action,
    skipReason: action === 'SKIP' ? (skipReason ?? 'Debate inconclusive') : null,
    outcome: arb.outcome ?? 'LONG',
    confidence: arb.final_confidence ?? 0.5,
    bull:  debate.bull,
    bear:  debate.bear,
    arbiterSummary: arb.summary,
  };
}
```

- [ ] **Step 2: Smoke test — module loads cleanly**

```bash
node -e "import('./server/crypto/cryptoDebate.mjs').then(m => console.log('exports:', Object.keys(m))).catch(e => console.error('FAIL:', e.message))"
```

Expected: `exports: [ 'runCryptoDebate' ]`

- [ ] **Step 3: Commit**

```bash
git add server/crypto/cryptoDebate.mjs
git commit -m "feat(crypto): add cryptoDebate — Claude Sonnet LONG/SHORT debate for BTC/ETH/SOL/BNB"
```

---

## Task 4: `server/crypto/cryptoExecution.mjs` — paper fill with target/stop

**Files:**
- Create: `server/crypto/cryptoExecution.mjs`
- Create: `server/tests/cryptoExecution.test.mjs`

- [ ] **Step 1: Write failing tests first**

Create `server/tests/cryptoExecution.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCryptoTargets, computeCryptoPnl } from '../crypto/cryptoExecution.mjs';

test('computeCryptoTargets — LONG: target is +1.5%, stop is -0.75%', () => {
  const { targetPrice, stopPrice } = computeCryptoTargets('LONG', 100);
  assert.ok(Math.abs(targetPrice - 101.5) < 0.01, `target should be ~101.5, got ${targetPrice}`);
  assert.ok(Math.abs(stopPrice - 99.25) < 0.01, `stop should be ~99.25, got ${stopPrice}`);
});

test('computeCryptoTargets — SHORT: target is -1.5%, stop is +0.75%', () => {
  const { targetPrice, stopPrice } = computeCryptoTargets('SHORT', 100);
  assert.ok(Math.abs(targetPrice - 98.5) < 0.01, `target should be ~98.5, got ${targetPrice}`);
  assert.ok(Math.abs(stopPrice - 100.75) < 0.01, `stop should be ~100.75, got ${stopPrice}`);
});

test('computeCryptoPnl — LONG WIN: exit above target', () => {
  const pnl = computeCryptoPnl('LONG', 100, 101.5, 0.5); // 0.5 shares
  assert.ok(Math.abs(pnl - 0.75) < 0.001, `LONG win PnL should be ~0.75, got ${pnl}`);
});

test('computeCryptoPnl — LONG LOSS: exit below stop', () => {
  const pnl = computeCryptoPnl('LONG', 100, 99.25, 0.5);
  assert.ok(Math.abs(pnl - (-0.375)) < 0.001, `LONG loss PnL should be ~-0.375, got ${pnl}`);
});

test('computeCryptoPnl — SHORT WIN: exit below target', () => {
  const pnl = computeCryptoPnl('SHORT', 100, 98.5, 0.5);
  assert.ok(Math.abs(pnl - 0.75) < 0.001, `SHORT win PnL should be ~0.75, got ${pnl}`);
});

test('computeCryptoPnl — SHORT LOSS: exit above stop', () => {
  const pnl = computeCryptoPnl('SHORT', 100, 100.75, 0.5);
  assert.ok(Math.abs(pnl - (-0.375)) < 0.001, `SHORT loss PnL should be ~-0.375, got ${pnl}`);
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
node --test server/tests/cryptoExecution.test.mjs
```

Expected: `Error: Cannot find module '../crypto/cryptoExecution.mjs'`

- [ ] **Step 3: Create `server/crypto/cryptoExecution.mjs`**

```js
// cryptoExecution.mjs — paper fill for crypto scalp trades.
// Saves a trade to the DB with target_price, stop_price, trade_type=crypto_scalp.
// No exchange connection — paper only. Uses the shared treasury for capital.

import db, { tx } from '../db/database.mjs';
import { nanoid } from '../utils.mjs';

const TARGET_PCT = 0.015;   // +1.5% take-profit
const STOP_PCT   = 0.0075;  // −0.75% stop-loss

// ─── Pure helpers (exported for tests) ───────────────────────────────────────

export function computeCryptoTargets(side, entryPrice) {
  if (side === 'LONG') {
    return {
      targetPrice: Math.round(entryPrice * (1 + TARGET_PCT) * 100) / 100,
      stopPrice:   Math.round(entryPrice * (1 - STOP_PCT)   * 100) / 100,
    };
  }
  // SHORT
  return {
    targetPrice: Math.round(entryPrice * (1 - TARGET_PCT) * 100) / 100,
    stopPrice:   Math.round(entryPrice * (1 + STOP_PCT)   * 100) / 100,
  };
}

export function computeCryptoPnl(side, entryPrice, exitPrice, shares) {
  if (side === 'LONG') return Math.round((exitPrice - entryPrice) * shares * 100) / 100;
  return Math.round((entryPrice - exitPrice) * shares * 100) / 100; // SHORT
}

// ─── Paper fill ───────────────────────────────────────────────────────────────

export function executeCryptoPaperTrade({ asset, side, entryPrice, capitalUsed, confidence, reason, evidence }) {
  const shares = Math.floor((capitalUsed / entryPrice) * 10000) / 10000; // floor to 4 decimals
  const effectiveCapital = Math.round(shares * entryPrice * 100) / 100;
  const { targetPrice, stopPrice } = computeCryptoTargets(side, entryPrice);
  const id = `crypto-${nanoid()}`;

  tx(() => {
    db.prepare(`
      INSERT INTO trades
        (id, agent_id, market_id, market_source, market_question, market_category,
         outcome, entry_price, shares, capital_used, confidence, reason, evidence,
         status, opened_at, asset_pair, trade_type, target_price, stop_price)
      VALUES
        (@id, @agent_id, @market_id, @market_source, @market_question, @market_category,
         @outcome, @entry_price, @shares, @capital_used, @confidence, @reason, @evidence,
         'open', @opened_at, @asset_pair, 'crypto_scalp', @target_price, @stop_price)
    `).run({
      id,
      agent_id:        'crypto-scalper-1',
      market_id:       `${asset.pair}-${Date.now()}`,
      market_source:   'binance',
      market_question: `${side} ${asset.symbol} @ $${entryPrice}`,
      market_category: 'crypto',
      outcome:         side,        // 'LONG' or 'SHORT'
      entry_price:     entryPrice,
      shares,
      capital_used:    effectiveCapital,
      confidence,
      reason,
      evidence:        JSON.stringify(evidence ?? []),
      opened_at:       new Date().toISOString(),
      asset_pair:      asset.pair,
      target_price:    targetPrice,
      stop_price:      stopPrice,
    });
  });

  console.log(`[cryptoExecution] Paper ${side} ${asset.symbol} @ $${entryPrice} | target $${targetPrice} | stop $${stopPrice} | capital $${effectiveCapital.toFixed(2)}`);
  return { executed: true, tradeId: id, mode: 'paper', side, entryPrice, targetPrice, stopPrice, shares, capitalUsed: effectiveCapital };
}

// ─── Close a crypto trade (called by positionManager) ────────────────────────

export function closeCryptoTrade(tradeId, exitPrice, exitReason) {
  const trade = db.prepare('SELECT * FROM trades WHERE id = ?').get(tradeId);
  if (!trade) return null;

  const pnl = computeCryptoPnl(trade.outcome, trade.entry_price, exitPrice, trade.shares);
  const closedAt = new Date().toISOString();

  tx(() => {
    db.prepare(`
      UPDATE trades
      SET status = 'closed', exit_price = ?, pnl = ?, closed_at = ?,
          resolved_outcome = ?, exit_reason = ?
      WHERE id = ?
    `).run(exitPrice, pnl, closedAt, pnl >= 0 ? 'WIN' : 'LOSS', exitReason, tradeId);
  });

  console.log(`[cryptoExecution] Closed ${trade.outcome} ${trade.asset_pair ?? ''} @ $${exitPrice} | reason: ${exitReason} | PnL: $${pnl.toFixed(2)}`);
  return { ...trade, exitPrice, pnl, closedAt, exitReason };
}
```

- [ ] **Step 4: Run tests — confirm all pass**

```bash
node --test server/tests/cryptoExecution.test.mjs
```

Expected: 6 tests pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add server/crypto/cryptoExecution.mjs server/tests/cryptoExecution.test.mjs
git commit -m "feat(crypto): add cryptoExecution — paper fill with target/stop and PnL, with unit tests"
```

---

## Task 5: `server/crypto/positionManager.mjs` — manage open positions

**Files:**
- Create: `server/crypto/positionManager.mjs`

This runs every minute. Fetches current Binance price for each open crypto trade, closes on target/stop/timeout (4h).

- [ ] **Step 1: Create `server/crypto/positionManager.mjs`**

```js
// positionManager.mjs — checks open crypto_scalp trades every minute.
// Closes positions that hit their target_price, stop_price, or 4h timeout.
// Calls settleTradeCapital() and analyzeClosedTrade() after each close.

import db from '../db/database.mjs';
import { getCurrentPrice } from './priceFeeder.mjs';
import { closeCryptoTrade } from './cryptoExecution.mjs';
import { settleTradeCapital } from '../trading/treasury.mjs';
import { analyzeClosedTrade } from '../memory/learningEngine.mjs';

const TIMEOUT_HOURS = 4;

export async function manageCryptoPositions() {
  const openTrades = db.prepare(`
    SELECT * FROM trades
    WHERE status = 'open' AND trade_type = 'crypto_scalp'
    ORDER BY opened_at ASC
  `).all();

  if (openTrades.length === 0) return { checked: 0, closed: 0 };

  let closed = 0;

  for (const trade of openTrades) {
    const currentPrice = await getCurrentPrice(trade.asset_pair);
    if (!currentPrice) continue; // API unavailable — keep position open

    const openedAt   = new Date(trade.opened_at);
    const ageHours   = (Date.now() - openedAt.getTime()) / (1000 * 60 * 60);
    const isLong     = trade.outcome === 'LONG';

    // Determine exit condition
    let exitReason = null;
    if (ageHours >= TIMEOUT_HOURS) {
      exitReason = 'timeout';
    } else if (isLong) {
      if (currentPrice >= trade.target_price) exitReason = 'target_hit';
      else if (currentPrice <= trade.stop_price) exitReason = 'stop_loss';
    } else { // SHORT
      if (currentPrice <= trade.target_price) exitReason = 'target_hit';
      else if (currentPrice >= trade.stop_price) exitReason = 'stop_loss';
    }

    if (!exitReason) continue; // still open

    const closedTrade = closeCryptoTrade(trade.id, currentPrice, exitReason);
    if (!closedTrade) continue;
    closed++;

    // Return capital to treasury
    settleTradeCapital(trade.capital_used, closedTrade.pnl ?? 0);

    // Generate lesson from this trade
    try {
      await analyzeClosedTrade(closedTrade);
    } catch { /* learning is best-effort, never blocks */ }

    // Brief pause between Claude lesson-generation calls
    await new Promise(r => setTimeout(r, 300));
  }

  if (closed > 0) {
    console.log(`[positionManager] Closed ${closed} crypto position(s)`);
  }

  return { checked: openTrades.length, closed };
}
```

- [ ] **Step 2: Smoke test — module loads cleanly**

```bash
node -e "import('./server/crypto/positionManager.mjs').then(m => console.log('exports:', Object.keys(m))).catch(e => console.error('FAIL:', e.message))"
```

Expected: `exports: [ 'manageCryptoPositions' ]`

- [ ] **Step 3: Commit**

```bash
git add server/crypto/positionManager.mjs
git commit -m "feat(crypto): add positionManager — close on target/stop/timeout every minute"
```

---

## Task 6: `server/crypto/cryptoWorkflow.mjs` — full SCAN→QUALIFY→DEBATE→SIZE→EXECUTE

**Files:**
- Create: `server/crypto/cryptoWorkflow.mjs`

Reuses `kellySize` from treasury, `reserveCapital` from treasury, `preTradeCheck` from riskManager.

- [ ] **Step 1: Create `server/crypto/cryptoWorkflow.mjs`**

```js
// cryptoWorkflow.mjs — orchestrates the 1-minute crypto scalping cycle.
// SCAN → QUALIFY → DEBATE → SIZE → EXECUTE
// Reuses the shared treasury (same $10k, same risk limits) as Polymarket.

import { getAssetContexts } from './priceFeeder.mjs';
import { runCryptoDebate }  from './cryptoDebate.mjs';
import { executeCryptoPaperTrade } from './cryptoExecution.mjs';
import { manageCryptoPositions } from './positionManager.mjs';
import { kellySize, reserveCapital } from '../trading/treasury.mjs';
import { preTradeCheck } from '../trading/riskManager.mjs';
import { getDecisionContext } from '../memory/learningEngine.mjs';

export { manageCryptoPositions };

// ─── QUALIFY: only trade assets that are moving with sufficient volume ─────────

function qualifyAssets(assets) {
  return assets.filter(a =>
    Math.abs(a.change1h) >= 0.3 &&     // moving at least 0.3% in last hour
    a.volume24h >= 1_000_000            // at least $1M daily volume
  );
}

// ─── MAIN CYCLE ───────────────────────────────────────────────────────────────

export async function runCryptoTradingCycle() {
  const results = { scanned: 0, qualified: 0, debated: 0, executed: 0, tradeId: null };

  // 1. SCAN
  const assets = await getAssetContexts();
  results.scanned = assets.length;
  if (assets.length === 0) return results;

  // 2. QUALIFY
  const qualified = qualifyAssets(assets);
  results.qualified = qualified.length;
  if (qualified.length === 0) return results;

  // Fetch crypto-specific lessons for debate context
  const ctx = getDecisionContext('crypto', 0, 1);

  // 3. Try each qualifying asset until one executes
  for (const asset of qualified) {
    // DEBATE
    const debate = await runCryptoDebate(asset, ctx.lessons);
    results.debated++;

    if (debate.action !== 'TRADE') {
      console.log(`[cryptoWorkflow] SKIP ${asset.symbol}: ${debate.skipReason}`);
      continue;
    }

    const side = debate.outcome; // 'LONG' or 'SHORT'
    console.log(`[cryptoWorkflow] DEBATE: ${side} ${asset.symbol} @ $${asset.price} (conf ${(debate.confidence * 100).toFixed(0)}%)`);

    // SIZE — use Kelly sizing; entryPrice ~0.5 so Kelly treats it like a 50/50 with edge from confidence
    const kellySizing = kellySize(debate.confidence, 0.5);
    if (kellySizing.skip) {
      console.log(`[cryptoWorkflow] SIZE skip: ${kellySizing.reason}`);
      continue;
    }

    // Pre-trade risk check (uses shared risk limits — max 5 open, max 5% per trade, etc.)
    const proposal = {
      marketId:       `${asset.pair}-${Date.now()}`,
      marketSource:   'binance',
      marketQuestion: `${side} ${asset.symbol} @ $${asset.price}`,
      marketCategory: 'crypto',
      outcome:        side,
      yesPrice:       0.5,
      noPrice:        0.5,
      volumeTotal:    asset.volume24h,
      daysToClose:    0,   // scalp — no days concept; 0 bypasses the horizon check
      confidence:     debate.confidence,
      entryPrice:     asset.price,
      capitalUsed:    kellySizing.dollarSize,
      agentId:        'crypto-scalper-1',
    };

    const riskCheck = preTradeCheck(proposal);
    if (!riskCheck.approved) {
      console.log(`[cryptoWorkflow] RISK BLOCK: ${riskCheck.errors[0]}`);
      continue;
    }

    // RESERVE CAPITAL
    const reservation = reserveCapital(kellySizing.dollarSize);
    if (!reservation.ok) {
      console.log(`[cryptoWorkflow] CAPITAL: ${reservation.reason}`);
      continue;
    }

    // EXECUTE
    const execution = executeCryptoPaperTrade({
      asset,
      side,
      entryPrice:   asset.price,
      capitalUsed:  kellySizing.dollarSize,
      confidence:   debate.confidence,
      reason:       debate.arbiterSummary,
      evidence:     [
        ...(debate.bull?.evidence ?? []),
        `Kelly: ${(kellySizing.fraction * 100).toFixed(1)}%`,
        `RSI: ${asset.rsi14}`,
        `Trend: ${asset.trend}`,
      ],
    });

    results.executed++;
    results.tradeId = execution.tradeId;
    break; // one trade per cycle
  }

  return results;
}
```

- [ ] **Step 2: Smoke test — module loads cleanly**

```bash
node -e "import('./server/crypto/cryptoWorkflow.mjs').then(m => console.log('exports:', Object.keys(m))).catch(e => console.error('FAIL:', e.message))"
```

Expected: `exports: [ 'manageCryptoPositions', 'runCryptoTradingCycle' ]`

- [ ] **Step 3: Commit**

```bash
git add server/crypto/cryptoWorkflow.mjs
git commit -m "feat(crypto): add cryptoWorkflow — full SCAN→QUALIFY→DEBATE→SIZE→EXECUTE cycle"
```

---

## Task 7: Wire into `server/agentRunner.mjs` — 1-minute crypto loop

**Files:**
- Modify: `server/agentRunner.mjs`

- [ ] **Step 1: Add the crypto imports and 1-minute loop**

At the top of `server/agentRunner.mjs`, after the existing imports, add:

```js
import { runCryptoTradingCycle, manageCryptoPositions } from './crypto/cryptoWorkflow.mjs';
```

In the `if (!ONCE)` block (around line 155, after the self-ping setInterval), add:

```js
  // Crypto scalping loop — every 1 minute
  const CRYPTO_INTERVAL_MS = 60 * 1000;
  setInterval(async () => {
    try {
      await manageCryptoPositions();                    // close hitting positions first
      if (isDeptActive('crypto_scalping')) {
        const result = await runCryptoTradingCycle();
        if (result.executed) {
          console.log(`[cryptoScalper] ✓ Trade executed | scanned=${result.scanned} qualified=${result.qualified}`);
        } else if (result.qualified > 0) {
          console.log(`[cryptoScalper] No trade | scanned=${result.scanned} qualified=${result.qualified} debated=${result.debated}`);
        }
      }
    } catch (err) {
      console.error('[cryptoScalper] Loop error:', err.message);
    }
  }, CRYPTO_INTERVAL_MS);
  console.log('[agentRunner] Crypto scalping loop active — 1 min interval');
```

- [ ] **Step 2: Add `crypto_scalping` to default active departments in orgState**

Check `server/command/orgState.mjs` — find where `activeDepts` defaults are set. Add `crypto_scalping: true` to the default active departments object, so the crypto loop runs without requiring a founder command.

```bash
grep -n "activeDepts\|prediction_markets" server/command/orgState.mjs | head -20
```

Find the default `activeDepts` object and add `crypto_scalping: true` alongside `prediction_markets: true`.

- [ ] **Step 3: Smoke test — agentRunner imports cleanly**

```bash
node -e "
import('./server/crypto/cryptoWorkflow.mjs')
  .then(() => console.log('cryptoWorkflow OK'))
  .catch(e => console.error('FAIL:', e.message))
"
```

Expected: `cryptoWorkflow OK` (no import errors).

- [ ] **Step 4: Run all unit tests — confirm nothing broke**

```bash
node --test server/tests/costs.test.mjs server/tests/treasury.test.mjs server/tests/priceFeeder.test.mjs server/tests/cryptoExecution.test.mjs
```

Expected: all tests pass, exit 0.

- [ ] **Step 5: Commit + push**

```bash
git add server/agentRunner.mjs server/command/orgState.mjs
git commit -m "feat(agent): wire 1-minute crypto scalping loop into agentRunner"
git push origin feat/genesis-life-os
```

---

## Task 8: Verification end-to-end

After Render auto-redeploys (~2 min after push):

- [ ] **Step 1: Confirm health shows crypto-enabled backend**

```
GET https://genesis-hq-backend.onrender.com/api/health
```

Expect: `agent.claudeEnabled: true`, `agent.totalCycles >= 1`.

- [ ] **Step 2: Wait 2 minutes then check for crypto trades**

```
GET https://genesis-hq-backend.onrender.com/api/agent/trades
```

Look for trades where `market_source = 'binance'` or `asset_pair` is populated.

- [ ] **Step 3: Confirm Polymarket trades still work (no regression)**

```
GET https://genesis-hq-backend.onrender.com/api/trading/debates
```

Debates should still appear every 5 minutes. `market_source` should be `polymarket` for existing debates.

- [ ] **Step 4: Check edge scorecard counts both trade types**

```
GET https://genesis-hq-backend.onrender.com/api/trading/edge-scorecard
```

`totalClosed` should include closed crypto scalp trades once any positions hit target/stop.

---

## Self-Review

**Spec coverage:**
- ✅ Binance public API (no key) → priceFeeder.mjs
- ✅ BTC/ETH/SOL/BNB → `ASSETS` array in priceFeeder
- ✅ Claude Sonnet Bull/Bear/Arbiter → cryptoDebate.mjs
- ✅ EMA9/21 + RSI14 context in debate prompt → buildAssetContext + userPrompt
- ✅ +1.5% target / -0.75% stop → computeCryptoTargets
- ✅ 4h timeout → positionManager TIMEOUT_HOURS = 4
- ✅ Shared $10k capital → reserveCapital + settleTradeCapital from treasury
- ✅ Shared risk limits → preTradeCheck from riskManager
- ✅ Learning loop → analyzeClosedTrade after each close
- ✅ 1-minute loop → setInterval in agentRunner
- ✅ DB columns → schema.sql ALTER TABLE
- ✅ Unit tests → priceFeeder.test.mjs + cryptoExecution.test.mjs

**Placeholder scan:** No TBDs, no "similar to Task N", all code blocks complete.

**Type consistency:**
- `buildAssetContext()` returns `{ symbol, pair, price, change1h, change24h, volume24h, ema9, ema21, rsi14, trend }` → used consistently in cryptoDebate and cryptoWorkflow.
- `runCryptoDebate()` returns `{ action, outcome, confidence, bull, bear, arbiterSummary, skipReason }` → consumed correctly in cryptoWorkflow.
- `executeCryptoPaperTrade()` takes `{ asset, side, entryPrice, capitalUsed, confidence, reason, evidence }` → called correctly in cryptoWorkflow.
- `closeCryptoTrade(tradeId, exitPrice, exitReason)` → called correctly in positionManager.
- `computeCryptoPnl(side, entryPrice, exitPrice, shares)` → called correctly in cryptoExecution tests and closeCryptoTrade.
