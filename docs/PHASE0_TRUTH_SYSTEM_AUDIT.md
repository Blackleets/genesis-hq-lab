# Phase 0 — Truth System Audit
> Generated: 2026-06-06 | Genesis HQ Lab | Read-only audit of data flow

---

## SECTION A — REAL DATA

Components and hooks already connected to authoritative backend/SQLite state.

| UI Element | Data Source | Hook/API | Verified |
|------------|-------------|----------|---------|
| Capital (TopBar, Dashboard) | SQLite `capital_history` via treasury | `useLiveTrading()` → `/api/trading/dashboard` | ✅ |
| P&L total | SQLite `trades` (closed, pnl col) | `useLiveTrading().totalPnL` | ✅ |
| Win rate | SQLite `trades` (wins/total) | `useLiveTrading().winRate` | ✅ |
| Open trades list | SQLite `trades WHERE status='open'` | `useAgentData()` → `/api/agent/trades` | ✅ |
| Closed trades list | SQLite `trades WHERE status='closed'` | `useAgentData()` → `/api/agent/trades` | ✅ |
| Lessons | SQLite `lessons` | `useAgentData()` → `/api/agent/lessons` | ✅ |
| Market signals | SQLite `signals` | `useAgentData()` → `/api/agent/signals` | ✅ |
| Agent skills | SQLite `skill_versions` | `useAgentData()` → `/api/agent/skills` | ✅ |
| Edge scorecard | Computed from SQLite trades | `/api/trading/edge-scorecard` | ✅ |
| Capital history chart | SQLite `capital_history` | `/api/trading/dashboard` → `capitalHistory` | ✅ |
| Drawdown % | Real-time treasury calculation | `useLiveTrading().drawdownPct` | ✅ |
| Treasury (available, in-trades) | SQLite + treasury.mjs | `/api/trading/treasury` | ✅ |
| Polymarket snapshot | Live Polymarket API | `/api/polymarket/events` | ✅ |
| Kalshi status | Live Kalshi API + env key | `/api/kalshi/status` | ✅ |
| Crypto P&L | SQLite `trades WHERE source='crypto'` | `/api/crypto/overview` | ✅ |
| Backend health | Server liveness + heartbeat file | `/api/health` | ✅ |
| Agent execution history | SQLite `agent_executions` | `/api/agents/:id/status` | ✅ |
| Agent decision ledger | SQLite `agent_decisions` | `/api/agent/decisions` | ✅ *(new)* |
| Agent accuracy/Brier score | SQLite `agent_performance` | `/api/agent/performance` | ✅ *(new)* |
| Consensus decisions | SQLite `consensus_decisions` | `/api/agent/consensus` | ✅ *(new)* |

**Polling strategy:** `useAgentData` polls every 10s + WebSocket push on trade events. No stale data risk under normal operation.

---

## SECTION B — FAKE OR DISCONNECTED DATA

Items that show placeholder, synthetic, or disconnected data in the UI.

### B1 — Agent count in TopBar (cosmetic mismatch)
**File:** `src/ui/TopBar.tsx:18-19`
```typescript
const activeAgents = useActiveAgents();      // genesisStore visual agents
const onboardingAgents = useOnboardingAgents();
const totalAgents = activeAgents.length + onboardingAgents.length;
```
**Problem:** Counts visual pixel-office sprites, NOT backend real AI agents (ATLAS, NOVA, etc.).
**Real source:** `GET /api/agents/real` → `getAllAgentStatuses()`
**Risk:** LOW — counts differ by design; backend has 5 real agents, frontend has configurable visual sprites.
**Fix priority:** P2 (cosmetic discrepancy)

### B2 — AgentActivityFeed synthetic heartbeat
**File:** `src/activity/AgentActivityFeed.tsx:336` (setInterval 5.5s)
```typescript
Math.floor(Math.random() * active.length)  // random agent for animation
```
**Problem:** Selects a random visual agent to "speak" on a timer — purely synthetic animation, not tied to real agent activity.
**Risk:** NONE — clearly cosmetic; never shown as trading data.
**Fix priority:** P3 (animation, not data)

