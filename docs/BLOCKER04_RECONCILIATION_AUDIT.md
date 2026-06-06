# BLOCKER-04 — Startup Position Reconciliation Audit

> Audit date: 2026-06-06. Principal reliability engineer review.
> Grounded in actual code — not aspirational descriptions.

---

## A) Sources of Position Truth

### Primary: SQLite `trades` table (authoritative)

- **File:** `server/db/database.mjs` → `data/genesis.db`
- **Persistence:** Survives restarts (WAL mode, synchronous NORMAL)
- **Schema:** `id, market_id, market_source, outcome, entry_price, shares, capital_used, status, opened_at, closed_at, pnl`
- **Status values:** `'open'`, `'closed'`, `'expired'`, `'vetoed'`
- **What survives restart:** All trade records are fully persisted. On restart, `status='open'` correctly reflects all unresolved positions.

### Secondary: `capital_history` table

- **File:** `server/trading/treasury.mjs`
- **Persistence:** Survives restarts
- **What it tracks:** Capital snapshots after every trade open/close. `available` is correctly reduced when a position is opened.
- **Risk on restart:** If a position resolved during downtime, `capital_history.available` still shows the capital as "in trades" (tied up). Reconciliation must call `settleTradeCapital()` to free it.

### Tertiary: Module-level cache (treasury.mjs)

- `_peakCache` — cleared on restart, reloaded from `org_state` on first access. **SAFE** (BLOCKER-03 resolved this).

### Dead: localStorage / genesisStore

- **File:** `src/core/store/genesisStore.ts`
- **What:** Frontend-only paper state, `usePositions()`, `useCapitalHistory()`
- **Risk:** None — backend is authoritative. These are tagged `TODO_REAL_DATA`.

### Exchange positions (Kalshi only, when REAL_TRADING=true)

- **File:** `server/trading/execution.mjs → placeKalshiOrder()`
- **API:** `GET trading-api.kalshi.com/trade-api/v2/portfolio/positions`
- **Risk:** If a real Kalshi order was placed but the DB write failed (mid-crash), exchange has a position that SQLite does not know about → **Case C orphan**.
- **Paper mode:** No exchange positions exist. SQLite is the only truth.

### Crypto positions

- **File:** `server/crypto/cryptoExecution.mjs`
- **Persistence:** SQLite `trades` table, `market_source='crypto'`
- **Exchange state:** No Binance position API is called. Positions are purely virtual (paper mode only).
- **Risk:** Crypto positions have target/stop/timeout. They are managed every 1 minute via `manageCryptoPositions()`. After restart, this loop picks up open crypto trades normally.

---

## B) Current Startup Flow

```
npm start → node server/agentRunner.mjs

1. Process-level handlers registered (uncaughtException, unhandledRejection)
2. Constants set (INTERVAL_MS, AGENT_ID, ONCE)
3. Banner printed
4. await tick()   ← FIRST TICK RUNS IMMEDIATELY

tick() does:
  a. processExpiredSchedules()
  b. Check orgState.mode → early return if rest/emergency
  c. await runLearningCycle()   ← resolves open trades against market APIs
  d. await runTradingCycle()    ← scans + executes new trades

runLearningCycle() does:
  - SELECT * FROM trades WHERE status='open'
  - For each: await getMarketStatus(source, market_id)
  - If cancelled → expire, refund capital
  - If resolved → closeTrade() + settleTradeCapital() + lesson
  - If still open → skip (leave as open)
  - expire trades open >50 days
```

**Critical gap:** Steps c and d happen sequentially. If ANY `getMarketStatus()` call
fails (network error, API timeout), that trade is skipped — but `runTradingCycle()` runs
anyway, potentially opening new positions before knowing the state of existing ones.

---

## C) Failure Scenarios

### Scenario 1: Normal restart with open positions

```
Before shutdown: trade-abc is open on Polymarket, status='open', capital_used=$50

After restart (during step c):
  getMarketStatus('polymarket', 'abc') → { status: 'open' }
  → trade stays open, no action taken

After restart (during step d):
  preTradeCheck() → openCount from SQLite = 1 (correct)
  → new trade blocked if at maxOpenTrades limit

Result: SAFE — capital correctly accounted. riskManager correctly sees position.
```

### Scenario 2: Position resolved during downtime (most common)

```
Before shutdown: trade-xyz is open, market closes while server is down

After restart (during step c):
  getMarketStatus('polymarket', 'xyz') → { status: 'resolved', result: 'yes' }
  → closeTrade() → settleTradeCapital() → lesson
  
  If network FAILS:
  → trade remains 'open' in SQLite
  → capital_history.available shows capital as tied up
  → runTradingCycle() runs with incorrect position count
  → new trade may be allowed that would breach actual exposure limits

Result when network OK: SAFE. Result when network FAILS: DANGER.
```

