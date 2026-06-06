# Genesis HQ — Priority Roadmap

> Audit date: 2026-06-05.
> Ordered by: risk to capital first, then operational stability, then velocity.
> Do NOT skip P0 items. P1 items are required for sustainable real operation.

---

## P0 — BEFORE ANY REAL MONEY (Non-Negotiable)

These are safety requirements. Running with REAL_TRADING=true without these is reckless.

### P0.1 — Persist Drawdown Peak to SQLite

**Why:** Circuit breaker resets on every restart. A crash during a bad trading period disables the primary capital protection mechanism.
**File to modify:** `server/trading/riskManager.mjs`, `server/db/schema.sql`
**Effort:** Small (~4 hours)
**Implementation:**
  1. Add `peak_capital REAL, updated_at TEXT` to a new `risk_state` table
  2. On startup: `SELECT peak_capital FROM risk_state ORDER BY updated_at DESC LIMIT 1`
  3. After each capital update: `INSERT OR REPLACE INTO risk_state (peak_capital, updated_at)`
  4. Use this persisted peak in all drawdown calculations

### P0.2 — Startup Position Reconciliation

**Why:** Open trades from a crashed session may be resolved. Capital is miscounted. New trades may overshoot position limits.
**File to modify:** `server/agentRunner.mjs`
**Effort:** Medium (~8 hours)
**Implementation:**
  1. On startup, before any scan: load all `status='open'` trades from SQLite
  2. For each: call `getMarketStatus(market_id, source)`
  3. If resolved → call `closeTrade()` + `analyzeClosedTrade()`
  4. If market closed but unresolved → mark `status='expired'`, refund capital
  5. Log reconciliation summary, then start normal cycle

### P0.3 — Persist Org State to SQLite

**Why:** Founder commands like "pause trading" or "emergency mode" vanish on restart.
**File to modify:** `server/command/orgState.mjs`, `server/db/schema.sql`
**Effort:** Small (~3 hours)
**Implementation:**
  1. Add `org_state` table: `key TEXT PRIMARY KEY, value TEXT, updated_at TEXT`
  2. On every state write in `orgState.mjs`: `INSERT OR REPLACE INTO org_state`
  3. On startup: load org state from DB before starting any cycle

### P0.4 — Add API Authentication for Write Endpoints

**Why:** Unauthenticated POST /api/command and POST /api/agents/:id/task expose trade control and Claude API budget to anyone on the network.
**File to modify:** `server/index.mjs`
**Effort:** Small (~4 hours)
**Implementation (simplest viable):**
  1. Add `API_SECRET` to `.env`
  2. Add middleware: POST routes check `Authorization: Bearer $API_SECRET`
  3. Return 401 if missing or wrong
  4. Document in `.env.example`

### P0.5 — Fix Silent Kalshi Failure

**Why:** Real order failures silently become paper fills. P&L history is contaminated.
**File to modify:** `server/trading/execution.mjs`
**Effort:** Small (~2 hours)
**Implementation:**
  1. When real Kalshi order fails: do NOT save a paper fill
  2. Return `{ executed: false, reason: error, mode: 'real_failed' }`
  3. agentRunner logs this as a hard failure
  4. Caller must handle `executed: false` gracefully (skip, alert)

### P0.6 — Add Basic Monitoring (Heartbeat + Exception Handler)

**Why:** If the trading loop crashes silently, you lose capital protection.
**File to modify:** `server/agentRunner.mjs`, `server/index.mjs`
**Effort:** Small (~4 hours)
**Implementation:**
  1. agentRunner writes heartbeat to SQLite every cycle: `INSERT INTO org_state (key='last_heartbeat', value=timestamp)`
  2. Add `process.on('uncaughtException')` and `process.on('unhandledRejection')` handlers that log to a file + send Slack webhook
  3. Optional: `/api/health` endpoint checks if last_heartbeat is within 10 minutes

---

## P1 — REQUIRED FOR REAL OPERATION

After P0 is done and tested on paper mode, implement these before scaling.

### P1.1 — Choose and Implement One Real Execution Venue

**Decision required:** Polymarket vs. Kalshi vs. Crypto

| Venue | Complexity | Status |
|-------|-----------|--------|
| Kalshi | Low — already partially implemented | Add better error handling, verify order format |
| Polymarket | High — CLOB API, wallet signing required | Full implementation needed |
| Crypto (Binance Spot) | High — full API integration | Full implementation needed |

**Recommendation:** Start with Kalshi (partial implementation exists). Verify the `placeKalshiOrder()` function with small test orders before scaling.

### P1.2 — Automate Capital Bucket Reinvestment

