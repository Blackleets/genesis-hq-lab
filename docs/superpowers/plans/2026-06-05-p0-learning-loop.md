# P0 — Learning Loop 100% Robusto + Real Trading Ready

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Patch 5 real gaps in the Genesis HQ server so the learning loop never loses data on crash, org commands survive restarts, the health endpoint tells the truth, and Kalshi real-order failures are never silently swallowed.

**Architecture:** All changes are backend-only (server/). No new npm packages. No new processes. Changes write to the existing SQLite database at `data/genesis.db`. The migration runner in `server/db/database.mjs` handles schema additions automatically on startup (try/catch ignores "already exists" and "duplicate column name" errors).

**Tech Stack:** Node.js ES modules (.mjs), better-sqlite3 (sync), existing `db` singleton from `server/db/database.mjs`.

---

## Code Review: What's Already Working (Do NOT Re-implement)

Before coding, verify these are real — touch nothing if they are:
- `getPeakCapital()` in `server/trading/treasury.mjs:275` already does `SELECT MAX(total) AS peak FROM capital_history` — circuit breaker IS already SQLite-backed, no restart reset.
- `runLearningCycle()` in `server/trading/workflow.mjs:226` runs at the top of every `tick()` — startup reconciliation already happens within the first 5 minutes.
- `data/memory/agent_heartbeat.json` is already written every tick in `server/agentRunner.mjs:134`.
- `/api/health` already reads the heartbeat file and returns `lastTickAt`.

**The 5 real gaps remaining:**
1. No `process.on('uncaughtException')` → if agent loop crashes, it's silent
2. `/api/health` doesn't compute `agentAlive` boolean from heartbeat age
3. `orgState.mjs` uses `writeFileSync` to a JSON file → can corrupt on crash; SQLite is safer
4. No auth on POST endpoints → anyone on LAN can issue commands
5. Kalshi real-order failure silently saves a paper fill → P&L history contaminated

---

## File Map

| File | Change |
|------|--------|
| `server/db/schema.sql` | ADD `org_state` table |
| `server/command/orgState.mjs` | Rewrite: JSON file → SQLite read/write |
| `server/agentRunner.mjs` | ADD uncaughtException + unhandledRejection handlers |
| `server/index.mjs` | ADD `agentAlive` to health endpoint + auth middleware for POST routes |
| `server/trading/execution.mjs` | FIX: real Kalshi failure must not save paper fill |
| `logs/.gitkeep` | CREATE: ensure logs/ directory exists in repo |

---

## Task 1: Add `org_state` table to schema

**Files:**
- Modify: `server/db/schema.sql` (append at end)

- [ ] **Step 1: Read the end of schema.sql to find the right insert point**

Run: `tail -10 server/db/schema.sql`

- [ ] **Step 2: Append the new table**

Add at the very end of `server/db/schema.sql`:

```sql

-- ─── ORG STATE — persists org mode, departments, focus, goal across restarts ──
CREATE TABLE IF NOT EXISTS org_state (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

- [ ] **Step 3: Verify schema parses cleanly**

Run from project root:
```bash
node -e "import('./server/db/database.mjs').then(() => console.log('schema OK')).catch(e => console.error('FAIL', e.message))"
```
Expected: `schema OK`

- [ ] **Step 4: Commit**

```bash
git add server/db/schema.sql
git commit -m "feat(db): add org_state table for persistent org commands"
```

---

## Task 2: Migrate orgState.mjs from JSON file to SQLite

**Files:**
- Modify: `server/command/orgState.mjs` (full rewrite of the file internals — exports stay identical)

Context: The current implementation reads/writes `data/org-state.json` using `readFileSync`/`writeFileSync`. The problem: a hard crash mid-write corrupts the JSON. SQLite writes are atomic. All exports (`getOrgState`, `setOrgState`, `isDeptActive`, `getRiskSettings`, `getWeeklyGoal`, `processExpiredSchedules`, `getStatusSummary`) must keep the same signatures.

- [ ] **Step 1: Write the new orgState.mjs**

Replace the entire content of `server/command/orgState.mjs` with:

```javascript
// orgState.mjs — Genesis HQ operational state.
// Written by commandExecutor. Read by agentRunner every tick.
// Persisted to SQLite org_state table (atomic writes, survives crashes).

