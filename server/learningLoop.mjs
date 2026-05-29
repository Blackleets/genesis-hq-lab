// learningLoop — checks open trades against resolved markets and generates lessons.
// This is where Genesis HQ actually learns: closed trade → analyze → new rule.
// Runs inside agentRunner after each market scan.

import { getOpenTrades, closeTrade, saveLesson, updateAgentStats } from './memoryStore.mjs';
import { getMarketStatus } from './marketScanner.mjs';
import { generateLesson } from './decisionEngine.mjs';

export async function checkAndLearn() {
  const openTrades = await getOpenTrades();
  if (openTrades.length === 0) return { checked: 0, closed: 0, lessons: 0 };

  console.log(`[learningLoop] Checking ${openTrades.length} open trades...`);

  let closed = 0;
  let lessons = 0;

  for (const trade of openTrades) {
    // Check if market has resolved
    const status = await getMarketStatus(trade.marketSource, trade.marketId);
    if (!status || status.status !== 'resolved' || !status.result) continue;

    // Close the trade
    const resolvedOutcome = status.result.toUpperCase(); // 'YES' | 'NO'
    const closedTrade = await closeTrade(trade.id, resolvedOutcome, null);
    if (!closedTrade) continue;
    closed++;

    const won = closedTrade.pnl > 0;
    console.log(`[learningLoop] Trade ${trade.id} closed: ${won ? 'WIN' : 'LOSS'} PnL=$${closedTrade.pnl?.toFixed(2)}`);

    // Update agent stats
    await updateAgentStats(trade.agentId ?? 'market-agent-1', closedTrade);

    // Generate lesson via Claude Haiku
    const lessonData = await generateLesson(closedTrade, trade.marketQuestion ?? trade.marketId);
    if (lessonData) {
      await saveLesson({
        tradeId:   trade.id,
        marketId:  trade.marketId,
        outcome:   won ? 'win' : 'loss',
        pnl:       closedTrade.pnl,
        agentId:   trade.agentId ?? 'market-agent-1',
        ...lessonData,
      });
      lessons++;
      console.log(`[learningLoop] Lesson: ${lessonData.lesson}`);
    }

    // Small delay between API calls
    await new Promise(r => setTimeout(r, 500));
  }

  return { checked: openTrades.length, closed, lessons };
}

// Check for stale trades (open > 50 days) and force-close as expired
export async function expireStalesTrades() {
  const openTrades = await getOpenTrades();
  const now = Date.now();
  let expired = 0;

  for (const trade of openTrades) {
    const openedMs = new Date(trade.openedAt).getTime();
    const daysOpen = (now - openedMs) / 86400000;
    if (daysOpen > 50) {
      await closeTrade(trade.id, trade.outcome === 'YES' ? 'NO' : 'YES', 0); // expired as loss
      expired++;
      console.log(`[learningLoop] Expired stale trade ${trade.id} (${daysOpen.toFixed(0)} days old)`);
    }
  }

  return expired;
}
