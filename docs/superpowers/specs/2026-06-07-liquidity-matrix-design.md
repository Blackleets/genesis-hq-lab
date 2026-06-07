# Genesis Liquidity Matrix — Design Spec

> Audit date: 2026-06-07. Approved by principal engineer.

## Goal

Add a premium institutional-grade order book depth panel to Crypto Lab 2.0.
The panel lives as a **DEPTH tab** inside the existing right-zone (200px), alongside
the existing INTEL tab. Additive only — no layout redesign, no regressions.

## Architecture

**Approach: Server-Computed Thin Client**

Server fetches Binance public `/depth` endpoint, computes all derived metrics
(imbalance, walls, voids, Genesis Reading), and exposes a single
`GET /api/crypto/depth` route. The client polls every 4 seconds and only renders.
Order flow state is held in server memory so the confidence engine can consume it.

---

## Layout Decision

Right zone (200px) becomes a **tabbed panel** with two tabs:

```
┌──────────────────────────┐
│  INTEL  │  DEPTH         │  ← tab bar
├──────────────────────────┤
│  (existing MarketIntel   │  ← INTEL tab (unchanged)
│   or LiquidityMatrix)    │  ← DEPTH tab (new)
└──────────────────────────┘
```

No CSS grid changes. `CryptoLabView.tsx` renders `<RightPanel>` instead of
`<MarketIntelPanel>` directly. `RightPanel` owns the tab state and renders
the correct child.

---

## File Structure

### New files

| File | Responsibility |
|------|----------------|
| `server/crypto/liquidityMatrix.mjs` | Fetches Binance depth, computes all signals, caches result 3s, exposes `getOrderFlowState()` for confidence engine |
| `src/components/crypto/LiquidityMatrix.tsx` | Renders the DEPTH tab: Genesis Reading hero, imbalance bar, asks/bids rows with inline bars, WALL badges, signal chips |
| `src/components/crypto/RightPanel.tsx` | Tab wrapper: INTEL \| DEPTH switch, renders `<MarketIntelPanel>` or `<LiquidityMatrix>` |

### Modified files

| File | Change |
|------|--------|
| `server/index.mjs` | Add `GET /api/crypto/depth?pair=BTCUSDT&levels=20` route |
| `src/services/cryptoClient.ts` | Add `DepthData` interface + `loadDepth(pair, levels)` function |
| `src/workflows/CryptoLabView.tsx` | Replace `<MarketIntelPanel>` with `<RightPanel>` in crypto-zone-intel |
| `server/crypto/marketIntelligence.mjs` | Import `getOrderFlowState()` and merge into `getMarketIntelligence()` output |

### Untouched files

`MarketIntelPanel.tsx`, `ExecutionFeed.tsx`, `ActivePositionsTerminal.tsx`,
`index.css` grid classes, `CandleChart`, all server trading/risk files.

---

## Data Flow

```
Binance public API
  GET /api/v3/depth?symbol=BTCUSDT&limit=20
  (no auth required)
        │
        ▼
server/crypto/liquidityMatrix.mjs
  fetchDepth(pair, levels)
    ├── 3s cache (avoids Binance rate limit)
    ├── computeImbalance()  → imbalance ratio [-1, 1]
    ├── detectWalls()       → orders ≥ 4× avg size
    ├── detectVoids()       → price gaps > 3× avg spread
    ├── genesisReading()    → human label + color
    ├── buildSignals()      → { buyPressure, sellWall, thinLiquidity, ... }
    └── _lastOrderFlow      → shared in-memory state for confidence engine
        │
        ▼
GET /api/crypto/depth (server/index.mjs)
  Returns: DepthData object (see interface below)
        │
        ▼
src/services/cryptoClient.ts
  loadDepth(pair, levels) → DepthData | null
        │
        ▼
src/components/crypto/LiquidityMatrix.tsx
  Polls every 4000ms
  Renders: Reading hero → Imbalance bar → Asks rows → Mid line → Bids rows → Signal chips
        │
src/components/crypto/RightPanel.tsx
  Tab state (INTEL | DEPTH) → renders child
        │
src/workflows/CryptoLabView.tsx
  <RightPanel pair={currentPair} />  (currentPair from CandleChart or default BTCUSDT)
```

