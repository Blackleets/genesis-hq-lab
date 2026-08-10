# Genesis HQ Lab — Next Actions (P0 → Live Trading)

**Current Status**: P0 Stability Complete ✓ | Code: Compiles ✓ | Ready for Local Testing

**Timeline**: 
- ✓ P0 Complete (2 days)
- → Local Testing & Verification (4 hours)
- → Render Deploy & Test (2 hours)
- → Go Live Decision (user approval)

---

## Phase 1: Local Verification (4 hours)

### 1.1 Start Server with P0 Logging

```bash
cd genesis-hq-lab
npm install                    # If needed
npm run start:ui               # Start server + Vite dev (port 5173)
```

**Expected Logs (first 30s):**
```
[genesis-hq-lab-backend] listening on http://127.0.0.1:8787
[P0.1] Risk state initialized: peakCapital=$10000.00, source=sqlite
[P0.2] Position reconciliation: 0 checked, 0 closed, 0 expired
[P0.3] Org state loaded: trading_paused=false
[P0.6] Server heartbeat recorded
[keepalive] Self-ping active → http://localhost:5173/api/health every 4 min
```

### 1.2 Test Core Endpoints

```bash
# Test health (should return 200)
curl http://localhost:5173/api/health

# Test trading dashboard
curl http://localhost:5173/api/trading/dashboard

# Test system health
curl http://localhost:5173/api/system/health

# Open UI
open http://localhost:5173
```

### 1.3 Verify P0 Components in UI

**In browser console:**
```javascript
// Check if agent is ticking
fetch('/api/health').then(r => r.json()).then(d => console.log('Agent alive:', d.agent.agentAlive))

// Check reconciliation status
fetch('/api/reconciliation/status').then(r => r.json()).then(d => console.log('Recon:', d.reconciliation))

// Check risk state
fetch('/api/command/risk-state').then(r => r.json()).then(d => console.log('Risk:', d))
```

### 1.4 Test Auth in Production Mode

```bash
# Stop current server
# (Ctrl-C in terminal)

# Restart with production env
NODE_ENV=production npm run server &

# Should be 401 (auth required)
curl http://localhost:8787/api/health

# Should be 200 (with valid token)
curl -H "Authorization: Bearer ${API_SECRET}" http://localhost:8787/api/health
```

### 1.5 Database Verification

```bash
# Check P0 tables exist
sqlite3 data/genesis.db

sqlite> SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'agent_%';
sqlite> SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'risk_%';
sqlite> SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'position_%';

# Verify peak capital persisted
sqlite> SELECT * FROM org_state WHERE key = 'peak_capital';

# Verify heartbeat recorded
sqlite> SELECT * FROM agent_heartbeat ORDER BY last_seen DESC LIMIT 1;

# Exit
sqlite> .quit
```

---

## Phase 2: Render Deploy (2 hours)

### 2.1 Push to Main Branch

```bash
# Verify commit is on current branch
git log -1

# Push to Render
git push origin blackleets-ubiquitous-adventure
# (If rebasing onto main: git push origin HEAD:main --force-with-lease)
```

### 2.2 Verify Render Build

1. Go to https://dashboard.render.com
2. Select Genesis HQ Lab project
3. Watch build logs for:
   ```
   > npm run build
   > npm run start
   [genesis-hq-lab-backend] listening on ...
   [P0.1] Risk state initialized ...
   ```

### 2.3 Test Production Endpoints

```bash
RENDER_URL="https://<your-render-url>.onrender.com"

# Should return 401 in production
curl $RENDER_URL/api/health

# Should work with auth
curl -H "Authorization: Bearer ${API_SECRET}" $RENDER_URL/api/health

# Check frontend
open $RENDER_URL
```

### 2.4 Verify Production Database

```bash
# SSH into Render (if available) or check logs
# Render logs should show P0 initialization
```

---

## Phase 3: Go-Live Decision

### 3.1 User Confirmation Checklist

- [ ] Local server runs without errors
- [ ] P0 logs appear on startup
- [ ] `/api/health` endpoint returns 200
- [ ] Auth enforcement works (401 without token, 200 with token)
- [ ] Database tables created and populated
- [ ] Render deploy successful
- [ ] Production endpoints reachable and authenticated

### 3.2 Set Real Trading Flag (User Decision)

**Option A: Paper Trading Continue**
```bash
# In .env or Render dashboard
REAL_TRADING=false
npm run start:ui
```

**Option B: Real Trading Go-Live**
```bash
# In Render dashboard (SECRET VARIABLES)
REAL_TRADING=true
BINANCE_API_KEY=<your-key>
BINANCE_API_SECRET=<your-secret>
KALSHI_API_KEY=<your-key>
# Redeploy
```

---

## Phase 4: Post-Go-Live (P1 Work)

Once user approves `REAL_TRADING=true`, next work:

### P1: Binance Integration
- [ ] Implement `crypto/binanceClient.mjs` (market data + execution)
- [ ] Wire to position reconciliation (`getBalanceStatus()`)
- [ ] Test with small capital allocation ($1000)

### P1: UI Live Wiring
- [ ] Stream real positions to React dashboard
- [ ] Show real P&L in equity curve
- [ ] Add emergency close button

### P1: Risk Gates
- [ ] Capital allocation by position size (Kelly fraction)
- [ ] Drawdown circuit breaker (stop if -15% from peak)
- [ ] Manual founder override via `/api/command`

---

## Debugging Commands

### If Server Crashes

```bash
# Check crash logs
tail -f logs/crash.log

# Check failed orders
tail -f logs/failed_orders.log

# Check Kalshi WebSocket logs
tail -f logs/kalshi.log
```

### If Database Corrupted

```bash
# Restore from backup (if available)
cp data/genesis.db.backup data/genesis.db

# Or reset (loses all trade history)
rm data/genesis.db
npm run start:ui  # Recreates schema
```

### If Auth Broken in Production

```bash
# Set API_SECRET in env
export API_SECRET="<new-token>"

# Or disable temporarily
export NODE_ENV=development

# Restart
npm run server
```

---

## Rollback Strategy

If critical issue found:

1. **Immediate:** Revert commit
   ```bash
   git revert f9c8944
   git push origin blackleets-ubiquitous-adventure
   ```

2. **Render auto-redeploys** (watch logs)

3. **Verify:** Server starts without P0 modules
   ```bash
   curl $RENDER_URL/api/health
   # Should still work, but without P0 safeguards
   ```

---

## Success Criteria for P0 Complete

✓ All checks pass:
1. Code compiles (`npm run build`)
2. Server starts and initializes P0 modules
3. Logs show all 6 P0 components activated
4. Auth works in both dev and prod modes
5. Database tables created and populated
6. No errors in console or logs
7. `/api/health` returns expected status

✓ Ready to proceed when user confirms all above ✓

---

## Questions / Contact

If anything fails:
1. Check logs (see Debugging Commands above)
2. Verify environment variables set
3. Run `npm run typecheck` to check for TS errors
4. Restart: `npm run start:ui` with fresh terminal

**User: Review this file and decide when to proceed to Render testing.**
