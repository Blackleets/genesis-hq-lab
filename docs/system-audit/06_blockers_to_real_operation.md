# Genesis HQ — Blockers to Real Operation

> Audit date: 2026-06-05.
> "Real operation" = REAL_TRADING=true with actual capital at risk.
> These must be resolved BEFORE enabling real trading.

---

## BLOCKER-01: Polymarket Real Execution is a Stub

**Severity:** CRITICAL — Money Cannot Be Deployed
**File:** `server/trading/execution.mjs:44`

```javascript
// Line 44 in execution.mjs:
const reason = `Real trading is not yet supported for source ${tradeProposal.marketSource}`;
console.warn('[execution] Unsupported real trading source:', tradeProposal.marketSource);
return { executed: false, reason };
```

**What happens today:** When REAL_TRADING=true and a trade proposal arrives for Polymarket (which is the primary market source), the system returns `executed: false` without placing any order. No trade occurs. No error is raised. The agentRunner continues as if everything is fine.

**What's needed:** Polymarket CLOB API integration (REST + WebSocket for order fills). Polymarket uses a custom order book (not simple yes/no bets), requiring: wallet signing (private key), order placement, fill monitoring, settlement.

**Alternative path:** If Polymarket integration is too complex, redirect all trading to Kalshi (which is already implemented).

---

## BLOCKER-02: Crypto Real Trading is Entirely Absent

**Severity:** CRITICAL (if crypto is the intended real venue)
**File:** `server/crypto/cryptoExecution.mjs`

**What happens today:** `executeCryptoPaperTrade()` is the ONLY execution path. There is no `executeCryptoRealTrade()`. No Binance spot API, no order placement, no fill confirmation, no position management via exchange.

**What's needed:** Binance Spot API integration: `POST /api/v3/order`, API key + secret signing, order status polling, fill confirmation, position sync.

---

## BLOCKER-03: Drawdown Circuit Breaker Resets on Restart

**Severity:** CRITICAL — Safety System Failure
**File:** `server/trading/riskManager.mjs`

**What happens today:** Peak capital is computed from in-memory capital history. On restart, peak = current capital. If Genesis was at $8,500 on a $10,000 account (15% down), a restart resets peak to $8,500. The circuit breaker thinks it's at 0% drawdown and resumes all trading.

**What's needed:** Persist peak capital to SQLite. On startup, load peak from DB. Circuit breaker must survive restarts.

---

## BLOCKER-04: Open Position Reconciliation Missing on Startup

**Severity:** CRITICAL — P&L Corruption
**File:** `server/agentRunner.mjs`

**What happens today:** On startup, agentRunner immediately starts scanning for NEW trades. It does NOT:
  - Verify that existing open trades are still on the exchange
  - Check if any markets resolved during downtime
  - Mark timed-out positions as expired
  - Update capital state based on what actually happened

**What's needed:** A startup reconciliation step:
  1. Load all `status='open'` trades from SQLite
  2. For each: call getMarketStatus() to check resolution
  3. For any resolved: run closeTrade() + analyzeClosedTrade()
  4. For any where market is now closed but no result: mark as 'expired'
  5. Then start normal scanning

---

## BLOCKER-05: No API Authentication

**Severity:** CRITICAL — Unauthorized Trade Control
**Exposure:** All routes, including POST /api/command and POST /api/agents/:id/task

**What happens today:** Any machine that can reach port 8787 can:
  - Issue founder commands (pause trading, change focus, emergency mode)
  - Run agent tasks (billed to your Anthropic API key)
  - Query all trade history, capital, and P&L
  - Place orders via POST /api/agent/order

**What's needed:** At minimum: API key authentication header for write endpoints. Proper approach: JWT tokens or session-based auth for a local dashboard, with optional IP whitelist for localhost-only operation.

---

## BLOCKER-06: Org State Lost on Every Restart

**Severity:** HIGH — Operational Control Failure
**File:** `server/command/orgState.mjs`

**What happens today:** `setMode('emergency')`, `pauseDept('crypto')`, all org state changes issued via `/api/command` exist only in memory. Server restart returns to defaults.

**Scenario:** You issue "pause all trading" before bed. Server crashes overnight. On restart, trading resumes at full speed with no awareness of your directive.

**What's needed:** Persist org state to SQLite. Load on startup. Founder orders table exists but org state is not derived from it on boot.

---

## BLOCKER-07: No Monitoring or Alerting

**Severity:** HIGH — Silent Failure in Production
**What happens today:** If agentRunner crashes (unhandled exception, network error, Claude API outage), it stops trading silently. No alert, no log to external system, no notification.

**What's needed:**
  - Heartbeat check: if no agent:tick within 2 minutes → alert
  - Uncaught exception handler: log to file, send alert (Slack webhook or email)
  - Trade settlement failures: alert if closeTrade() fails
  - Claude API errors: alert if debate returns fallback for 3+ consecutive cycles

---

## BLOCKER-08: Kalshi Real Failure is Silent

**Severity:** HIGH — You Think Real Trades Executed When They Didn't
**File:** `server/trading/execution.mjs:31-37`

**What happens today:** If REAL_TRADING=true and a Kalshi order fails (network error, invalid params, API rejection), the system:
  1. Silently saves a paper fill to SQLite
  2. Returns `{ executed: true, mode: 'paper', fallback: true }`
  3. Logs a console.warn (which nobody sees in production)

You review the dashboard and see "Trade executed." It wasn't real.

**What's needed:** Failed real orders must:
  - NOT be saved as paper fills (creates false P&L history)
  - Trigger an immediate alert
  - Be tracked separately in a `failed_orders` log

---

## BLOCKER-09: Capital Reinvestment is Manual

**Severity:** MEDIUM — Constitution Compliance Failure
**The Genesis Constitution mandates:** 40% savings, 25% capex (upgrades), 15% experiments, 10% ops, 10% founders.

**What happens today:** The treasury tracks these buckets in SQLite but the reinvestment is NOT automated. Capital accumulates in the main pool and never moves to buckets unless manually triggered.

**What's needed:** After each profitable trade close, `settleTradeCapital()` must automatically allocate to buckets and track spending against each bucket.

---

## BLOCKER-10: No Integration Tests for the Trading Pipeline

**Severity:** MEDIUM — Regressions Are Undetectable
**What exists:** Unit-level logic in individual files. Test files exist in `server/tests/` but coverage of the end-to-end pipeline is minimal.

**What's needed:** Integration test that runs:
  1. Feed a mock market through stepScan → stepQualify → stepVetoCheck → stepDebate (mocked Claude) → stepExecute (paper mode)
  2. Verify trade saved in SQLite with correct capital, shares, costs
  3. Simulate market resolution → verify lesson extracted, capital updated, veto patterns added

---

## Summary: Minimum Requirements Before Real Money

```
Must fix before enabling REAL_TRADING=true:
  ☐ BLOCKER-01: Implement Polymarket real execution OR restrict to Kalshi only
  ☐ BLOCKER-03: Persist drawdown peak to SQLite
  ☐ BLOCKER-04: Add startup position reconciliation
  ☐ BLOCKER-05: Add API authentication to write endpoints
  ☐ BLOCKER-06: Persist org state to SQLite
  ☐ BLOCKER-07: Add monitoring + alerting (heartbeat + exception handler)
  ☐ BLOCKER-08: Fix silent Kalshi failure mode
```
