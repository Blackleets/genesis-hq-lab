// riskManager.mjs — position limits, drawdown protection, anti-gambling rules.
// This is what separates disciplined trading from gambling.
// Every rule here maps to a specific failure mode in the Constitution.

import db from '../db/database.mjs';
import { getTreasury } from './treasury.mjs';
import { isSafeMode } from '../memory/reconciliationEngine.mjs';
import { isGlobalSafeMode } from '../risk/globalRiskEngine.mjs';

// ─── Risk constants ───────────────────────────────────────────────────────────

const LIMITS = {
  maxOpenTrades:      5,
  maxPerCategory:     2,      // no more than 2 open in same category
  maxCapitalPerTrade: 0.05,   // 5% (constitution)
  maxDailyTrades:     8,      // prevents overtrading
  maxDrawdown:        0.15,   // pause at 15% from peak
  minConfidence:      0.65,   // must meet debate threshold
  minVolume:          5000,   // total market volume
  maxHorizon:         45,     // days to close
  cooldownAfterLoss:  0,      // minutes to wait after a loss (0 = no cooldown for now)
  maxLossStreak:      4,      // pause after 4 consecutive losses
};

// ─── Full pre-trade risk check ────────────────────────────────────────────────

export function preTradeCheck(proposal) {
  const errors   = [];   // hard blocks
  const warnings = [];   // soft flags (trade can proceed, but noted)

  const treasury = getTreasury();

  // ── Hard blocks ─────────────────────────────────────────────────────────────

  // 0a. Global risk safe mode — system-level block takes precedence over all other checks
  if (isGlobalSafeMode()) {
    errors.push('GLOBAL_RISK: system risk score ≥ 85 — safe mode active, all trading suspended');
  }

  // 0b. Safe mode — startup reconciliation is incomplete or degraded
  if (isSafeMode()) {
    errors.push(
      'SAFE_MODE: Startup reconciliation degraded — new trades blocked until operator ' +
      'reviews open positions and clears via POST /api/reconciliation/clear'
    );
  }

  // 1. Drawdown protection
  if (treasury.isPaused) {
    errors.push(`DRAWDOWN LIMIT: portfolio down ${(treasury.drawdownPct*100).toFixed(1)}% from peak. Trading paused.`);
  }

  // 2. Open trade count
  const openCount = db.prepare(`SELECT COUNT(*) AS cnt FROM trades WHERE status = 'open'`).get()?.cnt ?? 0;
  if (openCount >= LIMITS.maxOpenTrades) {
    errors.push(`MAX POSITIONS: ${openCount}/${LIMITS.maxOpenTrades} open trades. Wait for resolution.`);
  }

  // 3. Category concentration
  const categoryCount = db.prepare(`
    SELECT COUNT(*) AS cnt FROM trades
    WHERE status = 'open' AND market_category = ?
  `).get(proposal.marketCategory ?? 'general')?.cnt ?? 0;
  if (categoryCount >= LIMITS.maxPerCategory) {
    errors.push(`CATEGORY LIMIT: ${categoryCount}/${LIMITS.maxPerCategory} open in '${proposal.marketCategory}'. Diversify.`);
  }

  // 4. Daily trade limit (prevents overtrading)
  const todayCount = db.prepare(`
    SELECT COUNT(*) AS cnt FROM trades
    WHERE date(opened_at) = date('now') AND status != 'vetoed'
  `).get()?.cnt ?? 0;
  if (todayCount >= LIMITS.maxDailyTrades) {
    errors.push(`DAILY LIMIT: ${todayCount} trades today. Max ${LIMITS.maxDailyTrades}/day to prevent overtrading.`);
  }

  // 5. Loss streak
  const agent = db.prepare(`SELECT loss_streak FROM agent_profiles WHERE id = ?`).get(proposal.agentId ?? 'market-agent-1');
  if ((agent?.loss_streak ?? 0) >= LIMITS.maxLossStreak) {
    errors.push(`LOSS STREAK: ${agent.loss_streak} consecutive losses. System review required before resuming.`);
  }

  // 6. Market horizon
  if ((proposal.daysToClose ?? 999) > LIMITS.maxHorizon) {
    errors.push(`HORIZON: market closes in ${proposal.daysToClose} days. Max ${LIMITS.maxHorizon} days.`);
  }

  // 7. Duplicate market
  const dupTrade = db.prepare(`SELECT id FROM trades WHERE market_id = ? AND status = 'open'`).get(proposal.marketId);
  if (dupTrade) {
    errors.push(`DUPLICATE: already have open trade ${dupTrade.id} on this market.`);
  }

  // ── Soft warnings ────────────────────────────────────────────────────────────

  // 8. Low confidence
  if (proposal.confidence < 0.68 && proposal.confidence >= LIMITS.minConfidence) {
    warnings.push(`LOW CONFIDENCE: ${(proposal.confidence*100).toFixed(0)}% — marginally above threshold. High uncertainty.`);
  }

  // 9. Low volume
  if ((proposal.volumeTotal ?? 0) < 10000 && (proposal.volumeTotal ?? 0) >= LIMITS.minVolume) {
    warnings.push(`LOW VOLUME: $${proposal.volumeTotal?.toLocaleString()} — illiquid market, prices may not reflect reality.`);
  }

  // 10. Near-certain odds (no edge)
  const intendedPrice = proposal.outcome === 'YES' ? proposal.yesPrice : proposal.noPrice;
  if (intendedPrice > 0.88) {
    warnings.push(`NEAR CERTAINTY: paying ${(intendedPrice*100).toFixed(0)}% — minimal upside for the risk.`);
  }

  // 11. Capital usage near max
  if (proposal.capitalUsed > treasury.available * 0.04) {
    warnings.push(`LARGE POSITION: using ${((proposal.capitalUsed/treasury.available)*100).toFixed(1)}% of available capital.`);
  }

  // 12. Check for revenge trading pattern
  const lastTrade = db.prepare(`
    SELECT pnl, opened_at FROM trades
    WHERE status = 'closed' ORDER BY closed_at DESC LIMIT 1
  `).get();
  if (lastTrade && (lastTrade.pnl ?? 0) < -2) {
    const minAgo = (Date.now() - new Date(lastTrade.opened_at).getTime()) / 60000;
    if (minAgo < 10) {
      warnings.push(`REVENGE TRADING FLAG: opening trade ${minAgo.toFixed(0)} min after a loss of $${Math.abs(lastTrade.pnl).toFixed(2)}.`);
    }
  }

  return {
    approved: errors.length === 0,
    errors,
    warnings,
    riskScore: computeRiskScore(proposal, treasury, errors, warnings),
  };
}

