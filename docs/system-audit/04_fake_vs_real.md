# Genesis HQ — Fake vs. Real

> Audit date: 2026-06-05. Verdict for every system component.
> KEY: ✅ REAL | 📋 PAPER/SIMULATED | 🔴 FAKE/STUB | 🟡 HYBRID

---

## Market Data

| Component | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Polymarket prices | ✅ REAL | `server/polymarket.mjs:GET gamma-api.polymarket.com` | Live API, no auth required |
| Polymarket volumes | ✅ REAL | Same as above | Real 24h volumes |
| Kalshi markets | ✅ REAL (optional) | `server/marketScanner.mjs` | Requires KALSHI_API_KEY in .env |
| Binance crypto prices | ✅ REAL | `server/crypto/priceFeeder.mjs:GET api.binance.com/api/v3/klines` | Public endpoint, no auth |
| EMA9, EMA21, RSI14 | ✅ REAL | `server/crypto/priceFeeder.mjs` | Computed from real OHLCV data |
| News sentiment | 🟡 HYBRID | `server/research/newsFeed.mjs` | Real headlines, naive scoring |
| Hacker News signals | ✅ REAL | `server/research/hackerNews.mjs` | Real articles, keyword match |

---

## LLM / AI Decisions

| Component | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Debate (BULL/BEAR/ARBITER) | ✅ REAL | `server/trading/debateRoom.mjs` | Real Claude Haiku API calls |
| Lesson extraction | ✅ REAL | `server/memory/learningEngine.mjs` | Real Claude analysis of closed trades |
| Intent parsing | ✅ REAL | `server/command/intentParser.mjs` | Real Claude for command parsing |
| Planning | ✅ REAL | `server/claudePlanner.mjs` | Real Claude task decomposition |
| Debate FALLBACK | 🔴 FAKE | `server/trading/debateRoom.mjs:fallbackDebate()` | Heuristic: price<0.3→YES, price>0.7→NO. Active when no API key |
| Crypto debate | ✅ REAL | `server/crypto/cryptoDebate.mjs` | Real Claude Haiku |

---

## Trade Execution

| Component | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Polymarket execution | 📋 PAPER | `server/trading/execution.mjs:44` | "Real trading is not yet supported for source polymarket" — always paper |
| Kalshi execution (paper mode) | 📋 PAPER | `execution.mjs:11-27` | Default — REAL_TRADING=false |
| Kalshi execution (real mode) | ✅ REAL | `execution.mjs:29-41`, `placeKalshiOrder()` | Only when REAL_TRADING=true AND KALSHI_API_KEY set AND source='kalshi' |
| Kalshi real fallback | 🔴 FAKE | `execution.mjs:31-37` | If Kalshi order fails → silently falls back to paper fill |
| Crypto execution | 📋 PAPER | `server/crypto/cryptoExecution.mjs` | Always paper. No Binance spot API integrated. |

**Summary:** Of the 3 supported markets (Polymarket, Kalshi, Crypto), only Kalshi supports real execution — and only via a manual env flag.

---

## Risk Management

| Component | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Drawdown circuit breaker | ✅ REAL | `server/trading/riskManager.mjs` | Blocks all trades if portfolio down ≥15% from peak |
| Daily trade limit | ✅ REAL | Same file | SQLite COUNT query checks trades today |
| Max open trades (5) | ✅ REAL | Same file | SQLite COUNT query on status='open' |
| Category concentration | ✅ REAL | Same file | ≤2 per category enforced via SQLite |
| Loss streak halt | ✅ REAL | Same file | ≥4 losses → error thrown |
| Crypto daily loss cap | ✅ REAL | `server/crypto/cryptoRisk.mjs` | Halts if realized loss today > CRYPTO_DAILY_LOSS_CAP |
| Drawdown persistence | 🔴 BROKEN | `riskManager.mjs` reads peak from in-memory capital_history | Server restart resets peak capital → circuit breaker disabled |

---

## Learning Loop

| Component | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Lesson extraction | ✅ REAL | `server/memory/learningEngine.mjs` | Claude Haiku analyzes each closed trade |
| Veto pattern creation | ✅ REAL | `server/memory/mistakePrevention.mjs` | INSERT into mistake_patterns |
| Veto enforcement | ✅ REAL | `server/trading/workflow.mjs:stepVetoCheck()` | Pattern matching before every trade |
| Agent skill updates | ✅ REAL | `server/memory/agentScoring.mjs` | Updates agent_profiles.skill_* after each trade |
| Signal accuracy tracking | ✅ REAL | `server/research/signalExtractor.mjs` | Tracks which signals predicted correctly |

