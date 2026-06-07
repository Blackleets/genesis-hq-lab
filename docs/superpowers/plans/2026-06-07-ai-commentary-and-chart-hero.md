# AI Commentary System + Chart Hero Layout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Genesis narrates its reasoning in a quant-desk voice (hybrid deterministic + Claude),
and Crypto Lab is reorganized so the chart is large/full-width on top with panels in a clean
row below.

**Architecture:** `commentaryEngine.mjs` narrates over `getCryptoFeedEvents()`. Layout becomes
chart-hero (row 1 full-width) + 3 panels (Commentary | Desk | Intel/Depth) in row 2. The old
bottom strip is consolidated into `DeskPanel`.

**Tech Stack:** Node ESM, React 19 + TS, Binance/SQLite, Claude Haiku (optional), node --test.

---

## Task 1 — `commentaryEngine.mjs` + tests

**Files:** Create `server/ai/commentaryEngine.mjs`, `server/tests/commentary.test.mjs`

Engine exports `getCommentary({ limit })`. Narrates events from `getCryptoFeedEvents()`,
computes confidence deltas, applies rate limiting, injects a `DESK_SUMMARY` (Claude
fire-and-forget, 5-min cache, deterministic fallback).

Tests cover: event→type classification, confidence delta "A → B", dedupe + per-type floor,
deterministic fallback summary.

Commit: `feat(commentary): commentary engine + tests`

## Task 2 — `/api/crypto/commentary` route
**Files:** Modify `server/index.mjs`. Import `getCommentary`, add route returning
`{ ok, commentary }`. Commit: `feat(commentary): GET /api/crypto/commentary`

## Task 3 — client `loadCommentary` + cleanup
**Files:** Modify `src/services/cryptoClient.ts`. Add `CommentaryItem` + `loadCommentary()`.
Remove `FeedEvent` + `loadCryptoFeed` (orphaned). Commit: `feat(commentary): loadCommentary client`

## Task 4 — `CommentaryFeed.tsx`
**Files:** Create `src/components/crypto/CommentaryFeed.tsx`. Poll 5s, merge by id, max 120,
auto-scroll, expandable detail, type color-coding, DESK_SUMMARY ◈ badge.
Commit: `feat(commentary): CommentaryFeed component`

## Task 5 — `ActivePositionsTerminal` noBorder prop
**Files:** Modify `src/components/crypto/ActivePositionsTerminal.tsx`. Add `noBorder?: boolean`,
apply to outer border/radius. Commit: `feat(crypto-lab): ActivePositionsTerminal noBorder`

## Task 6 — `DeskPanel.tsx`
**Files:** Create `src/components/crypto/DeskPanel.tsx`. Tabs POSITIONS | STATS. POSITIONS →
ActivePositionsTerminal noBorder. STATS → pnl-by-asset + params + recent trades + optimizer
(moved from CryptoLabView). Props `{ data, es, className? }`. Commit: `feat(crypto-lab): DeskPanel`

## Task 7 — CryptoLabView reorg + index.css
**Files:** Modify `src/workflows/CryptoLabView.tsx`, `src/index.css`. Chart-hero grid, 3 bottom
panels, remove old bottom strip. Update grid CSS classes. Commit: `feat(crypto-lab): chart-hero layout`

## Task 8 — delete ExecutionFeed + build/test
**Files:** Delete `src/components/crypto/ExecutionFeed.tsx`. Run build + test. Commit + push.
