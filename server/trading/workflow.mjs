// workflow.mjs — the complete 5-step trading pipeline.
// SCAN → QUALIFY → DEBATE → SIZE → EXECUTE
// Every step can abort the trade. Every abort is logged with reason.
// This replaces the old analyzeMarkets() in decisionEngine.

import { scanMarkets } from '../marketScanner.mjs';
import { runDebate } from './debateRoom.mjs';
import { kellySize, reserveCapital } from './treasury.mjs';
import { preTradeCheck, recordTradeDecision } from './riskManager.mjs';
import { checkVeto, logVeto } from '../memory/mistakePrevention.mjs';
import { getDecisionContext } from '../memory/learningEngine.mjs';
import { executeTrade } from './execution.mjs';
import { updateAfterTrade } from '../memory/agentScoring.mjs';
import { analyzeClosedTrade } from '../memory/learningEngine.mjs';
import { closeTrade } from '../memory/tradingMemory.mjs';
import { settleTradeCapital } from './treasury.mjs';
import { getMarketStatus } from '../marketScanner.mjs';
import { researchMarket, getMarketSignals } from '../research/researchAgent.mjs';
import db from '../db/database.mjs';

// ─── STEP 1 — SCAN ────────────────────────────────────────────────────────────

async function stepScan() {
  const markets = await scanMarkets();
  console.log(`[workflow] SCAN: ${markets.length} markets found`);
  return markets;
}

// ─── STEP 2 — QUALIFY (no Claude) ────────────────────────────────────────────

function stepQualify(markets) {
  const qualified = markets.filter(m =>
    m.volumeTotal >= 5000 &&
    m.volume24h >= 200 &&
    m.yesPrice >= 0.08 &&
    m.yesPrice <= 0.92 &&
    m.daysToClose >= 1 &&
    m.daysToClose <= 45
  );
  console.log(`[workflow] QUALIFY: ${qualified.length}/${markets.length} pass filters`);
  return qualified;
}

// ─── STEP 3 — VETO CHECK (SQLite patterns, no Claude) ────────────────────────

function stepVetoCheck(market) {
  const proposal = {
    marketId: market.id,
    marketSource: market.source,
    marketQuestion: market.question,
    marketCategory: market.category ?? 'general',
    outcome: market.yesPrice >= 0.5 ? 'YES' : 'NO',
    yesPrice: market.yesPrice,
    noPrice: market.noPrice,
    volumeTotal: market.volumeTotal,
    daysToClose: market.daysToClose,
    confidence: 0.65,  // placeholder for veto check
    entryPrice: market.yesPrice >= 0.5 ? market.yesPrice : market.noPrice,
    agentId: 'market-agent-1',
  };

  const veto = checkVeto(proposal);
  if (veto.vetoed) {
    console.log(`[workflow] VETO: ${market.question?.slice(0, 40)} — ${veto.summary}`);
    logVeto(proposal, veto);
  }
  return { market, proposal, veto };
}

// ─── STEP 4 — DEBATE (Claude call) ───────────────────────────────────────────

async function stepDebate(market) {
  const ctx = getDecisionContext(market.category ?? 'general', market.yesPrice - 0.1, market.yesPrice + 0.1);

  // Fresh research signals (free news/HN sentiment) for this market
  let signals = [];
  try {
    const signal = await researchMarket(market);
    if (signal) signals = [signal];
    // Plus any recent stored signals for the category
    signals = [...signals, ...getMarketSignals(market)];
  } catch { /* research is best-effort, never blocks a trade */ }

  const result = await runDebate(market, ctx.lessons, ctx.rules, signals);

  console.log(`[workflow] DEBATE: ${result.action} (${market.question?.slice(0, 40)})`);
  if (result.action === 'SKIP') {
    console.log(`[workflow]   Skip: ${result.skipReason}`);
  } else {
    console.log(`[workflow]   Bet: ${result.outcome} @ ${(result.confidence * 100).toFixed(0)}% conf`);
    if (result.bull?.evidence) console.log(`[workflow]   Bull: ${result.bull.evidence.join(', ')}`);
  }

  return result;
}

// ─── STEP 5 — SIZE + EXECUTE ──────────────────────────────────────────────────

