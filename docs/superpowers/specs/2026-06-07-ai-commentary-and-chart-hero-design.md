# Genesis AI Commentary System + Chart Hero Layout — Design Spec

> Date: 2026-06-07. Approved by principal engineer.

## Goals

1. **AI Commentary System** — Genesis narrates its own reasoning in real time, in a
   professional quant-desk voice. No hype, only real reasoning derived from real state.
2. **Chart Hero Layout** — Reorganize Crypto Lab so the TradingView chart is large and
   full-width on top (like the old version), with the new panels organized in a clean
   row below it. The old bottom data strip is consolidated into a tabbed panel.

Both ship together because the commentary feed needs a home in the reorganized layout.

---

## Part A — AI Commentary System

### Architecture: narration layer over existing event infrastructure

`commentaryEngine.mjs` sits on top of `getCryptoFeedEvents()` (which already merges
real `operator_events` + synthetic trade events). It enriches raw events into narrated
commentary, computes deltas from real state, and adds a Claude desk-summary line.

Generation is **hybrid**:
- **Deterministic layer (default)** — templates keyed by event type, with computed deltas
  (e.g. confidence `81 → 69`). Zero hype, zero hallucination, instant, no API cost.
- **Claude layer (periodic)** — a single `DESK_SUMMARY` line regenerated at most once per
  5 minutes, only when there has been new meaningful activity, **fire-and-forget** so it
  never blocks the HTTP response. Falls back to a deterministic summary when no API key.

### New file: `server/ai/commentaryEngine.mjs`

**Exports:**
```javascript
export async function getCommentary({ limit = 40 } = {}): Promise<CommentaryItem[]>
```

**CommentaryItem shape:**
```javascript
{
  id:       string,    // stable id derived from source event id
  ts:       string,    // ISO timestamp
  type:     CommentaryType,
  text:     string,    // short narration (the headline)
  detail:   string,    // optional longer context for expandable view ('' if none)
  severity: 'INFO' | 'WARNING' | 'HIGH' | 'CRITICAL',
  source:   'deterministic' | 'llm',
}
```

**CommentaryType (Part 2):**
```
SCANNING · ANALYZING · SIGNAL_FOUND · TRADE_REJECTED · TRADE_OPENED ·
TP_HIT · SL_HIT · EARLY_EXIT · SAFE_MODE · LEARNING_UPDATE · DESK_SUMMARY
```

**Event → CommentaryType mapping (Part 3 of deliverable):**

| Source signal (reason / category / metadata) | Type | Example narration |
|----------------------------------------------|------|-------------------|
| reason includes `SCANNING` / `ANALYZING` + SCAN category | `SCANNING` / `ANALYZING` | "Scanning 4 pairs. No qualified setup." |
| reason includes `SIGNAL` / `EV CHECK` pass | `SIGNAL_FOUND` | "BTC long setup. EV +2.1%, conf 74%." |
| reason includes `BLOCKED` / `REJECTED` / `EV insufficient` | `TRADE_REJECTED` | "Kalshi EV insufficient. Rejected." |
| reason includes `OPENED` (trade open) | `TRADE_OPENED` | "LONG BTC opened. Entry $62,840, conf 74%." |
| exit_reason `take_profit` | `TP_HIT` | "TP hit · BTC +$2.40." |
| exit_reason `stop_loss` | `SL_HIT` | "SL hit · ETH -$1.80." |
| exit_reason `confidence_collapse` / `timeout` | `EARLY_EXIT` | "Early exit · momentum faded. BTC +$0.30." |
| reason includes `SAFE_MODE` / RISK CRITICAL | `SAFE_MODE` | "Safe mode active. Trading paused." |
| category `LEARNING` | `LEARNING_UPDATE` | "Lesson logged: avoid low-volume scalps." |
| (synthesized) periodic Claude/deterministic synthesis | `DESK_SUMMARY` | "Desk: neutral regime, low vol. Holding." |

**Confidence delta narration:** the engine keeps a module-level `_lastConfidence` (number
or null). On each `getCommentary` call it reads `getConfidenceDiagnostics().lastScore`. If
it changed by ≥ 5 points since last reported, it emits an `ANALYZING` item:
`"Confidence ${prev} → ${curr}."` with `detail` naming the band. This is the
"Confidence dropped 81 → 69" behavior, computed from real state.