### B3 — genesisStore local capital (dead, not shown)
**File:** `src/core/store/genesisStore.ts:149`
```typescript
capital: 10_000  // initial local state
```
**Problem:** This local capital is NEVER shown to the user — all capital UI reads `useLiveTrading()`. However the store still has actions (`openPosition`, `closePosition`) that modify it. Dead code.
**Risk:** LOW — never reaches UI; backend is authoritative.
**Fix priority:** P2 (dead code removal, not data issue)

### B4 — tradingEngine.ts marked DEPRECATED but still imports
**File:** `src/workflows/tradingEngine.ts:1`
```typescript
// DEPRECATED — el UI ya no llama evaluatePaperTrades().
```
**Problem:** File exists, imports store actions, but is never called from any active component.
**Risk:** LOW — effectively inert.
**Fix priority:** P2 (cleanup)

### B5 — CommandConsole status always 'running' on entry
**File:** `src/workflows/CommandConsole.tsx:224`
```typescript
status: 'running',  // set on command submit
```
**Actual flow:** Status changes to 'completed'/'error' when backend responds. Initial 'running' is correct transitional state — not fake.
**Risk:** NONE — this is correct UX.

### B6 — `useTradingStats()` selector reads dead local positions
**File:** `src/core/store/genesisStore.ts:1983-2000`
```typescript
const closedTrades = s.closedPositions;  // always []
const winRate = closed.length > 0 ? wins / closed.length : 0;
```
**Problem:** Returns 0% win rate from local dead positions. If any component uses this selector instead of `useLiveTrading()`, it shows wrong data.
**Risk:** MEDIUM — must verify no component uses `useTradingStats()` for display.
**Verified:** `grep -r "useTradingStats" src/` → 0 results. Dead selector, not called.
**Fix priority:** P2 (cleanup)

### B7 — `/api/agent/status` fallback hardcodes 10000 capital
**File:** `server/index.mjs` (getSnapshot fallback)
```javascript
capital: { total: 10000, available: 10000 }
```
**Problem:** If `getSnapshot()` throws, the response pretends everything is healthy with $10k capital.
**Risk:** MEDIUM — frontend would think backend is fine when it's degraded.
**Fix:** Already flagged with TODO_REAL_DATA in truth layer.
**Fix priority:** P1

---

## SECTION C — DUPLICATED STATE

Multiple competing sources of truth for the same concept.

### C1 — Capital: 3 sources (CRITICAL)
| Source | Location | Used by UI? |
|--------|----------|-------------|
| `genesisStore.capital` | localStorage | ❌ Never shown |
| `treasury.mjs` (SQLite) | Backend | ✅ `useLiveTrading().capital` |
| `agent:tick` WebSocket | Push event | ✅ Immediate refresh trigger |

**Verdict:** UI correctly uses backend. Local store capital is dead weight. No user-visible conflict.

### C2 — Trades/Positions: 2 sources
| Source | Location | Used by UI? |
|--------|----------|-------------|
| `genesisStore.positions` | localStorage | ❌ `usePositions()` never called |
| SQLite `trades` table | Backend | ✅ `useAgentData()` → `useLiveTrading()` |

**Verdict:** Backend wins everywhere. Local positions are ghost state.

### C3 — Capital History: 2 implementations
| Source | Location | Used by UI? |
|--------|----------|-------------|
| `genesisStore.capitalHistory` (onTick snapshots) | localStorage | ❌ Never read by any chart |
| SQLite `capital_history` table | Backend | ✅ CapitalChart via useLiveTrading |

**Verdict:** Backend wins. Local history is accumulated silently but never displayed.

### C4 — Agent status: 2 systems
| Source | Location | Used by UI? |
|--------|----------|-------------|
| `genesisStore.agents[].status` | localStorage | ✅ Pixel office sprites |
| `agent_profiles + agent_executions` (SQLite) | Backend | ✅ AgentExecutionView |

**Verdict:** BY DESIGN — two separate systems. Visual sprites ≠ real AI agents. Not a sync problem, a design clarity problem.

### C5 — Online status: 2 checks
| Source | Location | Used by UI? |
|--------|----------|-------------|
| `useAgentData().online` (from `/api/health`) | Hook | ✅ TopBar LIVE/OFFLINE |
| `useWebSocket().connectionStatus` | Hook | Not shown explicitly |

**Verdict:** Online flag only checks HTTP health, not WebSocket. A split brain (HTTP alive, WS dead) would show LIVE but miss push events. Medium risk.

---

