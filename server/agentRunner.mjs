#!/usr/bin/env node
// agentRunner — the autonomous Genesis HQ agent loop.
//
// Usage:
//   npm run agent          (runs continuously, every 5 min)
//   npm run agent -- --once (single run for testing)
//
// What it does each tick:
//   1. Scan Polymarket + Kalshi for opportunities
//   2. Get recent lessons from memory
//   3. Ask Claude Haiku to decide: BUY or SKIP
//   4. If BUY: execute paper trade and save to memory
//   5. Check open trades against resolved markets
//   6. Generate lessons from closed trades
//   7. Log status to console + write to data/memory/

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateMarketingContent } from './decisionEngine.mjs';
import { getCapital, getSnapshot, getRecentLessons } from './memoryStore.mjs';
import { runTradingCycle, runLearningCycle } from './trading/workflow.mjs';
import { getTreasury } from './trading/treasury.mjs';
import { runStartupReconciliation, getReconciliationStatus, isSafeMode } from './memory/reconciliationEngine.mjs';
import { runWeightCalibrationCycle } from './learning/learningEngine.mjs';
import { refreshGlobalRiskScore, getGlobalRiskDiagnostics } from './risk/globalRiskEngine.mjs';
import { getDashboardMetrics } from './trading/analytics.mjs';
import { getOrgState, processExpiredSchedules, getRiskSettings, isDeptActive } from './command/orgState.mjs';
import { runCryptoTradingCycle, manageCryptoPositions } from './crypto/cryptoWorkflow.mjs';
import { startScheduler, triggerSlow } from './trading/executionScheduler.mjs';
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

const __dir = dirname(fileURLToPath(import.meta.url));
const STATUS_FILE = join(__dir, '..', 'data', 'agent-status.json');

let _agentStatus = {};

function writeAgentStatus(update) {
  try {
    _agentStatus = { ..._agentStatus, ...update, updatedAt: new Date().toISOString() };
    writeFileSync(STATUS_FILE, JSON.stringify(_agentStatus, null, 2), 'utf8');
  } catch { /* never block the agent loop */ }
}

process.on('unhandledRejection', (reason) => {
  console.error('[agentRunner] ⚠ UNHANDLED REJECTION:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[agentRunner] ✖ UNCAUGHT EXCEPTION:', err);
  process.exit(1);
});

const INTERVAL_MS = 5 * 60 * 1000;  // 5 minutes
const AGENT_ID = 'market-agent-1';
const ONCE = process.argv.includes('--once');
const VERBOSE = process.argv.includes('--verbose') || process.argv.includes('-v');
const FUTURES_ONLY_MODE = !['0', 'false', 'no', 'off'].includes((process.env.FUTURES_ONLY_MODE ?? 'true').toLowerCase());
const PREDICTION_AGENT_ENABLED = !FUTURES_ONLY_MODE && !['0', 'false', 'no', 'off'].includes((process.env.PREDICTION_AGENT_ENABLED ?? 'true').toLowerCase());
const LEGACY_CRYPTO_LOOP_ENABLED = !FUTURES_ONLY_MODE && !['0', 'false', 'no', 'off'].includes((process.env.LEGACY_CRYPTO_LOOP_ENABLED ?? 'true').toLowerCase());

let tickCount = 0;

// ─── Single tick ──────────────────────────────────────────────────────────────

