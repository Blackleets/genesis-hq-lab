# Genesis HQ — Technical Debt Register

> Audit date: 2026-06-05. Severity: CRITICAL | HIGH | MEDIUM | LOW

---

## CRITICAL — Will cause production failures

### TD-01: God Store (67,601 lines, localStorage persistence)

**File:** `src/core/store/genesisStore.ts` (67,601 lines)
**Problem:** Single JavaScript object containing ALL application state persisted to `localStorage.setItem('genesis-hq-state', JSON.stringify(state))`. Browser localStorage quota is ~5MB per origin. At 67k+ lines, a single snapshot of a moderately active session could easily exceed this. A quota exceeded error would silently fail, corrupting the entire session state.
**Secondary problem:** This file is unmaintainable. Any change requires understanding all 67k lines of context. There is no domain separation.
**Impact:** Production session corruption risk. Developer paralysis.

### TD-02: Drawdown Circuit Breaker is In-Memory Only

**File:** `server/trading/riskManager.mjs`
**Problem:** The 15% drawdown circuit breaker reads peak capital from in-memory state. On server restart, peak capital resets to current capital. If Genesis has been trading and is down 14.9% from its peak, a server restart resets the baseline — the circuit breaker thinks everything is fine and resumes trading.
**Impact:** Real money can be lost after a crash/restart cycle if REAL_TRADING is enabled.

### TD-03: No Position Reconciliation on Startup

**File:** `server/agentRunner.mjs`
**Problem:** When the server starts, it does not check if open trades from the last session are still valid. It immediately starts scanning for new trades. If a trade's market resolved during downtime, it will remain "open" in SQLite indefinitely (no pnl, no lesson).
**Impact:** P&L accounting errors. Phantom open positions. Capital allocation errors (believes capital is tied up in positions that already resolved).

### TD-04: Org State Not Persisted

**File:** `server/command/orgState.mjs`
**Problem:** All org state (mode, active departments, current focus, goal, founder notes) is in-memory only. Every server restart returns org state to defaults. All founder commands sent via `/api/command` are lost on restart.
**Impact:** Commands like "pause crypto trading" or "emergency mode" do not survive restarts.

---

## HIGH — Degrades reliability or scalability

### TD-05: Monolithic UI Components

**Files and sizes:**
- `src/core/store/genesisStore.ts` — 67,601 lines
- `src/workflows/MarketsView.tsx` — ~32,000 lines
- `src/dashboard/GenesisDashboard.tsx` — ~21,000 lines
- `src/agents/AgentExecutionView.tsx` — ~15,000 lines
- `src/core/data/moduleRegistry.ts` — ~15,000 lines

**Problem:** Files this size cannot be effectively reviewed, debugged, or modified. Vite will struggle to hot-reload files with 30k+ lines. TypeScript compile times increase dramatically.
**Impact:** Developer velocity is near-zero for these files. Bugs become invisible.

### TD-06: Dual Agent Systems — No Binding

**Problem:** Backend real agents (ATLAS, NOVA, SENTINEL, CURATOR, ARBITER) and frontend visual agents (Genesis Core, Market Scanner, etc.) are completely unrelated. The pixel office shows fake activity that doesn't reflect real agent work.
**Impact:** The primary UI feature (the office world) is decorative. Anyone watching the office to understand system state is misled.

### TD-07: strategyParams.mjs Mutated at Runtime by Optimizer

**File:** `server/crypto/runOptimizer.mjs`
**Problem:** The optimizer writes new strategy parameters by overwriting `strategyParams.mjs`, a JavaScript source file, at runtime. This is dangerous because:
  1. File writes can race with imports (no atomic file swap)
  2. A syntax error in the written file crashes the crypto engine on next import
  3. No history of what params were — each write destroys the previous
  4. Git shows diffs on source code that is actually runtime data
**Impact:** Optimizer adoption could silently crash the crypto loop.

### TD-08: No Test Coverage on Critical Paths

**Problem:** No integration tests exist for:
  - The SCAN → QUALIFY → VETO → DEBATE → EXECUTE pipeline
  - Paper fill cost calculation
  - Kelly sizing math
  - Drawdown circuit breaker
  - Treasury settlement
  - Lesson extraction (relying on Claude format compliance)
**Impact:** Regressions in trading logic are undetectable until money is lost.

### TD-09: Legacy Systems Still Exist Alongside New Systems

| Legacy File | Replaced By | Risk |
|-------------|-------------|------|
| `server/decisionEngine.mjs` | `server/trading/workflow.mjs` | Could be accidentally called |
| `src/workflows/tradingEngine.ts` | Backend trades (authoritative) | Frontend may show stale paper state |
| `server/memory/memoryStore.mjs` (JSON file) | SQLite | Two persistence systems in parallel |

---

## MEDIUM — Manageable but accumulating

### TD-10: No API Authentication

**Problem:** All API endpoints are completely unauthenticated. Any machine on the same network can:
  - POST /api/command to issue founder commands
  - POST /api/agents/:id/task to run arbitrary agent tasks (Claude API cost)
  - POST /api/agent/order to place trades
**Impact:** Unauthorized access risk. Claude API key could be drained by unauthorized task submission.

### TD-11: No Error Boundaries in Frontend

**Problem:** No React Error Boundaries wrap any major component. If any component throws (e.g., genesisStore returns unexpected null, API returns unexpected schema), the entire app crashes to a blank screen.

### TD-12: Concurrent SQLite Access From Multiple Processes

**Problem:** Server (index.mjs), agentRunner (agentRunner.mjs), and optimizer (runOptimizer.mjs) all write to the same SQLite database concurrently. WAL mode helps but:
  - busy_timeout=5000ms means writes can queue up to 5s
  - Under load, timeouts can cause silent write failures
  - No retry logic on SQLite BUSY errors in agentRunner
**Impact:** Trade saves could fail silently if DB is busy during execution.

### TD-13: Capital Bucket Reinvestment Not Automated

**Problem:** The Constitution mandates 40/25/15/10/10 reinvestment split. The treasury tracks this in SQLite but does NOT automatically move capital between buckets. A human must manually trigger reinvestment.

### TD-14: Kalshi Real Order Fallback is Silent

**File:** `server/trading/execution.mjs:31-37`
**Problem:** If a real Kalshi order fails, the system silently falls back to a paper fill and logs a success. The trade record shows `mode='paper'` with `fallback=true`, but no alert is raised. A human reviewing the dashboard would see a "completed trade" with no indication the real order failed.

---

## LOW — Minor issues

### TD-15: Port 8787 Hardcoded

Port 8787 appears hardcoded in: `server/index.mjs`, `src/hooks/useWebSocket.ts`, `vite.config.ts`. Should use PORT env var consistently.

### TD-16: CORS is Fully Open

`Access-Control-Allow-Origin: *` on all responses. Acceptable for local dev, not for any production deployment.

### TD-17: Frontend moduleRegistry.ts at 15k Lines

This file should be a small config JSON. 15k lines suggests auto-generated content or accumulated cruft.

### TD-18: No Retry Logic on agentRunner Network Calls

`scanMarkets()`, `fetchPolymarket()`, `fetchKalshi()` have no retry on network failures. A single timeout skips the entire trading cycle.

### TD-19: WebSocket Reconnection Has No Circuit Breaker

`src/hooks/useWebSocket.ts` reconnects with exponential backoff but no maximum. A permanently dead backend causes infinite reconnect attempts.

### TD-20: "Visual Only" Modules Have No Backend Equivalent

`auto` (objective→agent team), `factory` (agent creator), `integrations` (connector management) have no backend implementation. The UI creates the impression of functionality that doesn't exist.