---

## API Response — `DepthData` Interface

```typescript
interface DepthLevel {
  price: number;
  size: number;
  pct: number;       // 0–1, relative to max size in this side (for bar width)
  isWall: boolean;   // size >= 4× average for this side
  isVoid: boolean;   // price gap above this level > 3× avg spread
}

interface DepthData {
  pair: string;
  midPrice: number;
  spread: number;
  spreadPct: number;
  imbalance: number;         // [-1, 1]. Positive = bid-heavy (buy pressure)
  imbalancePct: number;      // imbalance * 100, rounded to 1 decimal
  totalBidSize: number;
  totalAskSize: number;
  bids: DepthLevel[];        // sorted DESC from mid (best bid first)
  asks: DepthLevel[];        // sorted ASC from mid (best ask first)
  reading: string;           // Genesis label: "BUY PRESSURE HIGH" | "SELL WALL DETECTED" | ...
  readingColor: string;      // hex color matching reading
  readingBg: string;         // rgba background for reading hero
  signals: {
    buyPressure: boolean;
    sellPressure: boolean;
    sellWall: boolean;
    bidWall: boolean;
    thinLiquidity: boolean;
    absorptionZone: boolean;
    momentumBuilding: boolean;
  };
  fetchedAt: string;         // ISO timestamp
}
```

---

## Server-Side Signal Computation (`liquidityMatrix.mjs`)

### Genesis Reading labels (priority order — first match wins)

| Condition | Label | Color |
|-----------|-------|-------|
| `totalBidSize + totalAskSize < 5` | `THIN LIQUIDITY` | `#6b7280` |
| `safeMode OR riskBand=CRITICAL` | `RISK-OFF` | `#ef4444` |
| `maxAskSize >= avgAskSize × 4` | `SELL WALL DETECTED` | `#ef4444` |
| `maxBidSize >= avgBidSize × 4` | `BID WALL DETECTED` | `#f97316` |
| `imbalance > 0.30` | `BUY PRESSURE HIGH` | `#22c55e` |
| `imbalance < -0.30` | `SELL PRESSURE HIGH` | `#ef4444` |
| `imbalance > 0.15` | `MOMENTUM BUILDING` | `#a855f7` |
| `bidDepth3 / midPrice > 0.003` (large bid cluster near mid) | `ABSORPTION ZONE` | `#3b82f6` |
| default | `BALANCED BOOK` | `#6b7280` |

### Order Flow Signals

```javascript
signals = {
  buyPressure:    imbalance > 0.20,
  sellPressure:   imbalance < -0.20,
  sellWall:       maxAskSize >= avgAskSize * 4,
  bidWall:        maxBidSize >= avgBidSize * 4,
  thinLiquidity:  (totalBidSize + totalAskSize) < 5,
  absorptionZone: bidDepth3 / midPrice > 0.003,
  momentumBuilding: imbalance > 0.15 && imbalance <= 0.30,
}
```

### Cache

```javascript
// In-module cache — avoids hammering Binance
let _cache = { data: null, ts: 0 };
const CACHE_TTL_MS = 3000;

// Shared state for confidence engine
export let _lastOrderFlow = null;

export function getOrderFlowState() {
  return _lastOrderFlow;  // { imbalance, signals, reading, pair, ts }
}
```

---

## Confidence Engine Integration (`marketIntelligence.mjs`)

`getMarketIntelligence()` imports `getOrderFlowState()` and merges order flow
signals into its output:

```javascript
import { getOrderFlowState } from './liquidityMatrix.mjs';

// Inside getMarketIntelligence():
const orderFlow = (() => {
  try { return getOrderFlowState(); } catch { return null; }
})();

// Merge into return object:
return {
  // ...existing fields...
  orderFlow: orderFlow ? {
    imbalance: orderFlow.imbalance,
    reading: orderFlow.reading,
    signals: orderFlow.signals,
    pair: orderFlow.pair,
  } : null,
};
```

