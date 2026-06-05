# P0 — Learning Loop 100% Robusto + Real Trading Ready

**Date:** 2026-06-05
**Status:** Approved
**Scope:** Safety infrastructure to make the learning loop crash-proof and enable real trading when ready

---

## Problem

Genesis HQ has a complete SCAN→VETO→DEBATE→EXECUTE pipeline with real market data and real Claude decisions — but 4 critical gaps mean the learning loop loses data on every crash/restart:

1. **Drawdown circuit breaker resets** — peak capital is in-memory; a restart thinks everything is fine even after a 14% drawdown
2. **Open trades become orphans** — markets that resolved during downtime stay "open" forever; no P&L, no lesson, no capital freed
3. **Org state vanishes** — "pause trading" commands don't survive a restart
4. **No crash visibility** — if the trading loop dies, nobody knows

Additionally, real trading (Kalshi) has a silent failure mode: real order fails → paper fill saved → dashboard shows "success" that never happened.

---

## Goals

### Phase 1 (now — no Kalshi key required)
- Circuit breaker survives restarts
- Every closed market generates a lesson (zero orphan trades)
- Org commands (pause, mode, focus) survive restarts
- Crashes are logged and health endpoint reflects system state

### Phase 2 (when KALSHI_API_KEY is added)
- Real Kalshi failures are loud, not silent
- Write endpoints are protected by API_SECRET

---

## Architecture

No new processes. No new dependencies. All changes are in-process modifications to existing server files, writing to the existing SQLite database.

### New Database Tables (idempotent — `CREATE TABLE IF NOT EXISTS`)

```sql
-- Persists peak capital and heartbeat timestamp
CREATE TABLE IF NOT EXISTS risk_state (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Persists org mode, department state, focus, goal
CREATE TABLE IF NOT EXISTS org_state (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Both tables added to `server/db/schema.sql`. Schema runs on startup via `CREATE TABLE IF NOT EXISTS` — no migration runner needed.

---

## Component Changes

### P0.1 — Persistent Circuit Breaker
**File:** `server/trading/riskManager.mjs`

Add two functions:
- `loadPeakCapital()` — reads from `risk_state` on module init; returns null if no record
- `savePeakCapital(peak)` — writes to `risk_state` after every capital update

The existing drawdown check logic is unchanged. Only the source of `peakCapital` changes: memory → SQLite.

On startup: peak = DB value (or current capital if no record).
After every trade close: if new capital > peak, save new peak to DB.

### P0.2 — Startup Position Reconciliation
**File:** `server/agentRunner.mjs`

New function `reconcileOpenPositions()` called ONCE at startup, before the first scan cycle.

```
Algorithm:
1. SELECT all trades WHERE status='open' AND market_source IN ('polymarket', 'kalshi')
2. For each:
   a. Call getMarketStatus(market_id, source)
   b. If resolved → closeTrade() + settleTradeCapital() + analyzeClosedTrade()
      This generates the lesson and updates agent skills
   c. If market closed but no resolution → UPDATE status='expired', refund capital_used
   d. If market still active → no-op

3. SELECT all trades WHERE status='open' AND market_source='crypto'
4. For each:
   a. Fetch current price from Binance
   b. If elapsed time > timeoutHours → close at current price (loss or gain)
   c. If price ≥ target or price ≤ stop → close accordingly
   d. Else → no-op

