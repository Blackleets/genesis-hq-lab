# Phase 0 — Execution Truth Audit
> Generated: 2026-06-06 | Read-only audit of all execution-related financial state

---

## SECTION A — REAL DATA (SQLite-backed, authoritative)

| Value | File | Source | Notes |
|-------|------|--------|-------|
| Treasury total capital | `server/trading/treasury.mjs:44` | `SELECT * FROM capital_history ORDER BY recorded_at DESC LIMIT 1` | ✅ REAL |
| Treasury available capital | same | same row `.available` | ✅ REAL |
| Treasury in-trades capital | same | same row `.in_trades` | ✅ REAL |
| Peak capital (drawdown denominator) | `treasury.mjs:276` | `SELECT MAX(total) FROM capital_history` | ✅ REAL |
| Capital history (chart data) | `treasury.mjs:323` | `SELECT … FROM capital_history ORDER BY recorded_at DESC LIMIT 100` | ✅ REAL |
| Realized PnL (all closed trades) | `treasury.mjs:282-319` | `SELECT SUM(pnl) FROM trades WHERE status='closed'` | ✅ REAL |
| Win rate | `analytics.mjs:30-32` | `SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) / COUNT(*)` | ✅ DERIVED_SQLITE |
| Brier score (calibration) | `analytics.mjs:47-77` | Mean squared error of confidence vs actual outcome | ✅ DERIVED_SQLITE |
| Sharpe ratio | `analytics.mjs:83-111` | Per-trade returns, annualized | ✅ DERIVED_SQLITE |
| Open trade list | `tradingMemory.mjs:75` | `SELECT … FROM trades WHERE status='open'` | ✅ REAL |
| Closed trade list | `tradingMemory.mjs:83` | `SELECT … FROM trades WHERE status='closed'` | ✅ REAL |
| Trade attribution context | `trades.reason, evidence, confidence, signals_used` | Written at trade creation time | ✅ REAL |
| Capital bucket allocations | `capital_history.bucket_*` | Written by `settleTradeCapital()` | ✅ REAL |

---

## SECTION B — DEGRADED / STALE DATA

### B1 — Unrealized PnL (sync path) — HARDCODED ZERO ⚠️
**File:** `server/trading/treasury.mjs:219-228`
```javascript
function getUnrealizedPnl() {
  // Conservative: assume current price = entry price (no change)
  return 0;  // ← ALWAYS ZERO, not "unknown"
}
```
**Problem:** `getTreasury()` (the sync fast path) always reports `unrealizedPnl: 0`.
When there are open prediction market positions, the real unrealized PnL could be non-zero.
The async path (`getUnrealizedPnlAsync`) is correct — fetches live prices.
**Risk:** MEDIUM — the number shown is wrong (0 vs actual), but labeled as P&L.
**Fix:** Return `null` instead of `0` to signal "data unavailable" (degraded state).

### B2 — API /api/agent/status fallback — HARDCODED $10k ⚠️
**File:** `server/index.mjs:248`
```javascript
catch {
  sendJson(res, 200, { ok: true, capital: { total: 10000, available: 10000 }, ... });
}
```
**Problem:** When `getSnapshot()` throws, the endpoint returns `ok: true` with fake $10k capital.
Any consumer of this endpoint during a backend error gets false data with no error signal.
**Risk:** HIGH — fake financial data served as real, error masked as OK.
**Fix:** Return `{ ok: false, error: 'snapshot_unavailable' }`.

### B3 — Daily / Weekly / Rolling PnL — NOT IMPLEMENTED
**Problem:** There is no breakdown of PnL by day, week, or rolling window.
Only total-lifetime PnL is computed. A trading day with -$300 looks the same as
one with +$300 in lifetime terms if they average out.
**Risk:** MEDIUM — incomplete picture. User cannot detect daily/weekly deterioration.
**Fix:** Add `pnlEngine.mjs` with time-bucketed queries.

---

## SECTION C — DEAD LOCAL STATE (localStorage, never shown)

### C1 — genesisStore.capital
**File:** `src/core/store/genesisStore.ts:149`
```typescript
capital: 10_000,  // TODO_REAL_DATA (already flagged)
```
**Status:** Dead — `useCapital()` hook reads this but no UI component calls `useCapital()`.
All capital UI reads from `useLiveTrading()` → `/api/trading/dashboard`.
**Risk:** LOW — never reaches the screen.

