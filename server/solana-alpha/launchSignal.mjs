// launchSignal.mjs — FREE alpha engine built on launch-time data only.
//
// Because PumpPortal's free tier exposes only new-token creation events (not
// trades), the original trade-based signal engine never fires. This module
// scores a token at LAUNCH from the data we do get for free:
//   - dev/initial buy size (skin in the game)
//   - market cap + bonding-curve progress (momentum)
//   - creator reputation (our free "smart money" analog — built from the
//     outcomes of our own paper trades on that creator's past launches)
//   - market heat (launches/min — avoid spam floods)
//
// Creators are stored in solana_wallets (label 'creator') so they also
// populate the Wallet Explorer panel.

import db from '../db/database.mjs';
import { addSignal, broadcast } from './state.mjs';

const MIN_SIGNAL_CONF = 55;

// ── Launch velocity (market heat) ──────────────────────────────────────────────
let _launchTimes = [];
export function recordLaunch() {
  const now = Date.now();
  _launchTimes.push(now);
  _launchTimes = _launchTimes.filter((t) => now - t < 60_000);
}
function launchesPerMin() {
  return _launchTimes.length;
}

// ── Creator reputation (free smart-money analog) ───────────────────────────────
export function recordCreatorLaunch(creator) {
  if (!creator) return;
  try {
    const ex = db.prepare(`SELECT address FROM solana_wallets WHERE address = ?`).get(creator);
    if (!ex) {
      db.prepare(
        `INSERT INTO solana_wallets (address, label, score, total_trades) VALUES (?, 'creator', 45, 1)`,
      ).run(creator);
    } else {
      db.prepare(
        `UPDATE solana_wallets SET total_trades = total_trades + 1, last_active = datetime('now') WHERE address = ?`,
      ).run(creator);
    }
  } catch { /* best-effort */ }
}

/** Update a creator's score from the outcome of a paper trade on their token. */
export function recordCreatorOutcome(creator, won, profitX = 1) {
  if (!creator) return;
  try {
    const ex = db.prepare(`SELECT * FROM solana_wallets WHERE address = ?`).get(creator);
    if (!ex) return;
    const wins = ex.wins + (won ? 1 : 0);
    const losses = ex.losses + (won ? 0 : 1);
    const n = wins + losses;
    const avgProfitX = n > 0 ? (ex.avg_profit_x * (n - 1) + profitX) / n : profitX;
    const winRate = n > 0 ? wins / n : 0;
    const score = Math.round(
      Math.min(100, Math.max(0, winRate * 55 + Math.min(25, (avgProfitX - 1) * 15) + Math.min(20, n * 3))),
    );
    const label = score >= 75 ? 'smart_money' : score >= 55 ? 'skilled' : score >= 40 ? 'average' : 'weak';
    db.prepare(
      `UPDATE solana_wallets SET wins = ?, losses = ?, avg_profit_x = ?, score = ?, label = ? WHERE address = ?`,
    ).run(wins, losses, avgProfitX, score, label, creator);
  } catch { /* best-effort */ }
}

function creatorRow(creator) {
  if (!creator) return null;
  try {
    return db.prepare(`SELECT score, total_trades, wins, losses FROM solana_wallets WHERE address = ?`).get(creator) ?? null;
  } catch {
    return null;
  }
}

// ── Signal evaluation ──────────────────────────────────────────────────────────
/**
 * @param {{ mint, symbol, creator, initialBuySol, marketCapSol, bondingCurvePct, lastPriceSol }} token
 * @returns {object|null} signal if it clears MIN_SIGNAL_CONF
 */
export function evaluateLaunchSignal(token) {
  if (!token?.mint) return null;

  const initBuy = token.initialBuySol ?? 0;
  const mcap = token.marketCapSol ?? 0;
  const bonding = token.bondingCurvePct ?? 0;

  let confidence = 30;
  const reasons = [];

  if (initBuy >= 2) { confidence += 25; reasons.push(`dev buy ${initBuy.toFixed(2)} SOL`); }
  else if (initBuy >= 1) { confidence += 16; reasons.push(`dev buy ${initBuy.toFixed(2)} SOL`); }
  else if (initBuy >= 0.5) { confidence += 8; reasons.push(`dev buy ${initBuy.toFixed(2)} SOL`); }

  if (mcap >= 25 && mcap <= 90) { confidence += 10; reasons.push(`mcap ${mcap.toFixed(0)} SOL`); }
  if (mcap > 0 && mcap < 8) confidence -= 20; // dust launch

  if (bonding >= 55) { confidence += 12; reasons.push(`bonding ${bonding.toFixed(0)}%`); }
  else if (bonding >= 40) { confidence += 6; }

  const cr = creatorRow(token.creator);
  if (cr && cr.total_trades >= 3) {
    if (cr.score >= 70) { confidence += 22; reasons.push(`proven creator ${cr.wins}W/${cr.losses}L`); }
    else if (cr.score >= 55) { confidence += 12; reasons.push(`skilled creator`); }
    else if (cr.score < 35) { confidence -= 15; reasons.push(`weak creator`); }
  }

  const heat = launchesPerMin();
  if (heat > 0 && heat < 40) confidence += 4; // calmer market = cleaner signal

  confidence = Math.round(Math.min(100, Math.max(0, confidence)));
  if (confidence < MIN_SIGNAL_CONF) return null;

  const signalType =
    cr && cr.score >= 70 ? 'proven_creator'
    : initBuy >= 2 ? 'whale_launch'
    : bonding >= 55 ? 'bonding_momentum'
    : 'quality_launch';

  const reason = [signalType.toUpperCase(), ...reasons].join(' | ') || signalType.toUpperCase();

  const signal = {
    id: `sig_${Date.now()}_${token.mint.slice(0, 8)}`,
    tokenMint: token.mint,
    tokenSymbol: token.symbol ?? '???',
    signalType,
    confidence,
    reason,
    walletCount: cr?.total_trades ?? 0,
    riskScore: 50,
    riskLabel: 'launch',
    marketCapSol: mcap,
    lastPriceSol: token.lastPriceSol ?? 0,
    createdAt: new Date().toISOString(),
  };

  try {
    db.prepare(
      `INSERT OR IGNORE INTO solana_signals
        (id, token_mint, token_symbol, signal_type, confidence, reason, wallet_count, risk_score)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(signal.id, signal.tokenMint, signal.tokenSymbol, signalType, confidence, reason, signal.walletCount, 50);
  } catch { /* dup id — ignore */ }

  addSignal(signal);
  broadcast({ type: 'solana:signal', signal });
  return signal;
}
