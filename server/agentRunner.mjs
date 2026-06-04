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
import { getTreasury } from './trading/treasury.mjs';
import { getDashboardMetrics } from './trading/analytics.mjs';
import { getOrgState, processExpiredSchedules, getRiskSettings, isDeptActive } from './command/orgState.mjs';

const INTERVAL_MS = 5 * 60 * 1000;  // 5 minutes
const AGENT_ID = 'market-agent-1';
const ONCE = process.argv.includes('--once');
const VERBOSE = process.argv.includes('--verbose') || process.argv.includes('-v');

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
    console.log(`[agentRunner] Cycle: scanned=${trading.scanned} qualified=${trading.qualified} vetoed=${trading.vetoed} debated=${trading.debated} executed=${trading.executed}`);

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

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn('⚠️  ANTHROPIC_API_KEY not set in .env — decision engine disabled');
  console.warn('   The agent will continue using rule-based fallback debate logic. Set ANTHROPIC_API_KEY in .env to enable the full Claude decision engine.');
}

// Run immediately
await tick();

if (!ONCE) {
  // Then on interval
  setInterval(tick, INTERVAL_MS);

  // Marketing agent every 6 hours
  setInterval(marketingTick, 6 * 60 * 60 * 1000);
  setTimeout(marketingTick, 10000); // initial run after 10s

  // Keep Render dyno awake — ping the public URL every 10 min to prevent sleep
  const _renderUrl = process.env.RENDER_EXTERNAL_URL;
  if (_renderUrl) {
    setInterval(() => { fetch(`${_renderUrl}/api/health`).catch(() => {}); }, 10 * 60 * 1000);
    console.log('[agentRunner] Self-ping active → will keep Render awake every 10 min');
  }

  console.log(`\n[agentRunner] Running. Next tick in ${INTERVAL_MS / 60000} min. Ctrl+C to stop.\n`);
}