// ─── Risk score 0-100 (higher = riskier) ─────────────────────────────────────

function computeRiskScore(proposal, treasury, errors, warnings) {
  if (errors.length > 0) return 100;

  let score = 0;

  // Drawdown contribution
  score += treasury.drawdownPct * 40;

  // Position concentration
  const positionPct = (proposal.capitalUsed ?? 0) / (treasury.total || 1);
  score += positionPct * 200;  // 5% position = +10 points

  // Confidence (inverse — higher confidence = lower risk score)
  score += (1 - (proposal.confidence ?? 0.5)) * 25;

  // Days to close (longer = riskier)
  score += Math.min(20, (proposal.daysToClose ?? 30) / 45 * 20);

  // Warnings
  score += warnings.length * 5;

  return Math.min(100, Math.round(score));
}

// ─── Post-trade record (for discipline tracking) ─────────────────────────────

export function recordTradeDecision(proposal, riskCheck, wasExecuted) {
  // Log to decisions table in memoryStore (JSON) for backwards compat
  // Risk data persisted in the trade record itself
  return {
    riskScore:    riskCheck.riskScore,
    approved:     riskCheck.approved,
    warnings:     riskCheck.warnings,
    executed:     wasExecuted,
  };
}

// ─── Get risk metrics for dashboard ──────────────────────────────────────────

export function getRiskMetrics() {
  const treasury = getTreasury();

  const openTrades = db.prepare(`
    SELECT market_category, COUNT(*) AS cnt, SUM(capital_used) AS at_risk
    FROM trades WHERE status = 'open'
    GROUP BY market_category
  `).all();

  const recentLosses = db.prepare(`
    SELECT COUNT(*) AS cnt FROM trades
    WHERE status = 'closed' AND pnl < 0
      AND date(closed_at) = date('now')
  `).get()?.cnt ?? 0;

  const agent = db.prepare(`SELECT loss_streak FROM agent_profiles WHERE id = 'market-agent-1'`).get();

  return {
    drawdownPct:    treasury.drawdownPct,
    isPaused:       treasury.isPaused,
    openByCategory: openTrades,
    todayLosses:    recentLosses,
    lossStreak:     agent?.loss_streak ?? 0,
    limits:         LIMITS,
  };
}
