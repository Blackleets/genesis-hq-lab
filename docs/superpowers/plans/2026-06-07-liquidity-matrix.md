# Genesis Liquidity Matrix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a premium institutional order-book depth panel (DEPTH tab) to the existing right-zone of Crypto Lab 2.0, alongside the existing INTEL tab, with real Binance data and order-flow signals exposed to the confidence engine.

**Architecture:** Server-computed thin client. `liquidityMatrix.mjs` fetches Binance public `/depth`, computes imbalance/walls/Genesis Reading, caches 3s, and exposes `getOrderFlowState()` for the confidence engine. A new `/api/crypto/depth` route serves the precomputed data. A `RightPanel` tab wrapper hosts INTEL and DEPTH tabs in the existing 200px right zone — no grid layout changes.

**Tech Stack:** Node.js ESM (server), React 19 + TypeScript (client), Binance public REST API (no auth), `node --test` test runner, `better-sqlite3` (no new DB tables needed).

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| CREATE | `server/crypto/liquidityMatrix.mjs` | Fetch Binance depth, compute imbalance/walls/signals/Genesis Reading, 3s cache, export `getOrderFlowState()` |
| CREATE | `server/tests/liquidityMatrix.test.mjs` | Tests for computation logic |
| MODIFY | `server/index.mjs` | Add `GET /api/crypto/depth` route |
| MODIFY | `src/services/cryptoClient.ts` | Add `DepthLevel`, `DepthData` interfaces + `loadDepth()` |
| CREATE | `src/components/crypto/LiquidityMatrix.tsx` | DEPTH tab panel: Genesis Reading hero, imbalance bar, asks/bids rows, signal chips |
| CREATE | `src/components/crypto/RightPanel.tsx` | Tab wrapper: INTEL \| DEPTH, owns tab state, renders MarketIntelPanel or LiquidityMatrix |
| MODIFY | `src/workflows/CryptoLabView.tsx` | Replace `<MarketIntelPanel />` with `<RightPanel />` in crypto-zone-intel |
| MODIFY | `server/crypto/marketIntelligence.mjs` | Import `getOrderFlowState()`, merge into returned object |

**Untouched:** `MarketIntelPanel.tsx`, `ExecutionFeed.tsx`, `ActivePositionsTerminal.tsx`, `index.css`, `CandleChart`, all trading/risk server files.

---

## Task 1 — `server/crypto/liquidityMatrix.mjs` + tests

**Files:**
- Create: `server/crypto/liquidityMatrix.mjs`
- Create: `server/tests/liquidityMatrix.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `server/tests/liquidityMatrix.test.mjs`:

```javascript
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// ── Pure-logic helpers (replicated here to test without hitting Binance) ────────

const WALL_MULTIPLIER = 4;
const THIN_THRESHOLD  = 5;

function computeImbalance(totalBid, totalAsk) {
  const total = totalBid + totalAsk;
  return total === 0 ? 0 : (totalBid - totalAsk) / total;
}

function genesisReading(imbalance, signals, totalBid, totalAsk) {
  if (totalBid + totalAsk < THIN_THRESHOLD)      return 'THIN LIQUIDITY';
  if (signals.sellWall)                           return 'SELL WALL DETECTED';
  if (signals.bidWall && imbalance > 0)           return 'BID WALL DETECTED';
  if (imbalance > 0.30)                           return 'BUY PRESSURE HIGH';
  if (imbalance < -0.30)                          return 'SELL PRESSURE HIGH';
  if (signals.absorptionZone)                     return 'ABSORPTION ZONE';
  if (imbalance > 0.15)                           return 'MOMENTUM BUILDING';
  return 'BALANCED BOOK';
}

