# Trade Storytelling Overlay — Design Spec

> Date: 2026-06-07. Approved.

## Goal
The Genesis chart explains trades visually: entry/exit markers, an AI-context story card,
and a clickable trade timeline that can replay prior trades.

## Decisions
- **AI context scope:** use only data already persisted per trade (side, entry/exit/target/stop,
  confidence, reason, evidence, exit_reason, pnl, opened_at, closed_at). risk_score and market
  regime are NOT persisted per trade → shown as "—" (honest, no fabrication, no backend schema change).
- **Placement:** markers + floating story card on the chart, plus a TRADES tab (clickable timeline)
  in DeskPanel. State is lifted to CryptoLabView so both react to the same selection.

## Architecture: state-lifted, server-fed, thin client

```
trades table (real, SQLite)
  → tradeHistory.getTradeStories({ limit, pair })   [new server module]
  → GET /api/crypto/trades
  → loadTradeStories()                              [client]
  → CryptoLabView owns { tradeStories, selectedTradeId }
       ├── CandleChart: markers (createSeriesMarkers v5) + click-select + story card + replay
       └── DeskPanel TRADES tab: clickable timeline → onSelectTrade
```

## Files

| Action | File | Responsibility |
|--------|------|----------------|
| CREATE | `server/crypto/tradeHistory.mjs` | `getTradeStories({ limit, pair })` — full per-trade story fields |
| CREATE | `server/tests/tradeHistory.test.mjs` | classification helpers (exitKind, markerFor) |
| MODIFY | `server/index.mjs` | `GET /api/crypto/trades` route |
| MODIFY | `src/services/cryptoClient.ts` | `TradeStory` interface + `loadTradeStories()` |
| MODIFY | `src/dashboard/charts/CandleChart.tsx` | markers, click-select, story card overlay, replay |
| MODIFY | `src/components/crypto/DeskPanel.tsx` | TRADES tab with clickable timeline |
| MODIFY | `src/workflows/CryptoLabView.tsx` | own tradeStories + selectedTradeId; wire to both |

## Data: `TradeStory`

```typescript
interface TradeStory {
  id:           string;
  pair:         string;
  side:         'LONG' | 'SHORT';
  entry_price:  number;
  exit_price:   number | null;
  target_price: number | null;
  stop_price:   number | null;
  pnl:          number | null;
  confidence:   number;        // 0–1
  reason:       string;
  evidence:     string[];      // parsed from JSON
  exit_reason:  string | null; // take_profit | stop_loss | timeout | confidence_collapse | ...
  opened_at:    string;        // ISO
  closed_at:    string | null; // ISO
  status:       string;        // open | closed | ...
}
```

Server query (crypto trade types only), newest first, optional pair filter:
```sql
SELECT id, asset_pair, outcome, entry_price, exit_price, target_price, stop_price,
       pnl, confidence, reason, evidence, exit_reason, opened_at, closed_at, status
FROM trades
WHERE trade_type IN ('crypto_scalp','scalp_v2','swing_v1')
  [AND asset_pair = ?]
ORDER BY COALESCE(closed_at, opened_at) DESC
LIMIT ?
```
`evidence` is JSON-parsed to `string[]` (fallback `[]`). `outcome` maps to `side`.

## Markers (lightweight-charts v5 `createSeriesMarkers`)

For each trade whose pair === current chart pair:
- **Entry:** time = opened_at (unix s). LONG → `{ position:'belowBar', shape:'arrowUp', color:'#22c55e', text:'LONG' }`. SHORT → `{ position:'aboveBar', shape:'arrowDown', color:'#a855f7', text:'SHORT' }`.
- **Exit (if closed):** time = closed_at. shape `circle`. Color + text by `exit_reason`:
  - take_profit → green `#22c55e`, text `TP`
  - stop_loss → red `#ef4444`, text `SL`
  - timeout → amber `#f59e0b`, text `EXIT`
  - confidence_collapse → orange `#f97316`, text `EXIT`
  - other/closed → gray `#9ca3af`, text `EXIT`
- Selected trade's markers get a brighter color + larger text to highlight.

Markers recomputed only on `[tradeStories, pair, tf, selectedTradeId, candlesLoadedAt]`.
A `createSeriesMarkers` primitive is created once and updated via `.setMarkers()`.

## Interaction
- **Click on chart** (`chart.subscribeClick`): pick the trade whose entry/exit time is nearest
  the clicked time (within a tolerance) → `onSelectTrade(id)`.
- **Click in TRADES timeline:** `onSelectTrade(id)`.
- **Selected →** story card overlay appears on the chart AND the chart replays:
  `timeScale().setVisibleRange({ from: opened-pad, to: (closed||now)+pad })`.
- Clicking the story card's ✕ or re-clicking the selected trade clears selection (markers reset,
  chart keeps current view).

## Story card (overlay, absolute top-right of chart canvas)
Shows: side chip · entry → exit · pnl (colored) · confidence% · regime "—" · risk "—" ·
**reason** (the thesis) · evidence list (up to 3) · duration · exit badge. Compact, ≤ 240px wide,
semi-opaque dark background, does not block chart interaction (pointer-events on card only).

## DeskPanel TRADES tab
List newest-first: time · side chip · pair · conf% · pnl · exit badge. Selected row highlighted.
Empty state: "No trades yet."

## Validation
- `npm run build` clean; `npm test` all pass + new tradeHistory tests.
- New tests: exit_reason → marker kind mapping; evidence JSON parse fallback.
- Manual: markers render for current pair; click selects; story card shows real reason/evidence;
  replay pans chart; TRADES tab selection syncs with chart; switching pair/tf keeps markers correct;
  no chart lag.

## Not built
- No per-trade risk/regime persistence (shown "—"). No animated replay playback (instant pan).
- No marker for scan/signal pre-trade events (only entries/exits, which are the persisted facts).