### Scenario 3: Crash during trade execution (mid-write)

```
Timeline:
  1. reserveCapital($50) → capital_history row inserted, available -= 50 ✓
  2. executeTrade() → saveTrade() → INSERT into trades (status='open') ✓
  3. SERVER CRASH (between steps 2 and 3, or mid-step)

Possible outcomes:
  A. capital_history updated + trade saved → normal restart, trade found
  B. capital_history updated + trade NOT saved → capital "lost" from accounting
  C. trade saved + capital_history NOT updated → trade exists but capital not allocated

SQLite transactions (better-sqlite3 synchronous):
  reserveCapital() uses tx() → atomic
  saveTrade() uses tx() → atomic
  BUT: they are separate transactions with no distributed lock

Result: Case B and C are theoretically possible in a crash between the two separate tx() calls.
```

### Scenario 4: Kalshi real order placed, server crashes before DB write

```
REAL_TRADING=true:
  1. placeKalshiOrder() → order accepted by Kalshi ✓
  2. saveTrade() → INSERT fails or crashes
  
After restart:
  SQLite has no record of this position
  Kalshi portfolio has an open position

Genesis will:
  - Scan markets, possibly try to enter the SAME market again
  - Allow duplicate position on exchange

Result: DANGER — unknown exchange exposure, possible overexposure.
```

### Scenario 5: Crypto position during 1-minute loop restart

```
Crypto position is open in SQLite.
Server restarts.
manageCryptoPositions() runs at 60s interval — starts as normal.
The first crypto loop tick at 60s after restart will check prices and
close positions normally.

Gap window: 0-60 seconds after restart where crypto positions are unmanaged.
During this window, trading cycle might try to open another crypto position
if a new signal appears (but veto check prevents duplicate market_id).

Result: ACCEPTABLE — brief gap, duplicate protection prevents overexposure.
```

---

## D) Source Precedence

When sources disagree, trust this order:

```
1. Exchange API (Kalshi/Polymarket status) — if reachable
   Reason: external systems do not lie about resolution
   
2. SQLite trades table (status, opened_at, capital_used)
   Reason: all writes are transactional, survives restarts
   
3. capital_history table
   Reason: lags behind trades by one settleTradeCapital() call
   
4. In-memory cache (treasury _peakCache, etc.)
   Reason: rebuilt from SQLite on startup — derivative, not primary
   
5. Frontend localStorage
   Reason: dead state — never use for reconciliation decisions
```

---

## E) Mismatch Risks

| Risk | Severity | Condition | Current Protection |
|------|----------|-----------|-------------------|
| Position resolved during downtime + network failure → capital stuck | HIGH | Any restart with open trades + API unavailable | None — `runLearningCycle()` silently skips |
| Duplicate trade entry after restart | MEDIUM | Unlikely — `preTradeCheck()` checks `market_id` duplicates | SQLite duplicate check in `riskManager` |
| Real Kalshi position not in DB | CRITICAL | Crash between order placement and `saveTrade()` | None |
| Orphan position >48h unresolved | MEDIUM | Market delay, API outage | `detectStalePositions()` in pnlEngine |
| Capital accounting desync | HIGH | Separate tx() calls for reserve and save | None currently |
| Safe mode not enforced on degraded startup | HIGH | Always | None — no safe mode concept |

---

## F) WebSocket State

- WebSocket clients receive `agent:tick` every 15s with treasury snapshot
- WS state is ephemeral — not persisted, rebuilt on each client connect
- No position state is stored in WS — it is always derived from HTTP API calls
- **WebSocket is irrelevant to reconciliation.** It is a push notification layer, not a source of truth.

---

## G) Stale Positions (pre-reconciliation)

`pnlEngine.detectStalePositions(48)` identifies positions open >48h.
These are already tracked in the system health panel.
They are candidates for reconciliation on every startup.

---

## H) Reconciliation Implementation Plan

Based on this audit, the implementation will:

1. Add `server/memory/reconciliationEngine.mjs` — dedicated startup reconciliation
2. Run before first `tick()` in `agentRunner.mjs`
3. Track `reconciliationStatus: healthy|recovering|degraded` in `org_state`
4. If `degraded` → `isSafeMode()` returns true → `preTradeCheck()` blocks all new trades
5. Expose `/api/reconciliation/status` and `/api/reconciliation/clear` endpoints
6. Surface status in `truthLayer.mjs` system health

**Conservative principles:**
- Reconciliation failure → safe mode, not crash
- Network failures during status check → degraded mode, not silent skip
- Operator must explicitly clear degraded mode
- All reconciliation actions are logged with structured keys