**Why:** The Genesis Constitution requires 40/25/15/10/10 split. Manual reinvestment will not happen consistently.
**File to modify:** `server/trading/treasury.mjs`
**Implementation:** After each `settleTradeCapital()` call, automatically split net PnL into buckets and record in a `treasury_buckets` table.

### P1.3 — Add Retry Logic to agentRunner Network Calls

**Why:** A single network blip causes an entire cycle to fail. Markets resolved during downtime are missed.
**File to modify:** `server/marketScanner.mjs`, `server/agentRunner.mjs`
**Implementation:** Add exponential backoff retry (3 attempts, 1s/2s/4s) around `fetchPolymarket()` and `fetchKalshi()`.

### P1.4 — Add Integration Tests for the Trading Pipeline

**Why:** Regressions in the SCAN→EXECUTE pipeline are currently undetectable.
**New file:** `server/tests/tradingPipeline.test.mjs`
**Implementation:**
  1. Mock: `scanMarkets()` returns 1 test market
  2. Mock: `runDebate()` returns `{ side:'YES', confidence:0.70 }`
  3. Run full pipeline in paper mode
  4. Assert: 1 trade in SQLite, correct capital deducted, costs applied
  5. Simulate market resolution → assert lesson in SQLite, capital restored + PnL

---

## P2 — ARCHITECTURE STABILITY (After Real Operation Established)

### P2.1 — Split genesisStore.ts into Domain Stores

**Current:** 67,601 lines — one file, one object, one LocalStorage key
**Target:** 5-8 domain stores (agents, tasks, trading, modules, decisions, wallet, events)
**Each store:** < 500 lines, separate LocalStorage key, clear interface
**Priority:** HIGH — this is a time bomb for localStorage overflow

### P2.2 — Split Monolithic UI Components

**Priority order:**
  1. `MarketsView.tsx` (32k lines) → `MarketList`, `MarketDetail`, `TradeHistoryPanel`
  2. `GenesisDashboard.tsx` (21k lines) → `MetricsPanel`, `TradesFeed`, `LessonsPanel`, `CapitalChart`
  3. `AgentExecutionView.tsx` (15k lines) → `AgentCard`, `LogViewer`, `ExecutionHistory`

### P2.3 — Remove Legacy Dead Code

  1. Delete `server/decisionEngine.mjs` (replaced by workflow.mjs)
  2. Delete `src/workflows/tradingEngine.ts` (frontend paper simulation, backend is authoritative)
  3. Delete `server/memory/memoryStore.mjs` JSON file layer (SQLite is authoritative)
  4. Consolidate: `server/memory/agentMemory.mjs` and `server/db/database.mjs` agent tables

### P2.4 — Migrate strategyParams to SQLite

**Problem:** Optimizer overwrites `strategyParams.mjs` at runtime (source file mutation).
**Solution:** Add a `strategy_params` table to SQLite. Optimizer writes to DB. Live engine reads from DB. No source file mutation. Full history preserved.

### P2.5 — Bind Frontend Agents to Backend Agents

**Problem:** Frontend pixel sprites (Genesis Core, Market Scanner, etc.) are disconnected from backend real agents (ATLAS, NOVA, etc.).
**Solution:** Map frontend agent IDs to backend agent IDs. When ATLAS executes a task, the corresponding frontend sprite visually "activates." The office world becomes a real representation of system state.

---

## P3 — PRODUCTION HARDENING (Before External Access)

- Enable HTTPS (TLS via reverse proxy: nginx or Caddy)
- Restrict CORS to specific origins
- Add rate limiting on API endpoints (express-rate-limit equivalent)
- Add process manager (PM2 with `--watch false`, restart policy, log rotation)
- Consider Postgres migration if concurrent write load increases (beyond 3-4 writer processes)
- Add secrets management (not raw env vars in .env files)

---

## Execution Summary

```
Phase 1 (P0) — ~25 hours of work:
  P0.1 Persist drawdown peak
  P0.2 Startup reconciliation
  P0.3 Persist org state
  P0.4 API authentication
  P0.5 Fix Kalshi failure mode
  P0.6 Basic monitoring

Phase 2 (P1) — ~40 hours of work:
  P1.1 Verify/harden real execution (Kalshi)
  P1.2 Automate capital reinvestment
  P1.3 Network retry logic
  P1.4 Integration tests

Phase 3 (P2) — ~80 hours of work:
  P2.1-P2.5 Architecture cleanup

Phase 4 (P3) — ~20 hours of work:
  Production hardening

Current state: P0 incomplete → REAL_TRADING must remain false.
```