import db from '../db/database.mjs';

// ─── Default org state ────────────────────────────────────────────────────────

const DEFAULT_STATE = {
  mode: 'normal',
  activeDepts: {
    prediction_markets: true,
    research:           true,
    marketing:          true,
    sales:              false,
    operations:         true,
    crypto_scalping:    true,
  },
  riskTolerance: 'normal',
  focus: null,
  goal: null,
  emergency: null,
  schedule: [],
  founderNote: null,
  maxOpenTrades: 5,
  minConfidence: 0.65,
  maxRiskPct: 0.05,
  lastUpdated: null,
  commandCount: 0,
};

// ─── Read current state ───────────────────────────────────────────────────────

export function getOrgState() {
  try {
    const rows = db.prepare('SELECT key, value FROM org_state').all();
    if (rows.length === 0) return { ...DEFAULT_STATE };
    const stored = {};
    for (const { key, value } of rows) {
      try { stored[key] = JSON.parse(value); } catch { stored[key] = value; }
    }
    return { ...DEFAULT_STATE, ...stored };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

// ─── Write state ──────────────────────────────────────────────────────────────

export function setOrgState(updates) {
  const current = getOrgState();
  const next = {
    ...current,
    ...updates,
    lastUpdated: new Date().toISOString(),
    commandCount: (current.commandCount ?? 0) + 1,
  };
  const now = new Date().toISOString();
  const upsert = db.prepare(
    `INSERT OR REPLACE INTO org_state (key, value, updated_at) VALUES (?, ?, ?)`
  );
  const upsertAll = db.transaction((state) => {
    for (const [key, value] of Object.entries(state)) {
      upsert.run(key, JSON.stringify(value), now);
    }
  });
  try {
    upsertAll(next);
  } catch (e) {
    console.error('[orgState] Failed to persist:', e.message);
  }
  return next;
}

// ─── Helpers used by agentRunner ─────────────────────────────────────────────

export function isDeptActive(deptName) {
  const state = getOrgState();
  if (state.mode === 'rest' || state.mode === 'emergency') return false;
  if (state.activeDepts?.[deptName] === false) return false;
  return true;
}

export function getRiskSettings() {
  const state = getOrgState();
  switch (state.riskTolerance) {
    case 'conservative': return { maxRiskPct: 0.02, minConfidence: 0.72, maxOpenTrades: 3 };
    case 'aggressive':   return { maxRiskPct: 0.08, minConfidence: 0.60, maxOpenTrades: 7 };
    default:             return { maxRiskPct: state.maxRiskPct, minConfidence: state.minConfidence, maxOpenTrades: state.maxOpenTrades };
  }
}

export function getWeeklyGoal() {
  const state = getOrgState();
  if (!state.goal) return null;
  const expired = state.goal.deadline && new Date(state.goal.deadline) < new Date();
  if (expired) return null;
  return state.goal;
}

// ─── Expire scheduled commands ────────────────────────────────────────────────

export function processExpiredSchedules() {
  const state = getOrgState();
  const now   = new Date();
  const expired = [];
  const active  = [];

  for (const item of (state.schedule ?? [])) {
    if (item.expiresAt && new Date(item.expiresAt) < now) {
      expired.push(item);
    } else {
      active.push(item);
    }
  }

  if (expired.length > 0) {
    const restExpired = expired.find(s => s.action?.type === 'REST');
    const patch = { schedule: active };
    if (restExpired && state.mode === 'rest') patch.mode = 'normal';
    setOrgState(patch);
    console.log(`[orgState] ${expired.length} scheduled commands expired`);
  }

  return expired;
}

// ─── Get a human-readable status summary ─────────────────────────────────────

export function getStatusSummary() {
  const state = getOrgState();
  const risk  = getRiskSettings();
  const lines = [];

  lines.push(`Mode: ${state.mode.toUpperCase()}`);
  lines.push(`Risk: ${state.riskTolerance} (max ${(risk.maxRiskPct*100).toFixed(0)}%/trade, confidence ≥ ${(risk.minConfidence*100).toFixed(0)}%)`);

  const depts = Object.entries(state.activeDepts ?? {})
    .map(([d, active]) => `${active ? '●' : '○'} ${d}`)
    .join('  ');
  lines.push(`Depts: ${depts}`);

  if (state.focus) {
    lines.push(`Focus: ${state.focus.topic || state.focus.dept} (since ${state.focus.since?.slice(0,10)})`);
  }

  if (state.goal) {
    lines.push(`Goal: ${state.goal.description} by ${state.goal.deadline?.slice(0,10)}`);
  }

  if (state.founderNote) {
    lines.push(`Last order: "${state.founderNote}"`);
  }

  return lines.join('\n');
}
```

- [ ] **Step 2: Verify the server still starts**

```bash
node -e "import('./server/command/orgState.mjs').then(m => { const s = m.getOrgState(); console.log('mode:', s.mode); }).catch(e => console.error('FAIL', e.message))"
```
Expected: `mode: normal` (or whatever is stored)

- [ ] **Step 3: Verify setOrgState persists and survives re-read**

```bash
node -e "
import('./server/command/orgState.mjs').then(m => {
  m.setOrgState({ mode: 'rest', founderNote: 'test persistence' });
  const s = m.getOrgState();
  console.log('mode:', s.mode, '| note:', s.founderNote);
  // reset
  m.setOrgState({ mode: 'normal', founderNote: null });
  console.log('reset OK');
})
"
```
Expected:
```
mode: rest | note: test persistence
reset OK
```

- [ ] **Step 4: Commit**

```bash
git add server/command/orgState.mjs
git commit -m "feat(org): migrate org state from JSON file to SQLite for crash-safe persistence"
```

---

## Task 3: Add crash handler to agentRunner

**Files:**
- Modify: `server/agentRunner.mjs` (add handlers at top, create logs dir)
- Create: `logs/.gitkeep`

Context: `server/agentRunner.mjs` currently has NO `process.on('uncaughtException')` handler. If any unhandled exception or rejected promise propagates to the top level, Node will log to stderr and EXIT — silently from Genesis HQ's perspective. We need: (1) a handler that writes crash info to `logs/crash.log`, and (2) a `logs/` directory committed to the repo.

- [ ] **Step 1: Create logs directory**

```bash
mkdir -p logs
touch logs/.gitkeep
```

Add to `.gitignore` (so log content is ignored but the directory is tracked):
```
# Keep logs/ directory but ignore its content
logs/*.log
```

- [ ] **Step 2: Add crash handlers at the top of agentRunner.mjs**

In `server/agentRunner.mjs`, after the existing imports (around line 8, after the last `import` statement), add:

```javascript
import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join as pathJoin, dirname as pathDirname } from 'node:path';
import { fileURLToPath as pathFromUrl } from 'node:url';

const __agentDir = pathDirname(pathFromUrl(import.meta.url));
const LOGS_DIR   = pathJoin(__agentDir, '..', 'logs');

if (!existsSync(LOGS_DIR)) mkdirSync(LOGS_DIR, { recursive: true });

function writeCrashLog(type, err) {
  const entry = `\n[${new Date().toISOString()}] ${type}\n${err?.stack ?? String(err)}\n${'─'.repeat(60)}`;
  try {
    appendFileSync(pathJoin(LOGS_DIR, 'crash.log'), entry, 'utf8');
  } catch { /* never throw in error handler */ }
  console.error(`[agentRunner] CRASH (${type}):`, err?.message ?? err);
}