---

## Capital Accounting

| Component | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| P&L calculation | ✅ REAL | `server/trading/treasury.mjs` | Math is correct: (exit-entry)×shares - fees |
| Capital history | ✅ REAL | SQLite `capital_history` table | Snapshots after every trade |
| Treasury buckets (40/25/15/10/10) | 🟡 HYBRID | `treasury.mjs` | Buckets tracked in DB, reinvestment NOT automated |
| Unrealized P&L | ✅ REAL | `GET /api/trading/treasury` | Fetches current market prices, computes mark-to-market |

---

## Frontend Data

| Component | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Capital display | ✅ REAL | Polled from `/api/trading/dashboard` every 10s | Real SQLite data |
| Trade history | ✅ REAL | Polled from `/api/agent/trades` | Real SQLite data |
| Lessons displayed | ✅ REAL | Polled from `/api/agent/lessons` | Real Claude-generated lessons |
| Signals display | ✅ REAL | Polled from `/api/agent/signals` | Real scoring data |
| Polymarket markets display | ✅ REAL | Polled from `/api/polymarket/events` | Real live market data |
| Crypto params display | ✅ REAL | Polled from `/api/crypto/overview` | Real optimizer params |

---

## Frontend Visual Systems (All Simulated)

| Component | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Pixel office world | 🔴 SIMULATED | `src/animations/` | Pure canvas animation |
| Agent movement | 🔴 SIMULATED | `src/animations/pixelLifeLoop.ts` | Greedy pathfinding, no real agent state |
| Agent conversations/bubbles | 🔴 SIMULATED | `src/activity/conversationEngine.ts` | Scripted bubble text |
| 5 frontend agents | 🔴 MOCK | `src/agents/data/initialAgents.ts` | Seed data: Genesis Core, Market Scanner, Risk Guardian, Memory Curator, Strategy Executor — NO connection to backend real agents |
| 10 future agents | 🔴 MOCK | `src/agents/data/futureAgents.ts` | Hiring queue display only |
| Onboarding timers | 🔴 SIMULATED | `src/workflows/progressEngine.ts` | Local 5s ticks in App.tsx |
| Office room upgrades | 🔴 SIMULATED | `src/animations/officeEvents.ts` | Triggered by store state |
| Auto view (objective→team) | 🔴 VISUAL ONLY | `src/workflows/AutoView.tsx` | No API call, pure UI |
| Factory (agent creator) | 🔴 VISUAL ONLY | `src/creator/AgentCreator.tsx` | No persistence to backend |
| Integrations view | 🔴 VISUAL ONLY | `src/ui/IntegrationsView.tsx` | No real connector calls |
| Frontend tradingEngine.ts | 🔴 REDUNDANT | `src/workflows/tradingEngine.ts` | Simulates paper trades locally; backend is authoritative |

---

## Agent Systems — Critical Disconnect

There are **TWO completely separate agent systems** with no binding:

```
Backend Real Agents (server/agents/agentRegistry.mjs):
  ATLAS, NOVA, SENTINEL, CURATOR, ARBITER
  → These make real Claude API calls
  → Their state is in SQLite (agent_executions, agent_profiles)
  → Visible in /agents-live module

Frontend Visual Agents (src/agents/data/initialAgents.ts):
  Genesis Core, Market Scanner, Risk Guardian, Memory Curator, Strategy Executor
  → These are sprites in the pixel office
  → Their state is in localStorage (genesisStore)
  → NO connection to backend agents
  → Moving sprites do NOT reflect real agent activity
```

**The pixel office is entirely decorative.** An agent sprite "walking to the Market Desk" has no correlation with ATLAS or NOVA executing a real task.

---

## Infrastructure

| Component | Status | Notes |
|-----------|--------|-------|
| API authentication | 🔴 NONE | Any machine on local network can POST /api/command or POST /api/agents/:id/task |
| CORS | 🔴 PERMISSIVE | Allow-origin: * on all responses |
| HTTPS | 🔴 NONE | HTTP only, no TLS |
| Process monitoring | 🔴 NONE | If agentRunner crashes, no alert |
| Position recovery on restart | 🔴 BROKEN | Open trades not reconciled on startup |
| Org state persistence | 🔴 NONE | orgState.mjs is purely in-memory |
| Rate limiting | 🔴 NONE | No rate limiting on any endpoint |