### C2 — genesisStore.positions / closedPositions
**File:** `src/core/store/genesisStore.ts:150-151`
```typescript
positions: {},
closedPositions: [],  // TODO_REAL_DATA (already flagged)
```
**Status:** Dead — `usePositions()` never called by UI. Backend SQLite is authoritative.
**Risk:** LOW — never reaches the screen.

### C3 — genesisStore.capitalHistory
**File:** `src/core/store/genesisStore.ts:152`
```typescript
capitalHistory: [{ at: now, value: 10_000 }],  // TODO_REAL_DATA (already flagged)
```
**Status:** Dead — no chart uses this. `CapitalChart` reads from `useLiveTrading().capitalHistory`.
**Risk:** LOW — never reaches the screen.

### C4 — memoryStore.mjs capital.json / trades.json
**File:** `server/memoryStore.mjs`
```javascript
return read('capital.json', { total: 10000, available: 10000, ... });
```
**Status:** Legacy JSON file store, parallel to SQLite. Still imported by index.mjs
for `/api/agent/status` fallback (which is the B2 bug above).
**Risk:** MEDIUM — dual source of truth. If both are read, the older (JSON) wins on fallback.
**Fix:** Remove the fallback entirely (see B2 fix). JSON store becomes vestigial.

---

## SECTION D — FINANCIAL INTEGRITY GAPS

### D1 — No stale position detection
Open trades older than N days with no price update are not flagged.
If an agent runner crash leaves trades "open" permanently, capital is over-allocated.
**Risk:** HIGH (on real money). LOW (paper only mode).

### D2 — No orphan position reconciliation on startup
Addressed in roadmap (BLOCKER-04 from previous audit). Not yet fixed.
**Risk:** HIGH (on real money). LOW (paper only mode).

### D3 — No daily/weekly PnL attribution
Cannot answer "how did we do this week?" or "is Monday worse than Friday?".
**Risk:** LOW (operational visibility issue, not correctness issue).

### D4 — Average risk/reward not computed
Know win rate but not R:R ratio. A 60% win rate with 0.3:1 R:R is losing money.
**Risk:** MEDIUM (incomplete edge assessment).

### D5 — Drawdown peak is in-memory only
BLOCKER-03 from previous audit. Not fixed. Not addressed in this phase.
**Risk:** HIGH (on real money). Tagged for P0 fix in blockers list.

---

## SECTION E — FIX PRIORITY

### P0 (this PR) — correctness fixes
1. Fix B2: `/api/agent/status` fallback — no more fake $10k
2. Fix B1: `getUnrealizedPnl()` → return `null` (degraded), not `0`
3. Add `server/memory/pnlEngine.mjs` — daily/weekly/rolling/attribution
4. Expose `GET /api/pnl/summary` and `GET /api/pnl/attribution`
5. Extend truth layer with execution diagnostics
6. Add structured logs for stale/orphan/mismatch states

### P1 (next)
1. Fix BLOCKER-03: persist drawdown peak to SQLite
2. Add stale position alert to health endpoint
3. Fix BLOCKER-04: startup reconciliation for open trades

### P2 (later)
1. Remove `memoryStore.mjs` JSON file layer entirely
2. Remove dead genesisStore local capital/positions state

---

## Summary Matrix

| Financial Value | Source | Shown in UI | Accurate | Risk |
|----------------|--------|-------------|----------|------|
| Capital (total) | SQLite treasury | ✅ Dashboard, TopBar | ✅ Yes | None |
| Capital (available) | SQLite treasury | ✅ Dashboard | ✅ Yes | None |
| Realized PnL | SQLite trades | ✅ Dashboard | ✅ Yes | None |
| Win rate | Computed from SQLite | ✅ Dashboard | ✅ Yes | None |
| Unrealized PnL (sync) | HARDCODED 0 | ✅ Treasury view | ❌ Always 0 | Medium |
| Unrealized PnL (async) | Live API prices | ✅ /api/trading/treasury | ✅ Yes | Low |
| Daily PnL | NOT COMPUTED | ❌ Not shown | N/A | Medium |
| Weekly PnL | NOT COMPUTED | ❌ Not shown | N/A | Medium |
| Avg risk/reward | NOT COMPUTED | ❌ Not shown | N/A | Medium |
| /api/agent/status capital | HARDCODED on error | ✅ (wrong!) | ❌ Fake | HIGH |
| Open positions | SQLite trades | ✅ Dashboard | ✅ Yes | None |
| Capital history | SQLite capital_history | ✅ Chart | ✅ Yes | None |
| Brier score | Computed from SQLite | ✅ Edge scorecard | ✅ Yes | None |
| Agent accuracy | Computed from SQLite | ✅ Agents view | ✅ Yes | None |