async function tick() {
  tickCount++;
  const start = Date.now();
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`[agentRunner] TICK #${tickCount} — ${new Date().toLocaleTimeString()}`);

  try {
    // ── Step 0: Read org-state and obey founder orders ──
    processExpiredSchedules();
    const orgState = getOrgState();

    if (orgState.mode === 'rest') {
      console.log('[agentRunner] 💤 REST mode — all agents paused by founder order');
      return summarize(start);
    }

    if (orgState.mode === 'emergency') {
      console.log('[agentRunner] 🚨 EMERGENCY mode — only sentinel active');
      return summarize(start);
    }

    if (VERBOSE) {
      console.log(`[agentRunner] Mode: ${orgState.mode} | Risk: ${orgState.riskTolerance}`);
      if (orgState.focus) console.log(`[agentRunner] Focus: ${orgState.focus.topic}`);
      if (orgState.goal) console.log(`[agentRunner] Goal: ${orgState.goal.description}`);
    }

    // ── Learning cycle first (close resolved trades, generate lessons) ──
    const learning = await runLearningCycle();
    if (learning.closed > 0) {
      console.log(`[agentRunner] Learning: ${learning.closed} trades closed, ${learning.learned} lessons generated`);
    }

    // ── Weight calibration cycle (rate-limited to 30 min) ──
    try {
      await runWeightCalibrationCycle(isSafeMode());
    } catch (err) {
      console.warn('[agentRunner] Weight calibration cycle error:', err?.message);
    }

    // ── Global risk refresh (runs on every tick, updates system risk score) ──
    try {
      const riskResult = await refreshGlobalRiskScore();
      if (riskResult.band === 'HIGH_RISK' || riskResult.band === 'CRITICAL') {
        console.log(`[agentRunner] ⚠️  RISK: ${riskResult.score}/100 (${riskResult.band}) — ${riskResult.flags?.[0] ?? 'see risk_events.log'}`);
      }
    } catch (err) {
      console.warn('[agentRunner] Global risk refresh error:', err?.message);
    }

    // ── Trading cycle — only if dept is active ──
    if (!PREDICTION_AGENT_ENABLED) {
      console.log('[agentRunner] Prediction-market tick disabled by config');
      return summarize(start);
    }

    if (!isDeptActive('prediction_markets')) {
      console.log('[agentRunner] Prediction markets paused by founder order');
      return summarize(start);
    }

    const trading = await runTradingCycle();
    console.log(`[agentRunner] Cycle: scanned=${trading.scanned} qualified=${trading.qualified} vetoed=${trading.vetoed} debated=${trading.debated} executed=${trading.executed}`);

    writeAgentStatus({
      tickCount: _tickCount + 1,
      lastTickAt: new Date().toISOString(),
      lastSwing: {
        scanned: trading.scanned,
        qualified: trading.qualified,
        vetoed: trading.vetoed,
        debated: trading.debated,
        executed: trading.executed,
        closedByLearning: learning.closed,
        lessonsGenerated: learning.learned,
        at: new Date().toISOString(),
      },
      nextSwingAt: new Date(Date.now() + INTERVAL_MS).toISOString(),
    });

    return summarize(start);

  } catch (err) {
    console.error('[agentRunner] Tick error:', err.message);
    if (VERBOSE) console.error(err.stack);
  }
}

// ─── Marketing tick (runs every 6 hours) ─────────────────────────────────────

async function marketingTick() {
  try {
    const snapshot = await getSnapshot();
    if (snapshot.performance.totalTrades === 0) return;

    const content = await generateMarketingContent({
      trades: snapshot.performance.totalTrades,
      winRate: (snapshot.performance.winRate * 100).toFixed(1) + '%',
      pnl: '$' + snapshot.performance.totalPnL.toFixed(2),
      lessons: snapshot.lessons.length,
      topLesson: snapshot.lessons[snapshot.lessons.length - 1]?.lesson ?? null,
    });

    if (content.insight) {
      console.log(`[marketingAgent] Insight: ${content.insight}`);
      // Content is available via /api/agent/marketing for the frontend to display
      const { writeFile } = await import('node:fs/promises');
      const { join, dirname } = await import('node:path');
      const { fileURLToPath } = await import('node:url');
      const __dir = dirname(fileURLToPath(import.meta.url));
      await writeFile(
        join(__dir, '..', 'data', 'memory', 'marketing.json'),
        JSON.stringify({ ...content, generatedAt: new Date().toISOString() }, null, 2),
        'utf8'
      );
    }
  } catch (err) {
    console.error('[marketingAgent] Error:', err.message);
  }
}

// ─── Summary ──────────────────────────────────────────────────────────────────

async function summarize(startMs) {
  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  try {
    const treasury = getTreasury();
    const metrics = getDashboardMetrics();
    console.log(
      `[agentRunner] Tick ${elapsed}s | Capital: $${treasury.available.toFixed(2)} | ` +
      `Open: ${metrics.risk.openTrades} | WinRate: ${(metrics.performance.winRate * 100).toFixed(1)}% | ` +
      `PnL: $${metrics.performance.totalPnl.toFixed(2)} | Brier: ${metrics.risk.brierScore?.score ?? 'N/A'}`
    );
  } catch {
    console.log(`[agentRunner] Tick done in ${elapsed}s`);
  }

  // Write heartbeat so /api/health can confirm agent is ticking
  try {
    const { writeFile } = await import('node:fs/promises');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const __dir = dirname(fileURLToPath(import.meta.url));
    await writeFile(
      join(__dir, '..', 'data', 'memory', 'agent_heartbeat.json'),
      JSON.stringify({
        lastTickAt: new Date().toISOString(),
        totalCycles: ++_tickCount,
        claudeEnabled: !!process.env.ANTHROPIC_API_KEY,
      }),
      'utf8'
    );
  } catch { /* never block the agent loop */ }
}

// ─── Heartbeat counter ───────────────────────────────────────────────────────
let _tickCount = 0;

// ─── Main loop ────────────────────────────────────────────────────────────────

