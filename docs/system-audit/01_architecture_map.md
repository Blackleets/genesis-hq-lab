# Genesis HQ — Architecture Map

> Audit date: 2026-06-05. Read-only. Do not modify until architecture changes.

## Runtime Topology

```
┌────────────────────────────────────────────────────────────────────────┐
│  npm start  →  concurrently runs 4 processes                           │
│                                                                         │
│  [web]          Vite dev server         :5173                           │
│  [server]       Node.js HTTP server     :8787  (server/index.mjs)       │
│  [agent]        Agent runner loop       (server/agentRunner.mjs)        │
│  [optimizer]    Crypto optimizer loop   (server/crypto/runOptimizer.mjs)│
│                                                                         │
│  All 4 share: /data/genesis.db (SQLite, WAL mode)                      │
└────────────────────────────────────────────────────────────────────────┘
```

## Frontend

| Property | Value |
|----------|-------|
| Framework | React 19.2.6 |
| Build Tool | Vite 8.0.12 |
| Language | TypeScript 6.0.2 |
| Styling | Tailwind CSS 3.4.19 + PostCSS |
| State | Hand-rolled Zustand-like store (NOT Redux, NOT Zustand) |
| Routing | ModuleId enum + switch statement (NO React Router) |
| Web3 | Wagmi v3 + viem |
| Charts | Recharts |
| Entry | src/main.tsx → src/App.tsx |
| Dev Proxy | Vite proxies /api/* to http://127.0.0.1:8787 |

### Module Registry (16 navigable views)

```
dashboard     — metrics overview (capital, PnL, win rate)
hq            — pixel office canvas (agent world)
factory       — agent creator form (visual only)
auto          — objective → agent team generator (visual only, no API)
hr            — hiring queue + roster
markets       — Polymarket snapshot
decisions     — A/B decision logger
progress      — onboarding timers + office upgrades
settings      — config
wallet        — Wagmi Web3 integration
marketing     — LLM-generated content
tech          — tech stack display
console       — CLI command input → /api/command
integrations  — connector management (visual only)
agents-live   — real AI agent runner monitor
edge          — trading readiness scorecard
crypto        — crypto scalping engine metrics
```

### State Shape (`core/store/genesisStore.ts` — 67,601 lines)

```typescript
GenesisStateShape {
  meta            // bornAt, devMode
  agents          // Record<string, Agent> — visual frontend agents
  hiringQueue     // Record<string, HiringCandidate>
  firedAgents     // Record<string, Agent>
  tasks           // Record<string, Task>
  events          // SystemEvent[] — max 200 entries
  selectedLanguage, selectedModule, selectedAgent
  modules         // Record<ModuleId, ModuleEntity> — unlock state
  officeUpgrades
  decisions       // A/B decision records
  capital         // paper trading capital (frontend mirror)
  positions       // Record<string, PaperPosition>
  closedPositions, capitalHistory
  walletAddress, walletConnected
  commandHistory
  connectors      // Slack, GitHub, Notion, etc.
}
```

**WARNING:** This store is persisted entirely to `localStorage`. Estimated risk at ~200-500 agents/events: approaching browser's ~5MB quota.

### Key Frontend Services (all HTTP polling)

| Service | File | Endpoints | Interval |
|---------|------|-----------|----------|
| Agent data | `services/agentClient.ts` | /api/trading/dashboard, /api/agent/* | 10s |
| Crypto data | `services/cryptoClient.ts` | /api/crypto/overview | 15s |
| Markets data | `services/marketsClient.ts` | /api/polymarket/events | 30s |
| WebSocket | `hooks/useWebSocket.ts` | ws://localhost:8787/ws | push |

---

## Backend

| Property | Value |
|----------|-------|
| Runtime | Node.js |
| HTTP Framework | NONE — raw `node:http` module |
| WebSocket | `ws` library (native Node upgrade) |
| Database | SQLite via `better-sqlite3` (synchronous) |
| DB File | `/data/genesis.db` (292 KB at audit time) |
| Port | 8787 (hardcoded in multiple places) |
| Auth | NONE — no API keys, no sessions |
| Entry | `server/index.mjs` (631 lines) |

### All API Endpoints

**Agent Routes:**
```
GET  /api/agents/real               — list real AI agents + provider status
GET  /api/agents/providers          — provider connectivity
GET  /api/agents/:id/status         — agent status + execution history
GET  /api/agents/:id/logs           — execution logs (limit=50-200)
POST /api/agents/:id/task           — submit task to real agent (async)
```

**Agent Memory Routes:**
```
GET  /api/agent/status              — trading snapshot
GET  /api/agent/trades              — recent closed trades (50 limit)
GET  /api/agent/lessons             — extracted lessons (20 limit)
GET  /api/agent/stats               — performance statistics
GET  /api/agent/signals             — market signals + accuracy (20 limit)
GET  /api/agent/skills              — deployed skill versions
GET  /api/agent/marketing           — generated marketing content
```

**Trading Routes:**
```
GET  /api/trading/dashboard         — full trading metrics
GET  /api/trading/treasury          — live capital with unrealized P&L
GET  /api/trading/edge-scorecard    — Sharpe, Brier, calibration verdict
GET  /api/trading/risk              — risk metrics
GET  /api/trading/debates           — recent debates (20 limit)
GET  /api/trading/leaderboard       — agent performance ranking
GET  /api/trading/vetoes            — active mistake-prevention vetoes
GET  /api/trading/capital-history   — capital over time (100 records)
POST /api/agent/order               — legacy human order endpoint
```

**Crypto Routes:**
```
GET  /api/crypto/overview           — crypto strategy status + heartbeat
```

**Polymarket Routes:**
```
GET  /api/polymarket/events         — live Polymarket snapshot (paginated)
GET  /api/polymarket/health         — Polymarket API availability
```

**Command/Control Routes:**
```
POST /api/command                   — natural language founder commands
GET  /api/command/history           — recent commands (30 limit)
GET  /api/command/status            — org state summary
```

**Skill Optimization:**
```
POST /api/skillopt/run              — trigger SkillOpt for agent
GET  /api/skillopt/status           — current SkillOpt job state
```

**Planning:**
```
POST /api/plan                      — Claude-powered planning from goal
```

**Health/Meta:**
```
GET  /api/health                    — service health, heartbeat, optimizer
GET  /api/metrics                   — endpoint directory
GET/UPGRADE /ws                     — WebSocket real-time stream
POST /internal/broadcast            — localhost-only: push WS event
```

---

## Database Schema (SQLite, WAL mode)

19 tables — key tables:

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `agent_profiles` | Agent definitions, skills (0.0-1.0), lifetime stats | id, role, budget_pct, skill_*, total_trades, wins, losses |
| `trades` | All trades — paper and real | market_id, source, outcome, entry_price, exit_price, capital_used, confidence, status, pnl |
| `lessons` | Claude-extracted lessons from closed trades | rule, why_failed, new_rule, effectiveness |
| `mistake_patterns` | Active veto rules from lessons | pattern, condition, severity |
| `operating_rules` | Hard + soft system constraints | scope, rule_text, is_hard |
| `signals` | Market signals + accuracy tracking | signal_type, prediction, resolved, accuracy |
| `skill_versions` | Deployed skill metrics | brier_score, win_rate, calibration |
| `agent_executions` | Real agent task execution history | agent_id, status, task, result |
| `agent_messages` | Agent conversation history | role, content |
| `agent_logs` | Execution logs | agent_id, level, message |
| `capital_history` | Capital snapshots over time | timestamp, total, available, at_risk |
| `founder_orders` | Natural language commands | command, parsed_intent, status |
| `team_memory` | Debate summaries, consensus | market_id, bull_arg, bear_arg, verdict |

Pragmas: WAL mode, foreign_keys ON, synchronous NORMAL, busy_timeout 5000ms.

---

## External Integrations

| Service | Auth Required | Endpoint | Use |
|---------|--------------|----------|-----|
| Polymarket | None | gamma-api.polymarket.com | Market data (read-only) |
| Kalshi | API Key (opt.) | trading-api.kalshi.com | Market data + real orders |
| Binance | None | api.binance.com/api/v3 | OHLCV price feeds |
| Anthropic Claude | API Key (req.) | api.anthropic.com | Haiku for decisions/learning |
| NewsAPI | Free tier | newsapi.org | News sentiment |
| Hacker News | None | news.ycombinator.com | Tech signal extraction |
| Reddit | None | reddit.com | Social signals |

---

## Agent System (5 Real AI Agents)

Defined in: `server/agents/agentRegistry.mjs`

| Agent | Role | Capability |
|-------|------|-----------|
| ATLAS | Market Intelligence Analyst | Analyzes Polymarket/Kalshi data, probability assessment |
| NOVA | Strategy & Signal Architect | Synthesizes signals into trading theses |
| SENTINEL | Risk Guardian | Capital preservation, rule enforcement, veto authority |
| CURATOR | Memory Architect | Extracts lessons, prevents repeated mistakes |
| ARBITER | Decision Facilitator | Facilitates debates, synthesizes evidence |

All agents use model: `claude-haiku-4-5-20251001`

State transitions: `idle → thinking → processing → researching/executing → completed`

**IMPORTANT:** These 5 backend agents are **completely separate** from the 5 visual frontend agents defined in `src/agents/data/initialAgents.ts`. The frontend agents are sprites; the backend agents are real Claude API callers. There is no binding between them.
