// signalAgent.mjs — generate alpha signals from patterns + risk scores.

import db from '../db/database.mjs';
import { scoreTokenRisk, isTokenTradeable } from './tokenRiskAgent.mjs';
import { detectPatterns, getSmartMoneySet } from './patternAnalyst.mjs';
import { addSignal, broadcast } from './state.mjs';

const MIN_CONFIDENCE = 55;

/**
 * Evaluate a token and emit a signal if conditions are met.
 * Called from pumpPortalFeed after each significant trade event.
 *
 * @param {object} token - token data from state.tokens map
 */
export async function evaluateSignal(token) {
  try {
    if (!token?.mint) return null;

    // Risk gate
    const risk = scoreTokenRisk({
      bondingCurvePct:  token.bondingCurvePct ?? 0,
      marketCapSol:     token.marketCapSol ?? 0,
      tradeCount:       token.tradeCount ?? 0,
      uniqueWallets:    token.uniqueWallets ?? 0,
      createdTs:        token.createdTs ?? Date.now(),
    });

    if (!isTokenTradeable(risk)) return null;

    const smartSet = await getSmartMoneySet();
    const analysis = detectPatterns(token, smartSet);

    if (analysis.patterns.length === 0) return null;

    // Confidence scoring
    let confidence = 35;
    if (analysis.patterns.includes('smart_money_accumulation')) confidence += 25;
    if (analysis.patterns.includes('smart_money_single'))       confidence += 12;
    if (analysis.patterns.includes('volume_spike'))             confidence += 15;
    if (analysis.patterns.includes('early_discovery'))          confidence += 10;
    if (analysis.patterns.includes('bonding_sprint'))           confidence += 8;
    if (analysis.patterns.includes('migration_imminent'))       confidence -= 10; // too late
    confidence -= risk.score * 0.3;
    confidence = Math.round(Math.min(100, Math.max(0, confidence)));

    if (confidence < MIN_CONFIDENCE) return null;

    const signalType = analysis.patterns[0];
    const reason = [
      ...analysis.patterns.map(p => p.toUpperCase()),
      `${analysis.smartBuyers.length} smart wallets`,
      `vol ${analysis.recentVolSol} SOL/min`,
      `risk ${risk.score} (${risk.label})`,
    ].join(' | ');

    const signal = {
      id:          `sig_${Date.now()}_${token.mint.slice(0, 8)}`,
      tokenMint:   token.mint,
      tokenSymbol: token.symbol ?? '???',
      signalType,
      confidence,
      reason,
      walletCount: analysis.smartBuyers.length,
      riskScore:   risk.score,
      riskLabel:   risk.label,
      patterns:    analysis.patterns,
      marketCapSol: token.marketCapSol ?? 0,
      lastPriceSol: token.lastPriceSol ?? 0,
      createdAt:   new Date().toISOString(),
    };

    // Persist
    db.prepare(`
      INSERT OR IGNORE INTO solana_signals
        (id, token_mint, token_symbol, signal_type, confidence, reason, wallet_count, risk_score)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(signal.id, signal.tokenMint, signal.tokenSymbol, signalType, confidence, reason, signal.walletCount, risk.score);

    // Broadcast to frontend
    addSignal(signal);
    broadcast({ type: 'solana:signal', signal });

    return signal;
  } catch (err) {
    console.error('[signalAgent] evaluateSignal error:', err.message);
    return null;
  }
}

export function getRecentSignals(limit = 30) {
  return db.prepare(`
    SELECT * FROM solana_signals ORDER BY created_at DESC LIMIT ?
  `).all(limit);
}
