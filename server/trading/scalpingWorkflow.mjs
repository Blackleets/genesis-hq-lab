// scalpingWorkflow.mjs — fast scalping pipeline for Genesis HQ.
//
// Philosophy: in prediction markets, "scalping" = finding markets where the
// current price is temporarily wrong (news broke, sentiment shifted) and there
// is edge to enter → then actively manage the exit via positionMonitor.
//
// This pipeline is FASTER and TIGHTER than the standard workflow:
//   - 1-7 day markets only (vs 1-45 for swing)
//   - $5k+/day volume (very liquid)
//   - 3% max position (vs 5% swing)
//   - 0.70 min confidence (vs 0.65 swing)
//   - Debate is faster: single analyst + arbiter (saves tokens, saves time)
//   - Runs every 10 minutes (vs 5-min standard — scalping needs more context before firing)
//
// positionMonitor.mjs handles exits — this file handles entries only.

import { scanMarkets } from '../marketScanner.mjs';
import { runDebate } from './debateRoom.mjs';
import { getTreasury, reserveCapital } from './treasury.mjs';
import { checkVeto, logVeto } from '../memory/mistakePrevention.mjs';
import { getDecisionContext } from '../memory/learningEngine.mjs';
import { saveTrade } from '../memory/tradingMemory.mjs';
import { getMarketSignals, researchMarket } from '../research/researchAgent.mjs';
import { getScalpingCircuitBreaker } from './positionMonitor.mjs';
import db from '../db/database.mjs';
import { nanoid } from '../utils.mjs';

// ─── Scalping constants ───────────────────────────────────────────────────────

const SCALP = {
  maxOpenPositions: 3,       // max concurrent scalp trades
  maxCapitalPct:    0.03,    // 3% per scalp (tighter than 5% swing)
  maxDailyTrades:   12,      // more aggressive than 8 for swing
  minHorizon:       1,       // days to close (min)
  maxHorizon:       7,       // days to close (max) — KEY DIFFERENTIATOR
  minVolume24h:     5_000,   // must have real daily volume
  minVolumeTotal:   15_000,  // market must have established depth
  minConfidence:    0.70,    // higher bar — we need conviction for scalps
  priceMin:         0.12,    // don't scalp near-impossible outcomes
  priceMax:         0.88,    // don't scalp near-certain outcomes
  maxDrawdown:      0.08,    // circuit breaker: pause all scalps at 8% drawdown
};

// ─── STEP 1: Scan for scalp candidates ───────────────────────────────────────

async function scanScalpCandidates() {
  const allMarkets = await scanMarkets();

  // Strict scalp filter — much tighter than standard qualify
  const candidates = allMarkets.filter(m =>
    m.daysToClose  >= SCALP.minHorizon    &&
    m.daysToClose  <= SCALP.maxHorizon    &&
    m.volume24h    >= SCALP.minVolume24h  &&
    m.volumeTotal  >= SCALP.minVolumeTotal &&
    m.yesPrice     >= SCALP.priceMin      &&
    m.yesPrice     <= SCALP.priceMax
  );

  // Sort by: highest 24h volume (most active = most opportunity to exit)
  candidates.sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0));

  console.log(`[scalping] SCAN: ${candidates.length}/${allMarkets.length} scalp candidates (1-7d, $5k+ vol/day)`);
  return candidates;
}

// ─── STEP 2: Hard pre-checks (no Claude) ─────────────────────────────────────

function preCheckScalp(market) {
  const treasury = getTreasury();

  // Drawdown circuit breaker (tighter than swing)
  if (treasury.drawdownPct >= SCALP.maxDrawdown) {
    return { ok: false, reason: `Scalp circuit breaker: drawdown at ${(treasury.drawdownPct*100).toFixed(1)}%` };
  }

  // Open scalp count limit
  const openScalps = db.prepare(
    `SELECT COUNT(*) AS cnt FROM trades WHERE status = 'open' AND trade_type = 'scalp'`
  ).get()?.cnt ?? 0;
  if (openScalps >= SCALP.maxOpenPositions) {
    return { ok: false, reason: `Max ${SCALP.maxOpenPositions} scalp positions open (${openScalps} active)` };
  }

  // Daily scalp limit
  const todayScalps = db.prepare(`
    SELECT COUNT(*) AS cnt FROM trades
    WHERE trade_type = 'scalp'
      AND date(opened_at) = date('now')
      AND status != 'vetoed'
  `).get()?.cnt ?? 0;
  if (todayScalps >= SCALP.maxDailyTrades) {
    return { ok: false, reason: `Daily scalp limit reached (${todayScalps}/${SCALP.maxDailyTrades})` };
  }

  // Duplicate market check
  const dup = db.prepare(`SELECT id FROM trades WHERE market_id = ? AND status = 'open'`).get(market.id);
  if (dup) {
    return { ok: false, reason: `Already have open position on this market` };
  }

  // Available capital check
  const maxPositionUSD = treasury.available * SCALP.maxCapitalPct;
  if (maxPositionUSD < 1) {
    return { ok: false, reason: `Insufficient capital for scalp: $${treasury.available.toFixed(2)} available` };
  }

  return { ok: true, maxPositionUSD, openScalps };
}

// ─── STEP 3: Veto check ───────────────────────────────────────────────────────

function vetoCheck(market) {
  const proposal = {
    marketId:       market.id,
    marketSource:   market.source,
    marketQuestion: market.question,
    marketCategory: market.category ?? 'general',
    outcome:        market.yesPrice >= 0.5 ? 'YES' : 'NO',
    yesPrice:       market.yesPrice,
    noPrice:        market.noPrice,
    volumeTotal:    market.volumeTotal,
    daysToClose:    market.daysToClose,
    confidence:     SCALP.minConfidence,
    entryPrice:     market.yesPrice >= 0.5 ? market.yesPrice : market.noPrice,
    agentId:        'scalp-agent-1',
  };
  const veto = checkVeto(proposal);
  if (veto.vetoed) logVeto(proposal, veto);
  return { proposal, veto };
}