**Rate limiting (Part 5 — no spam):**
- **Dedupe:** never emit a line whose `type+text` equals the immediately preceding emitted
  line (tracked via module-level `_lastEmittedKey`).
- **Per-type min interval:** each type has a floor (e.g. `SCANNING`/`ANALYZING` = 60s,
  others = 0). Tracked in module-level `_lastTypeTs: Record<type, ms>`. An item younger
  than the floor for its type is dropped.
- **DESK_SUMMARY cadence:** max once / 5 min via `_summaryCache = { text, ts, source }`.

**Claude desk summary (hybrid):**
```javascript
// Module-level cache
let _summaryCache = { text: null, ts: 0, source: 'deterministic' };
const SUMMARY_TTL_MS = 5 * 60 * 1000;

// In getCommentary: if cache stale AND meaningful activity since last summary:
//   - immediately use current cache (or deterministic fallback) for THIS response
//   - fire-and-forget regenerate via Claude (updates _summaryCache for NEXT poll)
// Deterministic fallback summary built from getMarketIntelligence():
//   `Desk: ${momentum} momentum, ${volatility} vol, ${regime} regime. ${recommendation}.`
```
The Claude call uses the existing Anthropic helper pattern (model `claude-haiku-4-5-20251001`),
a tight system prompt enforcing ≤ 140 chars, factual quant-desk tone, no hype. On any error
it leaves the deterministic fallback in place.

**Personality (Part 4):** short, factual, quant-desk. No emojis in `text`. No exclamation
marks. Numbers and deltas preferred over adjectives.

### New route: `GET /api/crypto/commentary?limit=40`
Returns `{ ok: true, commentary: CommentaryItem[] }`. On error `{ ok: false, error }`.

### Client: `loadCommentary()` in `cryptoClient.ts`
```typescript
export interface CommentaryItem {
  id: string; ts: string; type: string; text: string;
  detail: string; severity: string; source: 'deterministic' | 'llm';
}
export async function loadCommentary(limit = 40): Promise<CommentaryItem[]>
```
Returns `[]` on error.

### Client: `src/components/crypto/CommentaryFeed.tsx` (new)
Replaces `ExecutionFeed` in the layout. Polls `loadCommentary(40)` every **5s**.
- `useReducer` merge: only adds items with new ids, newest-first, max 120.
- Auto-scroll to top when user is at top (same pattern as ExecutionFeed).
- Each row: timestamp · type icon · narration text. Color-coded by type.
- **Expandable detail:** clicking a row with a non-empty `detail` toggles an expanded
  block showing the detail text. Tracked in component state (`Set<expandedId>`).
- `DESK_SUMMARY` rows show a ◈ badge and a faint purple tint to mark Claude synthesis.
- Empty state: "Waiting for genesis reasoning…"

### Cleanup
- Delete `src/components/crypto/ExecutionFeed.tsx` (fully superseded).
- Remove `loadCryptoFeed` + `FeedEvent` from `cryptoClient.ts` (orphaned after deletion).
- Keep `server/crypto/marketIntelligence.mjs::getCryptoFeedEvents` and the
  `/api/crypto/feed` route (reused server-side by the commentary engine).

---

## Part B — Chart Hero Layout (Option A)

### Target structure

```
┌──────────────────────────────────────────────────────────────┐
│ Header strip (Genesis HQ · Crypto Terminal · PnL · status)    │  shrink-0
├──────────────────────────────────────────────────────────────┤
│                                                              │
│        TRADINGVIEW CHART — full width, tall (HERO)             │  row 1 ≈ 1.7fr
│                                                              │
├───────────────────┬──────────────────────┬───────────────────┤
│  AI COMMENTARY     │  DESK PANEL          │  INTEL | DEPTH    │  row 2 ≈ 0.9fr
│  (CommentaryFeed)  │  POSITIONS | STATS   │  (RightPanel)     │
└───────────────────┴──────────────────────┴───────────────────┘
```

The separate full-width bottom data strip (PnL/params/trades) is **removed**; its content
moves into the new `DeskPanel` (STATS tab). This is what frees the vertical space that
makes the chart large again.

### CSS grid (replaces `.crypto-terminal-grid` rules in `index.css`)