5. Log summary: "[startup] reconciled: Y closed with lesson, Z expired, W still open"
```

**Error handling:** If `getMarketStatus()` fails for a trade (network error), skip that trade and continue. Log the skip. Do not halt reconciliation.

### P0.3 — Persistent Org State
**File:** `server/command/orgState.mjs`

Add `loadOrgState()` called on module init:
```javascript
// Reads all keys from org_state table, parses JSON, merges into in-memory state
```

Add `persistOrgState(key, value)` called from every setter:
```javascript
// INSERT OR REPLACE INTO org_state (key, value, updated_at) VALUES (?, ?, ?)
```

State keys persisted: `mode`, `activeDepts`, `pausedDepts`, `currentFocus`, `currentGoal`, `founderNote`, `riskLevel`, `maxOpenTrades`.

### P0.6 — Monitoring
**File:** `server/agentRunner.mjs`

Three additions:
1. **Heartbeat write:** At the end of each `runTradingCycle()`, write `INSERT OR REPLACE INTO risk_state (key='last_heartbeat', value=ISO timestamp)`.
2. **Crash handler:** `process.on('uncaughtException', handler)` and `process.on('unhandledRejection', handler)` at the top of `agentRunner.mjs`. Handler appends to `logs/crash.log` with timestamp + full stack.
3. **Health endpoint extension:** `GET /api/health` already exists in `server/index.mjs`. Add `agentAlive` field: true if `last_heartbeat` is within 10 minutes.

### P0.5 — Kalshi Silent Failure Fix
**File:** `server/trading/execution.mjs`

When real Kalshi order fails (network error or API rejection):
- **Remove:** the fallback `saveTrade()` call (no paper fill contamination)
- **Add:** append to `logs/failed_orders.log` with timestamp, tradeProposal, error
- **Return:** `{ executed: false, mode: 'real_failed', reason: error }`

Callers of `executeTrade()` already handle `executed: false` gracefully — they log and skip.

### P0.4 — API Authentication (Phase 2)
**File:** `server/index.mjs`

Middleware added to all POST routes:
```javascript
function requireAuth(req, res, next) {
  const secret = process.env.API_SECRET;
  if (!secret) return next(); // disabled if not configured — preserves local dev
  const auth = req.headers['authorization'];
  if (auth !== `Bearer ${secret}`) return respond(res, 401, { error: 'Unauthorized' });
  next();
}
```

Applied to: `POST /api/command`, `POST /api/agents/:id/task`, `POST /api/agent/order`, `POST /api/plan`.

---

## File Map

| File | Change Type | What Changes |
|------|-------------|--------------|
| `server/db/schema.sql` | Additive | Add `risk_state` + `org_state` tables |
| `server/trading/riskManager.mjs` | Modify | Load/save peak capital from SQLite |
| `server/agentRunner.mjs` | Modify | Add reconcileOpenPositions() + heartbeat write + crash handler |
| `server/command/orgState.mjs` | Modify | Load from SQLite on init, persist on every write |
| `server/trading/execution.mjs` | Modify | Fix silent Kalshi failure (no paper fill on real failure) |
| `server/index.mjs` | Modify | Add auth middleware for POST routes |
| `logs/` (new dir) | Create | crash.log, failed_orders.log (gitignored) |

---

## Error Handling

- **reconcileOpenPositions:** Individual trade failures skip with a log. Never halts startup.
- **loadPeakCapital:** If table is empty, returns null → treated as "no history" → peak = current capital.
- **loadOrgState:** If table is empty, all defaults apply. No crash.
- **savePeakCapital / persistOrgState:** Sync SQLite writes (better-sqlite3) — if write fails, log and continue. Do not throw.
- **Crash handler:** Must not throw itself. Wrap in try/catch. Always exit with code 1 after logging.

---

## Testing

1. **Circuit breaker persistence:** Start server, let it trade, stop, restart. Verify `/api/trading/risk` shows correct drawdown from pre-restart peak.
2. **Reconciliation:** Manually insert an `status='open'` trade for a resolved market into SQLite. Restart server. Verify trade is closed + lesson appears in `/api/agent/lessons`.
3. **Org state:** Send `POST /api/command { command: "pause crypto trading" }`. Restart server. Verify `/api/command/status` still shows crypto paused.
4. **Health heartbeat:** Start server, check `/api/health` shows `agentAlive: true`. Stop agentRunner manually. Wait 10 minutes. Check `agentAlive: false`.
5. **Kalshi failure:** Set REAL_TRADING=true, use invalid KALSHI_API_KEY. Trigger a trade. Verify: no paper fill in DB, `logs/failed_orders.log` has entry, trade not in `/api/agent/trades`.

---

## Out of Scope

- Polymarket real execution (too complex for this phase)
- Crypto real trading via Binance spot API
- Slack webhook notifications (external dependency)
- Frontend changes (all changes are server-only)
- Test suite (integration tests are P1.4 in the roadmap)