// ─── STEP 4: Fast debate (optimized for speed) ────────────────────────────────

async function fastDebate(market) {
  const ctx = getDecisionContext(market.category ?? 'general', market.yesPrice - 0.1, market.yesPrice + 0.1);

  let signals = [];
  try {
    const signal = await researchMarket(market);
    if (signal) signals = [signal, ...getMarketSignals(market)];
  } catch { /* research is best-effort */ }

  // Standard debate — same quality, same Haiku call
  const result = await runDebate(market, ctx.lessons, ctx.rules, signals);

  // Scalping requires HIGHER confidence than standard debate
  if (result.action === 'TRADE' && result.confidence < SCALP.minConfidence) {
    console.log(`[scalping] DEBATE: confidence ${(result.confidence*100).toFixed(0)}% below scalp threshold ${SCALP.minConfidence*100}% — SKIP`);
    return { ...result, action: 'SKIP', skipReason: `Confidence too low for scalp: ${(result.confidence*100).toFixed(0)}%` };
  }

  return result;
}

// ─── STEP 5: Size and execute scalp ──────────────────────────────────────────

function executeScalp(market, debate, maxPositionUSD) {
  const intendedPrice = debate.outcome === 'YES' ? market.yesPrice : market.noPrice;

  // Half-Kelly capped at 3% (tighter than standard 5%)
  const b        = (1 / intendedPrice) - 1;
  const p        = debate.confidence;
  const q        = 1 - p;
  const kelly    = b > 0 ? (b * p - q) / b : 0;
  const halfK    = kelly / 2;
  const fraction = Math.max(0, Math.min(SCALP.maxCapitalPct, halfK));

  const treasury    = getTreasury();
  const dollarSize  = Math.min(
    Math.floor(treasury.available * fraction * 100) / 100,
    maxPositionUSD
  );

  if (dollarSize < 0.50) {
    return { executed: false, reason: `Position too small: $${dollarSize.toFixed(2)}` };
  }

  const reservation = reserveCapital(dollarSize);
  if (!reservation.ok) {
    return { executed: false, reason: reservation.reason };
  }

  const shares  = Math.floor(dollarSize / intendedPrice);
  const tradeId = `scalp-${nanoid()}`;

  saveTrade({
    id:             tradeId,
    agentId:        'scalp-agent-1',
    marketId:       market.id,
    marketSource:   market.source,
    marketQuestion: market.question,
    marketCategory: market.category ?? 'general',
    outcome:        debate.outcome,
    entryPrice:     intendedPrice,
    shares,
    capitalUsed:    dollarSize,
    confidence:     debate.confidence,
    reason:         debate.arbiterSummary ?? 'Scalp entry',
    evidence: [
      ...(debate.bull?.evidence ?? []),
      `Scalp: ${market.daysToClose}d horizon | $${market.volume24h?.toFixed(0) ?? '?'}/day volume`,
      `Kelly: ${(fraction*100).toFixed(1)}% | TP: +28% | SL: -20%`,
    ],
    openedAt:     new Date().toISOString(),
    daysToClose:  market.daysToClose,
    tradeType:    'scalp',
  });

  console.log(
    `[scalping] EXECUTED: ${debate.outcome} on ${market.source}:${market.id}\n` +
    `[scalping]   $${dollarSize.toFixed(2)} | ${market.daysToClose}d | conf: ${(debate.confidence*100).toFixed(0)}% | TP: +28% SL: -20%`
  );

  return { executed: true, tradeId, dollarSize, fraction, intendedPrice, shares };
}

// ─── Main scalping cycle ──────────────────────────────────────────────────────

export async function runScalpingCycle() {
  const result = { scanned: 0, candidates: 0, vetoed: 0, debated: 0, executed: 0, skipped: 0, circuitBreaker: false };

  // Check circuit breaker first (3 consecutive stop-losses)
  const cb = getScalpingCircuitBreaker();
  if (cb.tripped) {
    console.log(`[scalping] CIRCUIT BREAKER: ${cb.reason}`);
    result.circuitBreaker = true;
    return result;
  }

  // Scan
  const candidates = await scanScalpCandidates();
  result.scanned    = candidates.length;

  if (candidates.length === 0) return result;

  // Try up to top 5 candidates
  for (const market of candidates.slice(0, 5)) {
    // Pre-check (no Claude)
    const pre = preCheckScalp(market);
    if (!pre.ok) {
      console.log(`[scalping] PRE-CHECK FAIL: ${pre.reason}`);
      result.skipped++;
      // If it's a hard limit (max positions), stop trying
      if (pre.reason.includes('Max') || pre.reason.includes('circuit breaker') || pre.reason.includes('Daily')) break;
      continue;
    }

    // Veto check (SQLite patterns)
    const { veto } = vetoCheck(market);
    if (veto.vetoed) {
      result.vetoed++;
      continue;
    }

    // Fast debate (Claude Haiku)
    const debate = await fastDebate(market);
    result.debated++;

    if (debate.action !== 'TRADE') {
      console.log(`[scalping] SKIP: ${market.question?.slice(0, 40)} — ${debate.skipReason ?? 'No edge found'}`);
      result.skipped++;
      continue;
    }

    // Execute
    const exec = executeScalp(market, debate, pre.maxPositionUSD);
    if (exec.executed) {
      result.executed++;
      break; // one scalp per cycle — quality over quantity
    } else {
      console.log(`[scalping] EXEC FAIL: ${exec.reason}`);
    }
  }

  return result;
}