```css
.crypto-terminal-grid {
  flex: 1;
  display: grid;
  grid-template-columns: 240px 1fr 220px;
  grid-template-rows: 1.7fr 0.9fr;
  gap: 4px;
  padding: 4px;
  overflow: hidden;
  min-height: 0;
}
.crypto-zone-chart      { grid-column: 1 / -1; grid-row: 1; min-height: 0; overflow: hidden; }
.crypto-zone-commentary { grid-column: 1;      grid-row: 2; min-height: 0; overflow: hidden; }
.crypto-zone-desk       { grid-column: 2;      grid-row: 2; min-height: 0; overflow: hidden; }
.crypto-zone-intel      { grid-column: 3;      grid-row: 2; min-height: 0; overflow: hidden; }
```

The chart spans the full width of row 1 (hero). The three panels fill row 2.
`CandleChart` already fills its cell (responsive height fix from the previous task), so the
hero row gives it maximum size.

### New file: `src/components/crypto/DeskPanel.tsx`
Tabbed consolidation of the old bottom strip + active positions:
- Tabs: `POSITIONS` | `STATS`
- `POSITIONS` → renders `ActivePositionsTerminal` (existing component, `noBorder`)
- `STATS` → renders the old bottom-strip content compactly: PnL by asset, strategy params
  (with optimized/defaults badge), recent trades (5), optimizer heartbeat. This content is
  **moved verbatim** out of `CryptoLabView` into `DeskPanel` so nothing is lost.

`DeskPanel` Props: `{ data: CryptoOverview | null; es: boolean; className?: string }`.
It owns its tab state. Default tab: `POSITIONS`.

`ActivePositionsTerminal` gains an optional `noBorder?: boolean` prop (same pattern as
LiquidityMatrix) so it nests cleanly inside DeskPanel without a double border.

### `CryptoLabView.tsx` changes
- Header strip: unchanged.
- Grid body becomes the 3-zone-below-hero structure:
  ```tsx
  <div className="crypto-terminal-grid">
    <div className="crypto-zone-chart">
      <CandleChart positions={data?.positions ?? []} onManualOrder={handleManualOrder} />
    </div>
    <div className="crypto-zone-commentary"><CommentaryFeed /></div>
    <div className="crypto-zone-desk"><DeskPanel data={data} es={es} /></div>
    <div className="crypto-zone-intel"><RightPanel /></div>
  </div>
  ```
- The old `<div className="crypto-zone-feed">`, `<div className="crypto-zone-positions">`,
  and the entire bottom `data strip` block are removed (content relocated to DeskPanel).
- `ActivePositionsTerminal` is no longer imported directly by CryptoLabView (DeskPanel owns it).

### Removed CSS classes
`.crypto-zone-feed` and `.crypto-zone-positions` are deleted from `index.css` (replaced by
`.crypto-zone-commentary` and `.crypto-zone-desk`).

---

## Data Flow (combined)

```
operator_events + trades (real, SQLite)
  → getCryptoFeedEvents()                       [existing]
  → commentaryEngine.getCommentary()            [new: narrate + deltas + Claude summary]
  → GET /api/crypto/commentary
  → loadCommentary()                            [client]
  → CommentaryFeed (poll 5s, auto-scroll, expandable)   [left of bottom row]

Binance depth → liquidityMatrix → /api/crypto/depth → RightPanel DEPTH tab  [existing]
system state  → marketIntelligence → /api/crypto/market-intelligence → RightPanel INTEL tab
crypto overview → /api/crypto/overview → CryptoLabView → DeskPanel (POSITIONS | STATS)
Binance klines → CandleChart (hero, full-width)
```

---

## Validation

- `npm run build` — 0 TypeScript errors.
- `npm test` — all existing tests pass + new commentary engine tests.
- New tests in `server/tests/commentary.test.mjs`:
  - event→type classification (each reason maps to the right CommentaryType)
  - confidence delta narration produces "A → B" when score moves ≥ 5
  - rate limiting: identical consecutive line is dropped; per-type floor drops rapid repeats
  - deterministic fallback summary is produced when no API key
- Manual: chart is large/full-width; commentary narrates in quant-desk voice; expandable
  detail works; DESK panel POSITIONS/STATS tabs hold all old data; no layout dead space.

---

## What is NOT built
- No WebSocket push for commentary (polling, consistent with the rest of the app).
- No per-user commentary history/persistence beyond `operator_events` (the source of truth).
- No multi-language commentary (English quant-desk voice only; UI chrome stays bilingual).
- No streaming Claude tokens (single cached summary line, fire-and-forget).