## SECTION D — RISK AREAS

Ranked by likelihood and impact.

### D1 — RISK: HTTP health ≠ full system health (MEDIUM)
`/api/health` returns `ok: true` even when:
- agentRunner has not ticked in hours
- SQLite writes are failing
- Kalshi/Polymarket are down
- Claude API is exhausted

Frontend shows `LIVE` based only on HTTP reachability. User may think system is fully operational when it isn't.
**Mitigation:** New `/api/system/health` with granular checks.

### D2 — RISK: WebSocket reconnect silent (MEDIUM)
If WebSocket disconnects and HTTP stays up:
- `live.online = true` (HTTP health ok)
- No push events received
- 10s poll still runs → data not truly stale
- User has no indication WS is down

**Mitigation:** `useTruthLayer` exposes `wsConnected` separately.

### D3 — RISK: Dead selectors polluting store exports (LOW)
`useCapital()`, `usePositions()`, `useTradingStats()` export from genesisStore but read dead local state. If a future developer uses them thinking they return live data, they get stale/zero values.
**Mitigation:** Document with `// TODO_REAL_DATA: use useLiveTrading() instead` comments.

### D4 — RISK: 10s poll lag on trade events without WS (LOW)
If WS is down, trade execution → up to 10s before UI reflects it.
**Mitigation:** Acceptable for paper trading. Flag in health diagnostics when WS is disconnected.

### D5 — RISK: `/api/agent/status` fallback returns fake capital (LOW-MEDIUM)
The `getSnapshot()` call has a fallback that hardcodes capital values. This endpoint is NOT used by `useLiveTrading()` (which uses `/api/trading/dashboard`) so impact is minimal. But any consumer of `/api/agent/status` would get wrong data on failure.
**Mitigation:** Already flagged TODO_REAL_DATA.

---

## SECTION E — RECOMMENDED FIX ORDER

Safest, highest-value-first implementation sequence.

### P0 — Already Done ✅
- All financial data (capital, P&L, trades) comes from backend
- WebSocket push + 10s poll keeps data fresh
- Existing health endpoint covers basic liveness

### P1 — Implement Now (this PR)
1. **`/api/system/health`** — granular health diagnostics (WS clients, DB, agent, Kalshi, Polymarket, Claude)
2. **`server/truthLayer.mjs`** — canonical state aggregator for server-side truth
3. **`src/hooks/useTruthLayer.ts`** — frontend hook for system health state
4. **`SystemHealthView`** — `/system/health` UI panel showing all indicators
5. **Structured logging** — desync/stale detection at key integration points

### P2 — Next Sprint (low risk cleanup)
1. Remove dead selectors: `useCapital()`, `usePositions()`, `useTradingStats()` from genesisStore exports
2. Remove dead actions: `openPosition()`, `closePosition()`, `markPositionsToMarket()`
3. Delete `tradingEngine.ts` (marked DEPRECATED, never called)
4. Fix agent count in TopBar to show real backend agent count
5. Fix `/api/agent/status` fallback to not hardcode capital

### P3 — Future (nice-to-have)
1. Bind visual pixel-office agents to real backend agent activity
2. Add WebSocket status indicator in TopBar
3. Add last-sync timestamp display
4. Stale data banner if backend hasn't responded in 30s

---

## Summary Matrix

| System | Source of Truth | UI Accuracy | Risk |
|--------|----------------|-------------|------|
| Capital | SQLite treasury | ✅ Correct | None |
| P&L | SQLite trades | ✅ Correct | None |
| Win rate | SQLite trades | ✅ Correct | None |
| Open trades | SQLite trades | ✅ Correct | None |
| Capital history | SQLite capital_history | ✅ Correct | None |
| Agent decisions | SQLite agent_decisions | ✅ Correct (new) | None |
| Accuracy/Brier | SQLite agent_performance | ✅ Correct (new) | None |
| Consensus | SQLite consensus_decisions | ✅ Correct (new) | None |
| System health | `/api/health` (partial) | ⚠️ HTTP only | Medium |
| WS status | Not surfaced in UI | ⚠️ Not shown | Medium |
| Agent count | Local sprites | ⚠️ Cosmetic only | Low |
| Local capital | genesisStore (dead) | N/A (not shown) | Low |
| Local positions | genesisStore (dead) | N/A (not shown) | Low |