async function stepExecute(market, debateResult) {
  const intendedPrice = debateResult.outcome === 'YES' ? market.yesPrice : market.noPrice;
  const kellySizing = kellySize(debateResult.confidence, intendedPrice);

  if (kellySizing.skip) {
    console.log(`[workflow] SIZE: skip — ${kellySizing.reason}`);
    return { executed: false, reason: kellySizing.reason };
  }

  const proposal = {
    marketId: market.id,
    marketSource: market.source,
    marketQuestion: market.question,
    marketCategory: market.category ?? 'general',
    outcome: debateResult.outcome,
    yesPrice: market.yesPrice,
    noPrice: market.noPrice,
    volumeTotal: market.volumeTotal,
    daysToClose: market.daysToClose,
    confidence: debateResult.confidence,
    entryPrice: intendedPrice,
    capitalUsed: kellySizing.dollarSize,
    agentId: 'market-agent-1',
  };

  // Full risk check
  const riskCheck = preTradeCheck(proposal);
  if (!riskCheck.approved) {
    console.log(`[workflow] RISK BLOCK: ${riskCheck.errors[0]}`);
    return { executed: false, reason: riskCheck.errors[0], riskCheck };
  }

  // Reserve capital (checks drawdown + available balance)
  const reservation = reserveCapital(kellySizing.dollarSize);
  if (!reservation.ok) {
    console.log(`[workflow] CAPITAL: ${reservation.reason}`);
    return { executed: false, reason: reservation.reason };
  }

  const execution = await executeTrade({
    agentId: 'market-agent-1',
    marketId: market.id,
    marketSource: market.source,
    marketQuestion: market.question,
    marketCategory: market.category ?? 'general',
    outcome: debateResult.outcome,
    entryPrice: intendedPrice,
    shares: kellySizing.shares,
    capitalUsed: kellySizing.dollarSize,
    confidence: debateResult.confidence,
    volume24hUsd: market.volume24h ?? 0,
    reason: debateResult.arbiterSummary,
    evidence: [
      ...(debateResult.bull?.evidence ?? []),
      `Kelly fraction: ${(kellySizing.fraction * 100).toFixed(1)}%`,
      `Risk score: ${riskCheck.riskScore}/100`,
    ],
    openedAt: new Date().toISOString(),
    daysToClose: market.daysToClose,
  });

  if (!execution.executed) {
    console.log(`[workflow] EXECUTION FAILED: ${execution.reason}`);
    return { executed: false, reason: execution.reason, riskCheck };
  }

  if (riskCheck.warnings.length > 0) {
    console.log(`[workflow] WARNINGS: ${riskCheck.warnings.join(' | ')}`);
  }

  console.log(`[workflow] EXECUTED (${execution.mode}): ${debateResult.outcome} on ${market.source}:${market.id}`);
  if (execution.fallback) {
    console.log('[workflow]   Real execution failed; recorded fallback paper trade.');
  }
  console.log(`[workflow]   $${kellySizing.dollarSize.toFixed(2)} | Kelly: ${(kellySizing.fraction * 100).toFixed(1)}% | Risk: ${riskCheck.riskScore}/100`);

  return {
    executed: true,
    tradeId: execution.tradeId,
    market,
    debateResult,
    kellySizing,
    riskCheck,
    executionMode: execution.mode,
  };
}

// ─── MAIN WORKFLOW FUNCTION ───────────────────────────────────────────────────

export async function runTradingCycle() {
  const results = { scanned: 0, qualified: 0, vetoed: 0, debated: 0, executed: 0, tradeId: null };

  // 1. Scan
  const markets = await stepScan();
  results.scanned = markets.length;
  if (markets.length === 0) return results;

  // 2. Qualify (no Claude)
  const qualified = stepQualify(markets);
  results.qualified = qualified.length;
  if (qualified.length === 0) return results;

  // Try markets in order until one executes or we run out
  for (const market of qualified.slice(0, 10)) {
    // 3. Veto check (SQLite patterns, no Claude)
    const { veto } = stepVetoCheck(market);
    if (veto.vetoed) { results.vetoed++; continue; }

    // 4. Debate (Claude call)
    const debateResult = await stepDebate(market);
    results.debated++;
    if (debateResult.action !== 'TRADE') continue;

    // 5. Size + Execute
    const execution = await stepExecute(market, debateResult);
    if (execution.executed) {
      results.executed++;
      results.tradeId = execution.tradeId;
      break;  // one trade per cycle is enough
    }
  }

  return results;
}

// ─── LEARNING CYCLE — runs after trading cycle ────────────────────────────────

export async function runLearningCycle() {
  const openTrades = db.prepare(`
    SELECT * FROM trades WHERE status = 'open' ORDER BY opened_at ASC
  `).all();

  let closed = 0, learned = 0;

  for (const trade of openTrades) {
    // Check if market has resolved
    const status = await getMarketStatus(trade.market_source, trade.market_id);
    if (!status || status.status !== 'resolved' || !status.result) continue;

    const resolvedOutcome = status.result.toUpperCase();

    // Close the trade in SQLite
    const closedTrade = closeTrade(trade.id, resolvedOutcome);
    if (!closedTrade) continue;
    closed++;

    // Settle capital (returns funds + pnl to treasury)
    settleTradeCapital(trade.capital_used, closedTrade.pnl);

    // Update agent scoring
    updateAfterTrade(trade.agent_id ?? 'market-agent-1', closedTrade);

    // Generate lesson
    const lesson = await analyzeClosedTrade(closedTrade);
    if (lesson) learned++;

    console.log(`[workflow] CLOSED: ${trade.market_question?.slice(0, 40)} | PnL: $${(closedTrade.pnl ?? 0).toFixed(2)}`);

    await new Promise(r => setTimeout(r, 300)); // rate limit Claude calls
  }

  // Expire stale trades (>50 days open)
  const staleCount = db.prepare(`
    SELECT COUNT(*) AS cnt FROM trades
    WHERE status = 'open' AND julianday('now') - julianday(opened_at) > 50
  `).get()?.cnt ?? 0;

  if (staleCount > 0) {
    db.prepare(`
      UPDATE trades SET status = 'expired', closed_at = datetime('now')
      WHERE status = 'open' AND julianday('now') - julianday(opened_at) > 50
    `).run();
    console.log(`[workflow] EXPIRED: ${staleCount} stale trades`);
  }

  return { closed, learned, expired: staleCount };
}
