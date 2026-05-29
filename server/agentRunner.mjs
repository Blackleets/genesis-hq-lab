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

import { scanMarkets } from './marketScanner.mjs';
import { analyzeMarkets, generateMarketingContent } from './decisionEngine.mjs';
import { checkAndLearn, expireStalesTrades } from './learningLoop.mjs';
import {
  getCapital, saveTrade, getOpenTrades, getSnapshot,
  getAgentStats, getRecentLessons,
} from './memoryStore.mjs';
// SQLite memory system — active after trades close
import { analyzeClosedTrade } from './memory/learningEngine.mjs';
import { updateAfterTrade, getLeaderboard } from './memory/agentScoring.mjs';
import { checkVeto, logVeto } from './memory/mistakePrevention.mjs';
import { saveTrade as dbSaveTrade } from './memory/tradingMemory.mjs';

const INTERVAL_MS   = 5 * 60 * 1000;  // 5 minutes
const AGENT_ID      = 'market-agent-1';
const ONCE          = process.argv.includes('--once');
const VERBOSE       = process.argv.includes('--verbose') || process.argv.includes('-v');

let tickCount = 0;

// ─── Single tick ──────────────────────────────────────────────────────────────

async function tick() {
  tickCount++;
  const start = Date.now();
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`[agentRunner] TICK #${tickCount} — ${new Date().toLocaleTimeString()}`);

  try {
    // ── Step 1: Check and learn from resolved trades first ──
    const { checked, closed, lessons } = await checkAndLearn();
    await expireStalesTrades();
    if (closed > 0) console.log(`[agentRunner] Closed ${closed} trades, generated ${lessons} lessons`);

    // ── Step 2: Scan markets ──
    const markets = await scanMarkets();
    if (markets.length === 0) {
      console.log('[agentRunner] No markets available, skipping decision');
      return summarize(start);
    }

    // ── Step 3: Get current state ──
    const [capital, openTrades] = await Promise.all([getCapital(), getOpenTrades()]);
    const openCount = openTrades.length;

    if (VERBOSE) {
      console.log(`[agentRunner] Capital: $${capital.available.toFixed(2)} available`);
      console.log(`[agentRunner] Open trades: ${openCount}/5`);
      console.log(`[agentRunner] Top market: ${markets[0]?.question?.slice(0, 60)}...`);
    }

    // ── Step 4: Get decision from Claude ──
    const decision = await analyzeMarkets(markets, openCount);
    if (!decision) return summarize(start);

    console.log(`[agentRunner] Decision: ${decision.action}${decision.action === 'BUY' ? ` — ${decision.outcome} on "${decision.marketQuestion?.slice(0, 50)}"` : ''}`);
    if (decision.action === 'SKIP') {
      console.log(`[agentRunner] Skip reason: ${decision.skipReason ?? decision.reason}`);
      return summarize(start);
    }

    // ── Step 5: Execute paper trade ──
    if (decision.action === 'BUY') {
      if (!decision.marketId) {
        console.warn('[agentRunner] BUY decision missing marketId, skipping');
        return summarize(start);
      }

      const tradeCapital = Math.min(
        decision.capitalUsed ?? (capital.available * 0.05),
        capital.available * 0.05  // enforce 5% max
      );
      const shares = decision.shares ?? Math.floor(tradeCapital / decision.entryPrice);

      if (shares < 1 || tradeCapital < 0.5) {
        console.log('[agentRunner] Trade too small (< $0.50), skipping');
        return summarize(start);
      }

      const trade = {
        id:             `trade-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        agentId:        AGENT_ID,
        marketId:       decision.marketId,
        marketSource:   decision.marketSource,
        marketQuestion: decision.marketQuestion,
        outcome:        decision.outcome,
        entryPrice:     decision.entryPrice,
        shares,
        capitalUsed:    tradeCapital,
        confidence:     decision.confidence,
        reason:         decision.reason,
        evidence:       decision.evidence,
        risk:           decision.risk,
        status:         'open',
        openedAt:       new Date().toISOString(),
        daysToClose:    decision.daysToClose,
      };

      await saveTrade(trade);

      // Update available capital (deduct from available, will be restored on close)
      capital.available -= tradeCapital;
      capital.inTrades  += tradeCapital;
      await Promise.resolve(); // saveTrade already handles capital through closeTrade

      console.log(`[agentRunner] TRADE OPENED: ${trade.outcome} on ${trade.marketSource}:${trade.marketId}`);
      console.log(`[agentRunner]   Capital: $${tradeCapital.toFixed(2)} | Confidence: ${(decision.confidence*100).toFixed(0)}%`);
      console.log(`[agentRunner]   Evidence: ${decision.evidence?.join(' + ')}`);
    }

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
  const snapshot = await getSnapshot();
  console.log(`[agentRunner] Tick done in ${elapsed}s | Open: ${snapshot.trades.open} | Closed: ${snapshot.trades.closed} | PnL: $${snapshot.performance.totalPnL.toFixed(2)} | Lessons: ${(await getRecentLessons(999)).length}`);
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
  // Then on interval
  setInterval(tick, INTERVAL_MS);

  // Marketing agent every 6 hours
  setInterval(marketingTick, 6 * 60 * 60 * 1000);
  setTimeout(marketingTick, 10000); // initial run after 10s

  console.log(`\n[agentRunner] Running. Next tick in ${INTERVAL_MS/60000} min. Ctrl+C to stop.\n`);
}
