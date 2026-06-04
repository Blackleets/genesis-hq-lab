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

import { generateMarketingContent } from './decisionEngine.mjs';
import { getCapital, getSnapshot, getRecentLessons } from './memoryStore.mjs';
import { runTradingCycle, runLearningCycle } from './trading/workflow.mjs';
import { runScalpingCycle } from './trading/scalpingWorkflow.mjs';
import { runPositionMonitor } from './trading/positionMonitor.mjs';
import { getTreasury } from './trading/treasury.mjs';
import { getDashboardMetrics } from './trading/analytics.mjs';
import { getOrgState, processExpiredSchedules, getRiskSettings, isDeptActive } from './command/orgState.mjs';

const INTERVAL_MS        = 5 * 60 * 1000;   // 5 minutes — standard swing cycle
const SCALP_INTERVAL_MS  = 10 * 60 * 1000;  // 10 minutes — scalping entry cycle
const MONITOR_INTERVAL_MS = 2 * 60 * 1000;  // 2 minutes — position monitor (stop/take-profit)
const AGENT_ID           = 'market-agent-1';
const ONCE               = process.argv.includes('--once');
const VERBOSE            = process.argv.includes('--verbose') || process.argv.includes('-v');

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

    // ── Trading cycle — only if dept is active ──
    if (!isDeptActive('prediction_markets')) {
      console.log('[agentRunner] Prediction markets paused by founder order');
      return summarize(start);
    }

    const trading = await runTradingCycle();
    console.log(`[agentRunner] Swing: scanned=${trading.scanned} qualified=${trading.qualified} vetoed=${trading.vetoed} debated=${trading.debated} executed=${trading.executed}`);

    return summarize(start);

  } catch (err) {
    console.error('[agentRunner] Tick error:', err.message);
    if (VERBOSE) console.error(err.stack);
  }
}

// ─── Position monitor tick — runs every 2 minutes ────────────────────────────
// Checks all open trades for stop-loss and take-profit triggers.
// This is what makes the system ACTIVE vs passive.

async function monitorTick(broadcast) {
  try {
    const result = await runPositionMonitor(broadcast);
    if (result.closed > 0) {
      console.log(`[positionMonitor] Checked ${result.checked} positions — closed ${result.closed} (stop/take-profit)`);
    }
  } catch (err) {
    console.error('[positionMonitor] Error:', err.message);
  }
}

// ─── Scalping tick — runs every 10 minutes ───────────────────────────────────
// Scans for fast scalp opportunities (1-7 day markets, high volume).
// Separate from the main 5-min swing cycle.

async function scalpTick() {
  try {
    const orgState = getOrgState();
    if (orgState.mode === 'rest' || orgState.mode === 'emergency') return;
    if (!isDeptActive('prediction_markets')) return;

    const result = await runScalpingCycle();
    if (result.executed > 0 || result.circuitBreaker) {
      console.log(
        `[scalping] Tick: candidates=${result.scanned} vetoed=${result.vetoed} ` +
        `debated=${result.debated} executed=${result.executed}${result.circuitBreaker ? ' [CIRCUIT BREAKER]' : ''}`
      );
    }
  } catch (err) {
    console.error('[scalping] Tick error:', err.message);
  }
}

// ─── Marketing tick (runs every 6 hours) ─────────────────────────────────────

async function marketingTick() {
  try {
    const snapshot = await getSnapshot();
    if (snapshot.performance.totalTrades === 0) return;

    const content = await generateMarketingContent({
      trades:   snapshot.performance.totalTrades,
      winRate:  (snapshot.performance.winRate * 100).toFixed(1) + '%',
      pnl:      '$' + snapshot.performance.totalPnL.toFixed(2),
      lessons:  snapshot.lessons.length,
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
    const metrics  = getDashboardMetrics();
    console.log(
      `[agentRunner] Tick ${elapsed}s | Capital: $${treasury.available.toFixed(2)} | ` +
      `Open: ${metrics.risk.openTrades} | WinRate: ${(metrics.performance.winRate*100).toFixed(1)}% | ` +
      `PnL: $${metrics.performance.totalPnl.toFixed(2)} | Brier: ${metrics.risk.brierScore?.score ?? 'N/A'}`
    );
  } catch {
    console.log(`[agentRunner] Tick done in ${elapsed}s`);
  }
}

// ─── Main loop ────────────────────────────────────────────────────────────────

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║          GÉNESIS HQ — AGENT RUNNER                        ║');
console.log('║  Paper trading · Polymarket + Kalshi · Learning loop      ║');
console.log(`║  Mode: ${ONCE ? 'SINGLE RUN' : `CONTINUOUS (every ${INTERVAL_MS/60000} min)`}`.padEnd(62) + '║');
console.log('╚════════════════════════════════════════════════════════════╝');

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('⚠️  ANTHROPIC_API_KEY not set in .env — decision engine disabled');
  console.error('   Set it in .env and restart: ANTHROPIC_API_KEY=sk-ant-...');
  if (ONCE) process.exit(1);
}

// Run immediately
await tick();

if (!ONCE) {
  // Standard swing cycle — every 5 minutes
  setInterval(tick, INTERVAL_MS);

  // ── Position monitor — every 2 minutes ──
  // Must run BEFORE scalp tick so exited positions free up capital
  setInterval(() => monitorTick(null), MONITOR_INTERVAL_MS);
  setTimeout(() => monitorTick(null), 30_000);  // first check after 30s

  // ── Scalping cycle — every 10 minutes ──
  setInterval(scalpTick, SCALP_INTERVAL_MS);
  setTimeout(scalpTick, 60_000);  // first scalp scan after 1 minute

  // Marketing agent every 6 hours
  setInterval(marketingTick, 6 * 60 * 60 * 1000);
  setTimeout(marketingTick, 10000); // initial run after 10s

  console.log(
    `\n[agentRunner] Running.\n` +
    `  Swing cycle:      every ${INTERVAL_MS/60000} min\n` +
    `  Scalp cycle:      every ${SCALP_INTERVAL_MS/60000} min\n` +
    `  Position monitor: every ${MONITOR_INTERVAL_MS/60000} min (stop-loss + take-profit)\n` +
    `Ctrl+C to stop.\n`
  );
}