process.on('uncaughtException', (err) => {
  writeCrashLog('uncaughtException', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  writeCrashLog('unhandledRejection', reason);
  // Don't exit for unhandled rejections — let the loop continue
});
```

**Important placement:** These `process.on(...)` calls must go BEFORE the `await tick()` call at the bottom of the file so they are registered before any async code runs.

- [ ] **Step 3: Verify the handlers are registered**

Run: `node --input-type=module --eval "
import { createRequire } from 'module';
// Just check the file parses
" 2>&1 | head -5`

Actually: just start the server briefly and check it doesn't error:
```bash
node server/agentRunner.mjs --once 2>&1 | head -20
```
Expected: Banner prints, tick runs, no syntax error.

- [ ] **Step 4: Commit**

```bash
git add server/agentRunner.mjs logs/.gitkeep .gitignore
git commit -m "feat(monitoring): add crash handler to agentRunner — logs to logs/crash.log"
```

---

## Task 4: Add `agentAlive` to health endpoint + API auth middleware

**Files:**
- Modify: `server/index.mjs`

This task has two parts that both touch `index.mjs` — do them together.

### Part A: `agentAlive` in `/api/health`

Context: `/api/health` already reads `data/memory/agent_heartbeat.json` and returns `lastTickAt`. It does NOT compute whether the agent is actually alive. We add a boolean.

- [ ] **Step 1: Find the health endpoint in index.mjs**

Open `server/index.mjs` and find the block starting at `if (url.pathname === '/api/health')` (around line 515).

Currently the response includes:
```javascript
agent: {
  capital: treasury.total,
  isPaused: treasury.isPaused ?? false,
  openTrades,
  lastTickAt: heartbeat?.lastTickAt ?? null,
  totalCycles: heartbeat?.totalCycles ?? 0,
  claudeEnabled: heartbeat?.claudeEnabled ?? false,
},
```

- [ ] **Step 2: Add `agentAlive` computation**

Replace that `agent` object with:

```javascript
const lastTickAt = heartbeat?.lastTickAt ?? null;
const agentAlive = lastTickAt
  ? (Date.now() - new Date(lastTickAt).getTime()) < 10 * 60 * 1000  // within 10 minutes
  : false;

// ... in the sendJson call:
agent: {
  capital: treasury.total,
  isPaused: treasury.isPaused ?? false,
  openTrades,
  lastTickAt,
  agentAlive,
  totalCycles: heartbeat?.totalCycles ?? 0,
  claudeEnabled: heartbeat?.claudeEnabled ?? false,
},
```

### Part B: API auth middleware for POST routes

Context: `POST /api/command`, `POST /api/agents/:id/task`, `POST /api/agent/order`, `POST /api/plan`, `POST /api/skillopt/run` are all open to anyone on the network. We add a simple Bearer token check that activates ONLY when `API_SECRET` is set in the environment (so local dev without the env var keeps working unchanged).

- [ ] **Step 3: Add `requireAuth` function to index.mjs**

After the `applyCors` function definition (around line 63), add:

```javascript
function requireAuth(req, res) {
  const secret = process.env.API_SECRET?.trim();
  if (!secret) return true; // auth disabled when API_SECRET not set
  const auth = req.headers['authorization'] ?? '';
  if (auth === `Bearer ${secret}`) return true;
  sendJson(res, 401, { ok: false, error: 'unauthorized', message: 'Invalid or missing API_SECRET token' });
  return false;
}
```

- [ ] **Step 4: Apply `requireAuth` to each POST route**

For each of the following route handlers, add `if (!requireAuth(req, res)) return;` as the FIRST line inside the `req.on('end', ...)` callback:

**`POST /api/command`** (around line 436):
```javascript
if (url.pathname === '/api/command' && req.method === 'POST') {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', async () => {
    if (!requireAuth(req, res)) return;  // ← ADD THIS
    try {
      const { command } = JSON.parse(body);
      // ... rest unchanged
```

**`POST /api/agents/:id/task`** (around line 155):
```javascript
  req.on('end', async () => {
    if (!requireAuth(req, res)) return;  // ← ADD THIS
    try {
      const { task } = JSON.parse(body || '{}');
      // ... rest unchanged
```

**`POST /api/agent/order`** (around line 420):
```javascript
  req.on('end', async () => {
    if (!requireAuth(req, res)) return;  // ← ADD THIS
    try {
      const { order, priority = 'high' } = JSON.parse(body);
      // ... rest unchanged
```

**`POST /api/plan`** (around line 128):
```javascript
  req.on('end', async () => {
    if (!requireAuth(req, res)) return;  // ← ADD THIS
    try {
      const { goal } = JSON.parse(body);
      // ... rest unchanged
```

**`POST /api/skillopt/run`** (around line 468):
```javascript
  req.on('end', async () => {
    if (!requireAuth(req, res)) return;  // ← ADD THIS
    // ... rest unchanged
```

- [ ] **Step 5: Document API_SECRET in .env.example**

Find `.env.example` and add:
```
# API authentication for write endpoints (optional — leave blank to disable auth for local dev)
# Set this before enabling REAL_TRADING to protect /api/command and /api/agents
API_SECRET=
```

- [ ] **Step 6: Verify server still starts and health endpoint works**

```bash
node server/index.mjs &
sleep 2
curl http://localhost:8787/api/health | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); const j=JSON.parse(d); console.log('agentAlive:', j.agent.agentAlive, '| ok:', j.ok)"
kill %1
```
Expected: `agentAlive: false | ok: true` (false because agentRunner isn't running)

- [ ] **Step 7: Verify POST /api/command still works without API_SECRET**

```bash
node server/index.mjs &
sleep 2
curl -X POST http://localhost:8787/api/command -H "Content-Type: application/json" -d '{"command":"status"}' | node -e "process.stdin.resume(); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>console.log('ok:', JSON.parse(d).ok))"
kill %1
```
Expected: `ok: true` (auth disabled when API_SECRET env var not set)

- [ ] **Step 8: Commit**

```bash
git add server/index.mjs .env.example
git commit -m "feat(security): agentAlive health field + optional API auth for POST endpoints"
```

---

## Task 5: Fix Kalshi silent failure in execution.mjs

**Files:**
- Modify: `server/trading/execution.mjs`

Context: When `REAL_TRADING=true` and a Kalshi order fails (network error, bad API key, invalid params), the current code falls back to saving a paper fill in SQLite and returns `{ executed: true, mode: 'paper', fallback: true }`. This contaminates P&L history — you see "trade executed" on the dashboard but it never happened on the exchange.

The fix: failed real orders should NOT be saved as paper fills. They should be logged to `logs/failed_orders.log` and return `{ executed: false }` so the caller skips that trade.

- [ ] **Step 1: Read execution.mjs lines 1-50**

Verify the current fallback at lines 31-37:
```javascript
if (!orderResult.ok) {
  console.warn('[execution] Kalshi order failed:', orderResult.error);
  const fallbackId = saveTrade({
    ...tradeProposal,
    reason: `${tradeProposal.reason} | REAL ORDER FAILED: ${orderResult.error}`,
  });
  return { executed: true, tradeId: fallbackId, mode: 'paper', fallback: true, error: orderResult.error };
}
```

- [ ] **Step 2: Add failed_orders log helper at top of execution.mjs**

After the existing imports, add:

```javascript
import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join as pathJoin, dirname as pathDirname } from 'node:path';
import { fileURLToPath as pathFromUrl } from 'node:url';

const __execDir = pathDirname(pathFromUrl(import.meta.url));
const LOGS_DIR  = pathJoin(__execDir, '..', '..', 'logs');

function logFailedOrder(tradeProposal, error) {
  const entry = JSON.stringify({
    at: new Date().toISOString(),
    marketId: tradeProposal.marketId,
    marketSource: tradeProposal.marketSource,
    outcome: tradeProposal.outcome,
    capitalUsed: tradeProposal.capitalUsed,
    error: String(error),
  }) + '\n';
  try {
    if (!existsSync(LOGS_DIR)) mkdirSync(LOGS_DIR, { recursive: true });
    appendFileSync(pathJoin(LOGS_DIR, 'failed_orders.log'), entry, 'utf8');
  } catch { /* never throw in error logging */ }
}
```

- [ ] **Step 3: Replace the fallback block**

Find and replace the fallback block (lines 31-37) in `executeTrade()`:

**BEFORE:**
```javascript
if (!orderResult.ok) {
  console.warn('[execution] Kalshi order failed:', orderResult.error);
  const fallbackId = saveTrade({
    ...tradeProposal,
    reason: `${tradeProposal.reason} | REAL ORDER FAILED: ${orderResult.error}`,
  });
  return { executed: true, tradeId: fallbackId, mode: 'paper', fallback: true, error: orderResult.error };
}
```

**AFTER:**
```javascript
if (!orderResult.ok) {
  console.error('[execution] REAL ORDER FAILED (Kalshi):', orderResult.error);
  logFailedOrder(tradeProposal, orderResult.error);
  return { executed: false, mode: 'real_failed', reason: orderResult.error };
}
```

- [ ] **Step 4: Verify callers handle `executed: false`**

In `server/trading/workflow.mjs`, find the `stepExecute()` function and verify:
```javascript
const execution = await executeTrade({...});
if (!execution.executed) {
  console.log(`[workflow] EXECUTION FAILED: ${execution.reason}`);
  return { executed: false, reason: execution.reason, riskCheck };
}
```
This already handles `executed: false` correctly — no caller changes needed.

- [ ] **Step 5: Verify the file still imports correctly**

```bash
node -e "import('./server/trading/execution.mjs').then(() => console.log('OK')).catch(e => console.error('FAIL', e.message))"
```
Expected: `OK`

- [ ] **Step 6: Commit**

```bash
git add server/trading/execution.mjs
git commit -m "fix(execution): real Kalshi failure no longer saves paper fill — logs to failed_orders.log"
```

---

## Verification (End-to-End)

After all tasks complete, verify the full system:

- [ ] **Start full stack:**
```bash
npm start
```

- [ ] **Check `/api/health` shows `agentAlive: true` after first tick (wait ~30s):**
```bash
curl http://localhost:8787/api/health | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);console.log('agentAlive:',j.agent.agentAlive,'lastTickAt:',j.agent.lastTickAt)})"
```

- [ ] **Check org state persists: issue a command, restart, verify it survived:**
```bash
# Issue command
curl -X POST http://localhost:8787/api/command \
  -H "Content-Type: application/json" \
  -d '{"command":"set mode to rest"}' | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).ok))"

# Check state was saved to SQLite
node -e "
import Database from 'better-sqlite3';
const db = new Database('data/genesis.db');
const rows = db.prepare(\"SELECT key, value FROM org_state WHERE key='mode'\").all();
console.log('mode in DB:', rows);
"

# Now check /api/command/status
curl http://localhost:8787/api/command/status | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log('mode:',JSON.parse(d).state.mode))"
```

- [ ] **Verify crash.log is created when forced crash occurs (optional manual test):**
```bash
# This is a manual test — run agentRunner, force kill -9, check logs/crash.log
# Not required for CI but useful to confirm once
```

- [ ] **Verify `logs/` directory exists:**
```bash
ls logs/
```
Expected: `.gitkeep` (and possibly `crash.log`, `failed_orders.log` if those ran)

---

## Spec Coverage Self-Check

| Spec requirement | Implemented in |
|-----------------|---------------|
| org_state table | Task 1 |
| orgState.mjs → SQLite | Task 2 |
| Crash handler | Task 3 |
| agentAlive in /api/health | Task 4 Part A |
| API auth for POST routes | Task 4 Part B |
| Kalshi failure fix | Task 5 |
| logs/ directory | Task 3 Step 1 |