const REAL_TRADING_MODE = ['1', 'true', 'yes'].includes((process.env.REAL_TRADING ?? '').toLowerCase());

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║          GÉNESIS HQ — AGENT RUNNER                        ║');
console.log(`║  ${REAL_TRADING_MODE ? 'Real trading' : 'Paper trading'} · Polymarket + Kalshi · Learning loop`.padEnd(62) + '║');
console.log(`║  Mode: ${ONCE ? 'SINGLE RUN' : `CONTINUOUS (every ${INTERVAL_MS / 60000} min)`}`.padEnd(62) + '║');
console.log('╚════════════════════════════════════════════════════════════╝');
if (FUTURES_ONLY_MODE) {
  console.log('[agentRunner] FUTURES_ONLY_MODE active — prediction tick and legacy crypto loop disabled');
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn('⚠️  ANTHROPIC_API_KEY not set in .env — decision engine disabled');
  console.warn('   The agent will continue using rule-based fallback debate logic. Set ANTHROPIC_API_KEY in .env to enable the full Claude decision engine.');
}

// ── Startup reconciliation — runs ONCE before the first tick ─────────────────
// Verifies all open positions against exchange state.
// If any position cannot be verified (network failure, conflict) → DEGRADED.
// In DEGRADED state, riskManager blocks all new trades until operator clears.
try {
  await runStartupReconciliation();
  const rStatus = getReconciliationStatus();
  if (rStatus.status === 'degraded') {
    console.error(
      `[agentRunner] ⚠️  SAFE_EXECUTION_MODE: ${rStatus.issues.length} unresolved issue(s). ` +
      `New trades blocked. POST /api/reconciliation/clear to resume after review.`
    );
  }
} catch (err) {
  // Reconciliation itself failed — enter degraded mode conservatively.
  console.error('[agentRunner] Startup reconciliation threw unexpectedly:', err?.message);
  // The reconciliationEngine will have persisted degraded state internally before throwing.
}

// ── Start the FAST paper-training engines + keep-awake FIRST ─────────────────
// These must NOT wait behind the slow prediction-market tick (Polymarket/Kalshi +
// Claude + reconciliation). On Render free tier a slow/cold first tick used to
// delay the scheduler indefinitely, leaving capital static. Boot → trade now.
if (!ONCE) {
  // Keep Render dyno awake — self-ping the public URL every 10 min (< 15 min idle
  // spin-down). Starting it here means a slow first tick can't let the dyno sleep.
  const _renderUrl = process.env.RENDER_EXTERNAL_URL;
  if (_renderUrl) {
    setInterval(() => { fetch(`${_renderUrl}/api/health`).catch(() => {}); }, 10 * 60 * 1000);
    setTimeout(() => { fetch(`${_renderUrl}/api/health`).catch(() => {}); }, 5000); // early ping
    console.log('[agentRunner] Self-ping active → keeping Render awake every 10 min');
  }

  // Phase 6A — tiered execution scheduler (FAST 5s / MID 30s / SLOW 5min). Starts
  // immediately so crypto paper training begins on boot, independent of the
  // prediction-market cycle.
  startScheduler();

  // Crypto scalping loop — every 1 minute (legacy path, also position management)
  if (LEGACY_CRYPTO_LOOP_ENABLED) {
    setInterval(async () => {
      try {
        await manageCryptoPositions();
        if (isDeptActive('crypto_scalping')) {
          const result = await runCryptoTradingCycle();
          if (result.executed) {
            console.log(`[cryptoScalper] ✓ Trade | scanned=${result.scanned} qualified=${result.qualified}`);
          } else if (result.qualified > 0) {
            console.log(`[cryptoScalper] No trade | scanned=${result.scanned} qualified=${result.qualified} debated=${result.debated}`);
          }
        }
      } catch (err) {
        console.error('[cryptoScalper] Loop error:', err.message);
      }
    }, 60 * 1000);
    console.log('[agentRunner] Crypto scalping loop active — 1 min interval');
  } else {
    console.log('[agentRunner] Legacy crypto loop disabled by config');
  }
}

// Run the (slower) prediction-market tick. Training is already live above.
if (FUTURES_ONLY_MODE && ONCE) {
  console.log('[agentRunner] Running one-shot futures scheduler tick');
  await triggerSlow();
} else if (PREDICTION_AGENT_ENABLED) {
  await tick();
} else {
  console.log('[agentRunner] Skipping prediction-market boot tick');
}

if (!ONCE) {
  // Then on interval
  if (PREDICTION_AGENT_ENABLED) {
    setInterval(tick, INTERVAL_MS);
  }

  // Marketing agent every 6 hours
  setInterval(marketingTick, 6 * 60 * 60 * 1000);
  setTimeout(marketingTick, 10000); // initial run after 10s

  console.log(`\n[agentRunner] Running. Next tick in ${INTERVAL_MS / 60000} min. Ctrl+C to stop.\n`);
}