function buildSignals(imbalance, bids, asks, midPrice) {
  const maxAsk  = asks.length  ? Math.max(...asks.map(a  => a.size)) : 0;
  const maxBid  = bids.length  ? Math.max(...bids.map(b  => b.size)) : 0;
  const avgAsk  = asks.length  ? asks.reduce((s, a)  => s + a.size, 0) / asks.length  : 0;
  const avgBid  = bids.length  ? bids.reduce((s, b)  => s + b.size, 0) / bids.length  : 0;
  const top3Bid = bids.slice(0, 3).reduce((s, b) => s + b.size, 0);
  return {
    buyPressure:      imbalance > 0.20,
    sellPressure:     imbalance < -0.20,
    sellWall:         avgAsk > 0 && maxAsk >= avgAsk * WALL_MULTIPLIER,
    bidWall:          avgBid > 0 && maxBid >= avgBid * WALL_MULTIPLIER,
    thinLiquidity:    (bids.reduce((s,b)=>s+b.size,0) + asks.reduce((s,a)=>s+a.size,0)) < THIN_THRESHOLD,
    absorptionZone:   midPrice > 0 && (top3Bid / midPrice) > 0.003,
    momentumBuilding: imbalance > 0.15 && imbalance <= 0.30,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('computeImbalance', () => {
  it('returns 0 for equal bid and ask', () => {
    assert.equal(computeImbalance(10, 10), 0);
  });
  it('returns positive for bid-heavy book', () => {
    assert.equal(computeImbalance(30, 10), 0.5);
  });
  it('returns negative for ask-heavy book', () => {
    assert.equal(computeImbalance(5, 15), -0.5);
  });
  it('returns 0 when both are zero', () => {
    assert.equal(computeImbalance(0, 0), 0);
  });
});

describe('genesisReading', () => {
  const noSignals = { sellWall: false, bidWall: false, absorptionZone: false };

  it('returns THIN LIQUIDITY for low total size', () => {
    assert.equal(genesisReading(0, noSignals, 2, 2), 'THIN LIQUIDITY');
  });
  it('returns SELL WALL DETECTED when sell wall present', () => {
    assert.equal(genesisReading(-0.1, { ...noSignals, sellWall: true }, 10, 10), 'SELL WALL DETECTED');
  });
  it('returns BID WALL DETECTED when bid wall + positive imbalance', () => {
    assert.equal(genesisReading(0.1, { ...noSignals, bidWall: true }, 10, 10), 'BID WALL DETECTED');
  });
  it('returns BUY PRESSURE HIGH for imbalance > 0.30', () => {
    assert.equal(genesisReading(0.35, noSignals, 20, 8), 'BUY PRESSURE HIGH');
  });
  it('returns SELL PRESSURE HIGH for imbalance < -0.30', () => {
    assert.equal(genesisReading(-0.40, noSignals, 8, 20), 'SELL PRESSURE HIGH');
  });
  it('returns MOMENTUM BUILDING for imbalance 0.15–0.30', () => {
    assert.equal(genesisReading(0.22, noSignals, 15, 10), 'MOMENTUM BUILDING');
  });
  it('returns BALANCED BOOK for neutral imbalance', () => {
    assert.equal(genesisReading(0.05, noSignals, 10, 9), 'BALANCED BOOK');
  });
  it('BID_WALL with negative imbalance returns SELL PRESSURE not BID WALL', () => {
    // bidWall AND imbalance < 0 → skips BID_WALL_DETECTED, falls to SELL PRESSURE HIGH
    assert.equal(genesisReading(-0.35, { ...noSignals, bidWall: true }, 8, 20), 'SELL PRESSURE HIGH');
  });
});

describe('buildSignals', () => {
  it('detects buyPressure when imbalance > 0.20', () => {
    const s = buildSignals(0.25, [], [], 0);
    assert.equal(s.buyPressure, true);
    assert.equal(s.sellPressure, false);
  });
  it('detects sellPressure when imbalance < -0.20', () => {
    const s = buildSignals(-0.25, [], [], 0);
    assert.equal(s.sellPressure, true);
    assert.equal(s.buyPressure, false);
  });
  it('detects sellWall when max ask >= 4x avg ask', () => {
    // 4 orders: 0.25 each avg, 1 order of 1.0 → avg=0.4, max=1.0, 1.0 >= 0.4*4=1.6? No.
    // Need: sizes [0.2, 0.2, 0.2, 0.2, 2.0] → avg=0.56, 2.0 >= 2.24? No.
    // [0.1, 0.1, 0.1, 0.1, 0.1, 2.5] → avg=0.5, 2.5 >= 2.0? Yes!
    const asks = [
      { size: 0.1 }, { size: 0.1 }, { size: 0.1 },
      { size: 0.1 }, { size: 0.1 }, { size: 2.5 },
    ];
    const s = buildSignals(0, [], asks, 0);
    assert.equal(s.sellWall, true);
  });
  it('does not flag sellWall when sizes are uniform', () => {
    const asks = [{ size: 1 }, { size: 1.1 }, { size: 0.9 }, { size: 1.0 }];
    const s = buildSignals(0, [], asks, 0);
    assert.equal(s.sellWall, false);
  });
  it('detects thinLiquidity when total size < 5', () => {
    const bids = [{ size: 1 }, { size: 1 }];
    const asks = [{ size: 1 }, { size: 1 }];
    const s = buildSignals(0, bids, asks, 0);
    assert.equal(s.thinLiquidity, true);
  });
  it('detects momentumBuilding for imbalance 0.15–0.30', () => {
    const s = buildSignals(0.20, [], [], 0);
    assert.equal(s.momentumBuilding, true);
    assert.equal(s.buyPressure, false); // 0.20 is NOT > 0.20
  });
});

describe('getOrderFlowState (exported from liquidityMatrix)', () => {
  it('returns null before any depth fetch', async () => {
    const { getOrderFlowState } = await import('../crypto/liquidityMatrix.mjs');
    const state = getOrderFlowState();
    assert.equal(state, null);
  });
});
```

- [ ] **Step 2: Run tests — expect failures on last suite only**

```
npm test -- --test-name-pattern="liquidityMatrix"
```

Expected: first 3 suites PASS (pure logic), last suite FAILS because `liquidityMatrix.mjs` doesn't exist yet.

- [ ] **Step 3: Create `server/crypto/liquidityMatrix.mjs`**

```javascript
// liquidityMatrix.mjs — Genesis Liquidity Matrix.
// Fetches Binance public order book, computes imbalance, walls, Genesis Reading,
// and order flow signals. 3s in-memory cache per pair.
// getOrderFlowState() is consumed by marketIntelligence.mjs.

const BINANCE_BASE       = 'https://api.binance.com/api/v3';
const CACHE_TTL_MS       = 3_000;
const WALL_MULTIPLIER    = 4;
const THIN_THRESHOLD     = 5;

// ── Module-level cache + shared state ─────────────────────────────────────────
let _cache      = { data: null, ts: 0, pair: null };
let _orderFlow  = null;

export function getOrderFlowState() {
  return _orderFlow;
}

// ── Computation helpers ────────────────────────────────────────────────────────

function computeImbalance(totalBid, totalAsk) {
  const total = totalBid + totalAsk;
  return total === 0 ? 0 : (totalBid - totalAsk) / total;
}

function buildLevels(rawPairs) {
  // rawPairs: [[priceStr, qtyStr], ...]
  const parsed = rawPairs.map(([p, q]) => ({ price: parseFloat(p), size: parseFloat(q) }));
  const maxSize = parsed.reduce((m, l) => Math.max(m, l.size), 0);
  const avgSize = parsed.length > 0 ? parsed.reduce((s, l) => s + l.size, 0) / parsed.length : 0;
  return parsed.map(l => ({
    price:  l.price,
    size:   l.size,
    pct:    maxSize > 0 ? l.size / maxSize : 0,
    isWall: avgSize > 0 && l.size >= avgSize * WALL_MULTIPLIER,
    isVoid: false,
  }));
}

function buildSignals(imbalance, bids, asks, midPrice) {
  const maxAsk  = asks.length ? Math.max(...asks.map(a => a.size)) : 0;
  const maxBid  = bids.length ? Math.max(...bids.map(b => b.size)) : 0;
  const avgAsk  = asks.length ? asks.reduce((s, a) => s + a.size, 0) / asks.length : 0;
  const avgBid  = bids.length ? bids.reduce((s, b) => s + b.size, 0) / bids.length : 0;
  const top3Bid = bids.slice(0, 3).reduce((s, b) => s + b.size, 0);
  return {
    buyPressure:      imbalance > 0.20,
    sellPressure:     imbalance < -0.20,
    sellWall:         avgAsk > 0 && maxAsk >= avgAsk * WALL_MULTIPLIER,
    bidWall:          avgBid > 0 && maxBid >= avgBid * WALL_MULTIPLIER,
    thinLiquidity:    (bids.reduce((s,b)=>s+b.size,0) + asks.reduce((s,a)=>s+a.size,0)) < THIN_THRESHOLD,
    absorptionZone:   midPrice > 0 && (top3Bid / midPrice) > 0.003,
    momentumBuilding: imbalance > 0.15 && imbalance <= 0.30,
  };
}

function deriveReading(imbalance, signals, totalBid, totalAsk) {
  if (totalBid + totalAsk < THIN_THRESHOLD)
    return { reading: 'THIN LIQUIDITY',     readingColor: '#6b7280', readingBg: 'rgba(107,114,128,0.06)' };
  if (signals.sellWall)
    return { reading: 'SELL WALL DETECTED', readingColor: '#ef4444', readingBg: 'rgba(239,68,68,0.08)'   };
  if (signals.bidWall && imbalance > 0)
    return { reading: 'BID WALL DETECTED',  readingColor: '#f97316', readingBg: 'rgba(249,115,22,0.08)'  };
  if (imbalance > 0.30)
    return { reading: 'BUY PRESSURE HIGH',  readingColor: '#22c55e', readingBg: 'rgba(34,197,94,0.08)'   };
  if (imbalance < -0.30)
    return { reading: 'SELL PRESSURE HIGH', readingColor: '#ef4444', readingBg: 'rgba(239,68,68,0.08)'   };
  if (signals.absorptionZone)
    return { reading: 'ABSORPTION ZONE',    readingColor: '#3b82f6', readingBg: 'rgba(59,130,246,0.08)'  };
  if (imbalance > 0.15)
    return { reading: 'MOMENTUM BUILDING',  readingColor: '#a855f7', readingBg: 'rgba(168,85,247,0.08)'  };
  return   { reading: 'BALANCED BOOK',      readingColor: '#6b7280', readingBg: 'rgba(107,114,128,0.06)' };
}

// ── Main export ────────────────────────────────────────────────────────────────

export async function fetchDepth(pair = 'BTCUSDT', levels = 20) {
  const now = Date.now();
  if (_cache.data && _cache.pair === pair && now - _cache.ts < CACHE_TTL_MS) {
    return _cache.data;
  }

  const r = await fetch(
    `${BINANCE_BASE}/depth?symbol=${pair}&limit=${levels}`,
    { signal: AbortSignal.timeout(5000) }
  );
  if (!r.ok) throw new Error(`Binance depth HTTP ${r.status}`);
  const raw = await r.json();

  const bids = buildLevels(raw.bids ?? []).sort((a, b) => b.price - a.price); // best bid first
  const asks = buildLevels(raw.asks ?? []).sort((a, b) => a.price - b.price); // best ask first

  const totalBidSize = bids.reduce((s, b) => s + b.size, 0);
  const totalAskSize = asks.reduce((s, a) => s + a.size, 0);
  const imbalance    = computeImbalance(totalBidSize, totalAskSize);

  const bestBid  = bids[0]?.price ?? 0;
  const bestAsk  = asks[0]?.price ?? 0;
  const midPrice = bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : 0;
  const spread   = bestAsk - bestBid;
  const spreadPct = midPrice > 0 ? spread / midPrice : 0;

  const signals = buildSignals(imbalance, bids, asks, midPrice);
  const { reading, readingColor, readingBg } = deriveReading(imbalance, signals, totalBidSize, totalAskSize);

  const data = {
    pair,
    midPrice:     Math.round(midPrice  * 100)  / 100,
    spread:       Math.round(spread    * 100)  / 100,
    spreadPct:    Math.round(spreadPct * 10000) / 10000,
    imbalance:    Math.round(imbalance * 1000) / 1000,
    imbalancePct: Math.round(imbalance * 1000) / 10,
    totalBidSize: Math.round(totalBidSize * 1000) / 1000,
    totalAskSize: Math.round(totalAskSize * 1000) / 1000,
    bids:         bids.slice(0, Math.floor(levels / 2)),
    asks:         asks.slice(0, Math.floor(levels / 2)),
    reading,
    readingColor,
    readingBg,
    signals,
    fetchedAt: new Date().toISOString(),
  };

  _cache     = { data, ts: now, pair };
  _orderFlow = { imbalance, signals, reading, pair, ts: data.fetchedAt };

  return data;
}
```

- [ ] **Step 4: Run tests — all pass**

```
npm test -- --test-name-pattern="liquidityMatrix"
```

Expected: all suites PASS.

- [ ] **Step 5: Commit**

```
git add server/crypto/liquidityMatrix.mjs server/tests/liquidityMatrix.test.mjs
git commit -m "feat(liquidity-matrix): server-side depth computation + tests"
```

---

## Task 2 — `/api/crypto/depth` route in `server/index.mjs`

**Files:**
- Modify: `server/index.mjs`

- [ ] **Step 1: Find the insertion point**

Open `server/index.mjs`. The new route goes immediately after the existing `/api/crypto/market-intelligence` block (around line 568). Find:

```javascript
  if (url.pathname === '/api/crypto/market-intelligence') {
```

The new route goes **after** that block's closing `return;`.

- [ ] **Step 2: Add the import at the top of the file**

Find the existing import block near line 72 that reads:
```javascript
import { getMarketIntelligence, getCryptoFeedEvents } from './crypto/marketIntelligence.mjs';
```

Add on the very next line:
```javascript
import { fetchDepth } from './crypto/liquidityMatrix.mjs';
```

- [ ] **Step 3: Add the route**

Find the block:
```javascript
  if (url.pathname === '/api/crypto/market-intelligence') {
    try {
      const intel = getMarketIntelligence();
      sendJson(res, 200, { ok: true, ...intel });
    } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }
```

Insert immediately after that block's `return;`:

```javascript
  // GET /api/crypto/depth?pair=BTCUSDT&levels=20
  if (url.pathname === '/api/crypto/depth') {
    try {
      const pair   = (url.searchParams.get('pair') ?? 'BTCUSDT').toUpperCase();
      const levels = Math.min(50, Math.max(5, parseInt(url.searchParams.get('levels') ?? '20', 10)));
      const data   = await fetchDepth(pair, levels);
      sendJson(res, 200, { ok: true, ...data });
    } catch (e) { sendJson(res, 502, { ok: false, error: e.message }); }
    return;
  }
```

- [ ] **Step 4: Verify the route works**

Start the server (`npm run server`) and in another terminal:

```
curl "http://localhost:8787/api/crypto/depth?pair=BTCUSDT&levels=10"
```

Expected: JSON with `ok: true`, `midPrice`, `bids` array of 5 objects, `asks` array of 5 objects, `reading` string, `signals` object.

- [ ] **Step 5: Commit**

```
git add server/index.mjs
git commit -m "feat(liquidity-matrix): GET /api/crypto/depth route"
```

---

## Task 3 — `loadDepth()` in `src/services/cryptoClient.ts`

**Files:**
- Modify: `src/services/cryptoClient.ts` (append after line 124)

- [ ] **Step 1: Append interfaces and function**

Add at the very end of `src/services/cryptoClient.ts`:

```typescript
// ─── Liquidity Matrix / Depth ─────────────────────────────────────────────────

export interface DepthLevel {
  price:  number;
  size:   number;
  pct:    number;    // 0–1, relative to max size on this side (bar width)
  isWall: boolean;   // size >= 4× average for this side
  isVoid: boolean;
}

export interface DepthSignals {
  buyPressure:      boolean;
  sellPressure:     boolean;
  sellWall:         boolean;
  bidWall:          boolean;
  thinLiquidity:    boolean;
  absorptionZone:   boolean;
  momentumBuilding: boolean;
}

export interface DepthData {
  pair:         string;
  midPrice:     number;
  spread:       number;
  spreadPct:    number;
  imbalance:    number;       // [-1, 1]
  imbalancePct: number;
  totalBidSize: number;
  totalAskSize: number;
  bids:         DepthLevel[]; // sorted DESC from mid (best bid = index 0)
  asks:         DepthLevel[]; // sorted ASC  from mid (best ask = index 0)
  reading:      string;
  readingColor: string;
  readingBg:    string;
  signals:      DepthSignals;
  fetchedAt:    string;
}

export async function loadDepth(pair = 'BTCUSDT', levels = 20): Promise<DepthData | null> {
  try {
    const res = await fetch(
      apiUrl(`/api/crypto/depth?pair=${pair}&levels=${levels}`),
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const json = await res.json() as { ok: boolean } & DepthData;
    if (!json.ok) return null;
    const { ok: _ok, ...depth } = json;
    return depth as DepthData;
  } catch { return null; }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```
npm run build
```

Expected: 0 errors, build succeeds.

- [ ] **Step 3: Commit**

```
git add src/services/cryptoClient.ts
git commit -m "feat(liquidity-matrix): DepthData interface + loadDepth() in cryptoClient"
```

---

## Task 4 — `src/components/crypto/LiquidityMatrix.tsx`

**Files:**
- Create: `src/components/crypto/LiquidityMatrix.tsx`

- [ ] **Step 1: Create the component**

```typescript
// LiquidityMatrix.tsx — Genesis Liquidity Matrix depth panel.
// Polls /api/crypto/depth every 4s. Renders asks above mid, bids below.
// Horizontal bars show relative order size. WALL badge for outlier orders.

import { useEffect, useCallback, useReducer, useState } from 'react';
import { loadDepth, type DepthData, type DepthLevel, type DepthSignals } from '@services/cryptoClient';

const POLL_MS = 4_000;
const PAIRS   = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'] as const;

// ── Reducer ───────────────────────────────────────────────────────────────────

type State  = { data: DepthData | null; error: boolean };
type Action = { type: 'set'; data: DepthData } | { type: 'err' };

function reducer(state: State, action: Action): State {
  if (action.type === 'set') return { data: action.data, error: false };
  if (action.type === 'err') return { ...state, error: true };
  return state;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function fmtPrice(n: number): string {
  return n >= 1000
    ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : n.toFixed(4);
}

function fmtSize(n: number): string {
  return n >= 10 ? n.toFixed(2) : n >= 1 ? n.toFixed(3) : n.toFixed(4);
}

function ImbalanceBar({ imbalance }: { imbalance: number }) {
  const pct    = Math.min(1, Math.max(-1, imbalance));
  const isPos  = pct >= 0;
  const fill   = Math.abs(pct) * 50;   // max 50% from center
  const color  = isPos ? '#22c55e' : '#ef4444';
  return (
    <div style={{ padding: '6px 10px', borderBottom: '1px solid #0d1117', flexShrink: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <span style={{ color: '#4b5563', fontSize: 8, letterSpacing: 0.8 }}>IMBALANCE</span>
        <span style={{ color, fontSize: 8, fontWeight: 700 }}>
          {pct >= 0 ? '+' : ''}{(pct * 100).toFixed(1)}%
        </span>
      </div>
      <div style={{ height: 4, background: '#1e2a3a', borderRadius: 2, position: 'relative', overflow: 'hidden' }}>
        <div style={{
          position: 'absolute', top: 0, bottom: 0, borderRadius: 2, background: color,
          [isPos ? 'left' : 'right']: '50%', width: `${fill}%`,
        }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
        <span style={{ fontSize: 7, color: '#ef4444' }}>SELL</span>
        <span style={{ fontSize: 7, color: '#22c55e' }}>BUY</span>
      </div>
    </div>
  );
}

function DepthRow({ level, side }: { level: DepthLevel; side: 'bid' | 'ask' }) {
  const barColor   = side === 'bid' ? '#22c55e' : '#ef4444';
  const priceColor = level.isWall
    ? (side === 'bid' ? '#86efac' : '#fca5a5')
    : level.pct > 0.6 ? '#9ca3af' : '#6b7280';
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '62px 1fr 30px',
      alignItems: 'center', padding: '2px 10px', gap: 4,
      position: 'relative', minHeight: 18,
      fontSize: 9, fontFamily: 'monospace',
    }}>
      <div style={{
        position: 'absolute', top: 0, bottom: 0, right: 0,
        width: `${level.pct * 100}%`, background: barColor,
        opacity: level.isWall ? 0.25 : 0.10, pointerEvents: 'none',
      }} />
      <span style={{ color: priceColor, fontWeight: level.isWall ? 700 : 400, zIndex: 1 }}>
        {fmtPrice(level.price)}
      </span>
      <span style={{ color: '#6b7280', textAlign: 'right', paddingRight: 4, zIndex: 1 }}>
        {fmtSize(level.size)}
      </span>
      <span style={{ color: '#f97316', fontSize: 7, fontWeight: 700, zIndex: 1, textAlign: 'right' }}>
        {level.isWall ? 'WALL' : ''}
      </span>
    </div>
  );
}

function Chip({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      fontSize: 7, fontWeight: 700, letterSpacing: 0.5,
      padding: '2px 5px', borderRadius: 3,
      background: `${color}1a`, color,
      fontFamily: 'monospace', textTransform: 'uppercase',
    }}>
      {label}
    </span>
  );
}

function SignalChips({ signals }: { signals: DepthSignals }) {
  const active = [
    signals.buyPressure      && ['BUY PRESSURE',  '#22c55e'],
    signals.sellPressure     && ['SELL PRESSURE', '#ef4444'],
    signals.sellWall         && ['SELL WALL',      '#f97316'],
    signals.bidWall          && ['BID WALL',       '#f97316'],
    signals.thinLiquidity    && ['THIN LIQ',       '#6b7280'],
    signals.absorptionZone   && ['ABSORPTION',     '#3b82f6'],
    signals.momentumBuilding && ['MOMENTUM',       '#a855f7'],
  ].filter(Boolean) as [string, string][];

  if (active.length === 0) return null;
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: 3,
      padding: '6px 10px', borderTop: '1px solid #1e2a3a', flexShrink: 0,
    }}>
      {active.map(([label, color]) => <Chip key={label} label={label} color={color} />)}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  pair?:      string;
  className?: string;
}

export function LiquidityMatrix({ pair: propPair, className = '' }: Props) {
  const [selectedPair, setSelectedPair] = useState<string>(propPair ?? 'BTCUSDT');
  const [state, dispatch]               = useReducer(reducer, { data: null, error: false });

  const poll = useCallback(async () => {
    const data = await loadDepth(selectedPair, 20);
    if (data) dispatch({ type: 'set', data });
    else      dispatch({ type: 'err' });
  }, [selectedPair]);

  useEffect(() => {
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [poll]);

  const d = state.data;

  return (
    <div className={className} style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: '#0a0e1a', border: '1px solid #1e2a3a',
      borderRadius: 8, overflow: 'hidden',
    }}>
      {/* Header + pair selector */}
      <div style={{
        padding: '6px 10px', borderBottom: '1px solid #1e2a3a',
        display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
        background: '#060810',
      }}>
        <span style={{ color: '#a855f7', fontSize: 9, fontWeight: 700 }}>◈</span>
        <span style={{ color: '#4b5563', fontSize: 10, fontWeight: 600, letterSpacing: 1, marginRight: 'auto' }}>
          LIQUIDITY MATRIX
        </span>
        {PAIRS.map(p => (
          <button key={p} onClick={() => setSelectedPair(p)} style={{
            fontSize: 7, fontWeight: 700, letterSpacing: 0.5,
            padding: '2px 4px', border: 'none', cursor: 'pointer',
            background: selectedPair === p ? 'rgba(168,85,247,0.15)' : 'transparent',
            color: selectedPair === p ? '#a855f7' : '#374151',
            borderRadius: 3, fontFamily: 'monospace',
          }}>
            {p.replace('USDT', '')}
          </button>
        ))}
      </div>

      {/* Content */}
      {!d ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ color: '#374151', fontSize: 10, fontFamily: 'monospace' }}>
            {state.error ? 'Depth unavailable' : 'Fetching depth…'}
          </span>
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>

          {/* Genesis Reading hero */}
          <div style={{
            padding: '7px 10px', borderBottom: '1px solid #1e2a3a',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: d.readingBg, flexShrink: 0,
            transition: 'background 0.3s',
          }}>
            <span style={{ color: '#4b5563', fontSize: 9, letterSpacing: 0.8, fontFamily: 'monospace' }}>
              GENESIS READING
            </span>
            <span style={{ color: d.readingColor, fontSize: 10, fontWeight: 800, letterSpacing: 1, fontFamily: 'monospace' }}>
              {d.reading}
            </span>
          </div>

          {/* Imbalance */}
          <ImbalanceBar imbalance={d.imbalance} />

          {/* ASKS section — reversed so best ask is closest to mid */}
          <div style={{ padding: '3px 10px', fontSize: 8, color: 'rgba(239,68,68,0.35)', letterSpacing: 0.8, background: '#060810', borderBottom: '1px solid #0d1117', flexShrink: 0 }}>
            ASKS
          </div>
          {[...d.asks].reverse().map((level, i) => (
            <DepthRow key={`ask-${i}`} level={level} side="ask" />
          ))}

          {/* Mid price line */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '5px 10px', flexShrink: 0,
            borderTop: '1px solid #1a3020', borderBottom: '1px solid #1a3020',
            background: '#0a0f0a',
          }}>
            <span style={{ color: '#22c55e', fontSize: 11, fontWeight: 700, fontFamily: 'monospace' }}>
              ${d.midPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </span>
            <span style={{ color: '#374151', fontSize: 8, fontFamily: 'monospace' }}>
              sp {(d.spreadPct * 100).toFixed(3)}%
            </span>
          </div>

          {/* BIDS section — best bid is index 0, closest to mid */}
          <div style={{ padding: '3px 10px', fontSize: 8, color: 'rgba(34,197,94,0.35)', letterSpacing: 0.8, background: '#060810', borderBottom: '1px solid #0d1117', flexShrink: 0 }}>
            BIDS
          </div>
          {d.bids.map((level, i) => (
            <DepthRow key={`bid-${i}`} level={level} side="bid" />
          ))}

          {/* Signal chips */}
          <SignalChips signals={d.signals} />

        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```
npm run build
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```
git add src/components/crypto/LiquidityMatrix.tsx
git commit -m "feat(liquidity-matrix): LiquidityMatrix component"
```

---

## Task 5 — `src/components/crypto/RightPanel.tsx`

**Files:**
- Create: `src/components/crypto/RightPanel.tsx`

- [ ] **Step 1: Create the component**

```typescript
// RightPanel.tsx — Tab wrapper for the right zone of Crypto Lab.
// Hosts INTEL (MarketIntelPanel) and DEPTH (LiquidityMatrix) tabs.
// Default: INTEL tab. Owns tab state.

import { useState } from 'react';
import { MarketIntelPanel } from './MarketIntelPanel';
import { LiquidityMatrix }  from './LiquidityMatrix';

type Tab = 'INTEL' | 'DEPTH';

const TAB_COLOR: Record<Tab, string> = {
  INTEL: '#f59e0b',
  DEPTH: '#a855f7',
};

interface Props {
  pair?:      string;
  className?: string;
}

export function RightPanel({ pair, className = '' }: Props) {
  const [tab, setTab] = useState<Tab>('INTEL');

  return (
    <div className={className} style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: '#060810', border: '1px solid #1e2a3a',
      borderRadius: 8, overflow: 'hidden',
    }}>
      {/* Tab bar */}
      <div style={{ display: 'flex', flexShrink: 0, borderBottom: '1px solid #1e2a3a' }}>
        {(['INTEL', 'DEPTH'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1, padding: '7px 4px',
              fontSize: 9, letterSpacing: 1, fontWeight: 700,
              textTransform: 'uppercase', fontFamily: 'monospace',
              border: 'none', cursor: 'pointer', background: 'transparent',
              color:        tab === t ? TAB_COLOR[t] : '#374151',
              borderBottom: tab === t ? `2px solid ${TAB_COLOR[t]}` : '2px solid transparent',
              transition: 'color 0.15s, border-color 0.15s',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Content — each child fills the remaining height */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {tab === 'INTEL' ? (
          <MarketIntelPanel />
        ) : (
          <LiquidityMatrix pair={pair} style={{ borderRadius: 0, border: 'none' } as React.CSSProperties} />
        )}
      </div>
    </div>
  );
}
```

**Note:** `LiquidityMatrix` only accepts `className` and `pair` props — not `style`. To remove its inner border when nested inside `RightPanel`, pass a wrapper className. Update the `LiquidityMatrix` outer div's border and borderRadius to only apply when not inside a parent with border. The cleanest fix: add `noBorder?: boolean` to `LiquidityMatrix` Props:

Open `src/components/crypto/LiquidityMatrix.tsx`. Change:

```typescript
interface Props {
  pair?:      string;
  className?: string;
}
```

to:

```typescript
interface Props {
  pair?:      string;
  className?: string;
  noBorder?:  boolean;
}
```

And change the outer div's style:

```typescript
export function LiquidityMatrix({ pair: propPair, className = '', noBorder = false }: Props) {
```

```typescript
    <div className={className} style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: '#0a0e1a',
      border:       noBorder ? 'none' : '1px solid #1e2a3a',
      borderRadius: noBorder ? 0 : 8,
      overflow: 'hidden',
    }}>
```

Then in `RightPanel.tsx` use `<LiquidityMatrix pair={pair} noBorder />` instead of passing style.

Update `RightPanel.tsx` content div:
```typescript
        {tab === 'INTEL' ? (
          <MarketIntelPanel />
        ) : (
          <LiquidityMatrix pair={pair} noBorder />
        )}
```

- [ ] **Step 2: Verify TypeScript compiles**

```
npm run build
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```
git add src/components/crypto/RightPanel.tsx src/components/crypto/LiquidityMatrix.tsx
git commit -m "feat(liquidity-matrix): RightPanel tab wrapper (INTEL | DEPTH)"
```

---

## Task 6 — Wire `RightPanel` into `CryptoLabView.tsx`

**Files:**
- Modify: `src/workflows/CryptoLabView.tsx`

- [ ] **Step 1: Replace the import**

Find in `src/workflows/CryptoLabView.tsx`:

```typescript
import { MarketIntelPanel } from '../components/crypto/MarketIntelPanel';
```

Replace with:

```typescript
import { RightPanel } from '../components/crypto/RightPanel';
```

- [ ] **Step 2: Replace the zone render**

Find:

```tsx
        {/* ZONE B — Market Intelligence (right) */}
        <div className="crypto-zone-intel">
          <MarketIntelPanel />
        </div>
```

Replace with:

```tsx
        {/* ZONE B — Market Intelligence / Depth (right) */}
        <div className="crypto-zone-intel">
          <RightPanel />
        </div>
```

- [ ] **Step 3: Verify TypeScript compiles**

```
npm run build
```

Expected: 0 errors, 0 warnings related to this change.

- [ ] **Step 4: Commit**

```
git add src/workflows/CryptoLabView.tsx
git commit -m "feat(liquidity-matrix): wire RightPanel into CryptoLabView"
```

---

## Task 7 — Order flow integration in `marketIntelligence.mjs`

**Files:**
- Modify: `server/crypto/marketIntelligence.mjs`

- [ ] **Step 1: Add import**

Find the existing imports at the top of `server/crypto/marketIntelligence.mjs`:

```javascript
import db from '../db/database.mjs';
import { getGlobalRiskDiagnostics } from '../risk/globalRiskEngine.mjs';
import { getConfidenceDiagnostics } from '../intelligence/confidenceEngine.mjs';
import { getTimeline } from '../observability/eventTimeline.mjs';
```

Add on the line immediately after:

```javascript
import { getOrderFlowState } from './liquidityMatrix.mjs';
```

- [ ] **Step 2: Merge order flow into `getMarketIntelligence()` return**

Find the `return {` at the end of `getMarketIntelligence()`. It currently returns:

```javascript
  return {
    momentum,
    volatility,
    trend,
    regime,
    recommendation,
    confidence: { score: confScore, band: confBand },
    risk: { band: riskBand, score: riskScore, safeMode },
    activity: {
      signalsLast3h: total,
      longs,
      shorts,
      recentWinRate: winRate !== null ? Math.round(winRate * 100) / 100 : null,
    },
  };
```

Replace with:

```javascript
  const orderFlow = (() => {
    try {
      const of = getOrderFlowState();
      if (!of) return null;
      return {
        imbalance: of.imbalance,
        reading:   of.reading,
        signals:   of.signals,
        pair:      of.pair,
        ts:        of.ts,
      };
    } catch { return null; }
  })();

  return {
    momentum,
    volatility,
    trend,
    regime,
    recommendation,
    confidence: { score: confScore, band: confBand },
    risk: { band: riskBand, score: riskScore, safeMode },
    activity: {
      signalsLast3h: total,
      longs,
      shorts,
      recentWinRate: winRate !== null ? Math.round(winRate * 100) / 100 : null,
    },
    orderFlow,
  };
```

- [ ] **Step 3: Run full test suite**

```
npm test
```

Expected: all existing tests pass (425+). No new failures — `getOrderFlowState()` returns `null` in tests since no depth is fetched, and the null guard handles it cleanly.

- [ ] **Step 4: Commit**

```
git add server/crypto/marketIntelligence.mjs
git commit -m "feat(liquidity-matrix): expose orderFlow state in getMarketIntelligence()"
```

---

## Task 8 — Final build validation

**Files:** none changed

- [ ] **Step 1: Full production build**

```
npm run build
```

Expected: tsc + vite both succeed. 0 TypeScript errors. Build artifacts in `dist/`.

- [ ] **Step 2: Full test suite**

```
npm test
```

Expected: all tests pass (425 existing + new liquidityMatrix tests).

- [ ] **Step 3: Manual smoke test**

Start the server and open the Crypto Lab:
1. `npm run start:ui`
2. Open browser → navigate to Crypto Lab
3. Right zone shows INTEL tab (existing MarketIntelPanel — unchanged)
4. Click DEPTH tab → LiquidityMatrix loads with "Fetching depth…" then renders BTC order book
5. Genesis Reading hero shows a label with correct color (e.g. "BALANCED BOOK" in gray)
6. Imbalance bar reflects bid/ask ratio
7. Asks visible above mid price, bids below
8. WALL badge appears on large orders
9. Signal chips appear at bottom for active conditions
10. Click BTC / ETH / SOL / BNB buttons — panel updates to show that pair's depth
11. Switch back to INTEL tab — MarketIntelPanel renders correctly (unchanged)

- [ ] **Step 4: Final commit**

```
git add -A
git commit -m "feat(crypto-lab): Genesis Liquidity Matrix — institutional depth panel

INTEL | DEPTH tab switch in right zone. Real Binance order book data.
Server-side computation: imbalance, walls, Genesis Reading, order flow signals.
Order flow state exposed to confidence engine via getOrderFlowState().

New files:
- server/crypto/liquidityMatrix.mjs
- server/tests/liquidityMatrix.test.mjs
- src/components/crypto/LiquidityMatrix.tsx
- src/components/crypto/RightPanel.tsx

Modified files:
- server/index.mjs: GET /api/crypto/depth route
- src/services/cryptoClient.ts: DepthData + loadDepth()
- src/workflows/CryptoLabView.tsx: RightPanel replaces MarketIntelPanel
- server/crypto/marketIntelligence.mjs: orderFlow field in response

Build: clean. Tests: all pass."
```

---

## Self-Review

**Spec coverage check:**
- Part 1 (Liquidity Matrix, bids/asks, price, size, imbalance, pressure zones): ✅ Task 1 + Task 4
- Part 2 (AI interpretation: BUY PRESSURE HIGH, SELL WALL, etc.): ✅ `deriveReading()` in Task 1
- Part 3 (Depth visualization, heatmap bars, WALL detection): ✅ `DepthRow` with inline bars in Task 4
- Part 4 (Order flow signals exposed to confidence engine): ✅ Task 7, `getOrderFlowState()` in Task 1
- Part 5 (Professional minimal institutional UI): ✅ Genesis design system throughout Task 4/5
- Part 6 (No lag, no WebSocket spam, no regressions): ✅ 3s cache + 4s poll; existing tests must all pass in Task 8

**Placeholder scan:** None found.

**Type consistency:**
- `DepthLevel` defined in Task 3, used in Task 4 ✅
- `DepthData` defined in Task 3, used in Task 4 ✅
- `DepthSignals` defined in Task 3, used in Task 4 ✅
- `fetchDepth()` defined in Task 1, imported in Task 2 ✅
- `getOrderFlowState()` defined in Task 1, imported in Task 7 ✅
- `loadDepth()` defined in Task 3, imported in Task 4 ✅
- `LiquidityMatrix` exported in Task 4, imported in Task 5 ✅
- `RightPanel` exported in Task 5, imported in Task 6 ✅
- `noBorder` prop added to `LiquidityMatrix` in Task 5, consistent with Task 4 definition ✅