This exposes depth signals to any system that calls `getMarketIntelligence()`
(including future confidence engine upgrades).

---

## Component Design — `LiquidityMatrix.tsx`

```
┌─────────────────────────────────────────────┐
│ GENESIS READING     BUY PRESSURE HIGH       │  hero bar, color-bg
├─────────────────────────────────────────────┤
│ IMBALANCE  [████████▓░░░░░░] +23%           │  progress bar
│                         SELL          BUY   │
├─────────────────────────────────────────────┤
│ ASKS                                        │  section header (dim red)
│ 65,004.00  ░░░░░          0.34              │  thin bar
│ 65,003.00  ░░░░░░░░░░     0.82              │
│ 65,002.50  ████████████   2.10  WALL        │  full bar + wall badge
│ 65,001.00  ░░░░░░         0.44              │
├─────────────────────────────────────────────┤
│ $65,000.50                    spread 0.04%  │  mid price line
├─────────────────────────────────────────────┤
│ BIDS                                        │  section header (dim green)
│ 65,000.00  ██████████░░   1.12              │  strong bid
│ 64,999.00  ░░░░░░         0.55              │
│ 64,997.00  ████████████   2.05  WALL        │  bid wall
│ 64,995.00  ░░░            0.24              │
├─────────────────────────────────────────────┤
│ BUY PRESSURE  SELL WALL  MOMENTUM           │  signal chips
└─────────────────────────────────────────────┘
```

### Rendering rules

- **Bar width**: `pct * 100%` of the row's bar container (right-aligned for asks, left-aligned for bids)
- **Bar opacity**: `isWall ? 0.35 : 0.12` — walls are more visible
- **WALL badge**: orange `#f97316`, only shown when `isWall === true`
- **Best bid/ask row** (closest to mid): slightly brighter text
- **Signal chips**: only render chips for `true` signals. Empty if all false.
- **Empty state**: "Fetching depth…" centered, no spinner
- **Error state**: "Depth unavailable" in dim gray — never crashes

### Performance

- `useReducer` — only re-renders on new `fetchedAt` (reference comparison)
- `useCallback` for poll function
- `clearInterval` on unmount
- No animation except the reading hero background transition (`transition: background 0.3s`)

---

## `RightPanel.tsx` Component

```typescript
type Tab = 'INTEL' | 'DEPTH';

interface Props {
  pair?: string;        // current chart pair e.g. "BTCUSDT"
  className?: string;
}

export function RightPanel({ pair = 'BTCUSDT', className = '' }: Props)
```

- Owns `useState<Tab>('INTEL')` — default shows INTEL (no breaking change)
- Tab bar: two buttons, active tab has purple underline (`#a855f7`)
- Renders `<MarketIntelPanel className="..." />` or `<LiquidityMatrix pair={pair} className="..." />`
- Full height flex column, no overflow issues

---

## Polling Strategy

| Component | Interval | Rationale |
|-----------|----------|-----------|
| LiquidityMatrix | 4000ms | Order book stale after ~5s anyway |
| Server cache | 3000ms | Buffer against Binance rate limit |
| MarketIntelPanel | 30000ms | Unchanged |
| ExecutionFeed | 5000ms | Unchanged |
| CryptoLabView overview | 15000ms | Unchanged |

---

## Binance Depth Endpoint

```
GET https://api.binance.com/api/v3/depth?symbol=BTCUSDT&limit=20
```
- Public, no auth required
- Returns `{ lastUpdateId, bids: [[price, qty], ...], asks: [[price, qty], ...] }`
- `limit` options: 5, 10, 20, 50, 100. We use 20 (10 each side visible, some buffer)
- Rate limit: 1200 weight/min. Weight for limit=20: 1. At 4s polling: 15/min per pair. Safe.

---

## What Is NOT Built

- No WebSocket streaming from Binance (uses polling instead)
- No trade history aggregation (tape/prints)
- No full price ladder canvas visualization
- No multi-pair simultaneous depth (single pair at a time, driven by current chart pair)
- No spoofing detection algorithm (flagged as future work — requires historical depth snapshots)
